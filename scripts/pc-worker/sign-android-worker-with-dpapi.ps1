param(
  [Parameter(Mandatory = $true)][string]$UnsignedApk,
  [Parameter(Mandatory = $true)][string]$OutputApk,
  [Parameter(Mandatory = $true)][string]$ExpectedUnsignedSha256,
  [string]$SecretsDir = $env:TIGERIQ_ANDROID_SIGNING_DIR,
  [string]$ApkSigner = $env:TIGERIQ_APKSIGNER,
  [string]$ZipAlign = $env:TIGERIQ_ZIPALIGN,
  [string]$ApkSignerJar = $env:TIGERIQ_APKSIGNER_JAR,
  [string]$ExpectedApkSignerJarSha256 = $env:TIGERIQ_APKSIGNER_JAR_SHA256,
  [string]$Java = $env:TIGERIQ_JAVA,
  [switch]$PrealignedInput
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$CanonicalCertificateSha256 = '63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293'

function Resolve-Tool([string]$ExplicitPath, [string[]]$Names) {
  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) {
      throw "ANDROID_BUILD_TOOL_NOT_FOUND: $ExplicitPath"
    }
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }

  foreach ($name in $Names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }

  throw 'ANDROID_BUILD_TOOL_REQUIRED: provide an explicit tool path.'
}

function Resolve-AndroidBuildTool([string]$ExplicitPath, [string[]]$Names) {
  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    return Resolve-Tool $ExplicitPath $Names
  }

  foreach ($name in $Names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }

  $toolRole = if ($Names -contains 'apksigner.bat' -or $Names -contains 'apksigner') {
    'APKSIGNER'
  } elseif ($Names -contains 'zipalign.exe' -or $Names -contains 'zipalign') {
    'ZIPALIGN'
  } else {
    'BUILD_TOOL'
  }

  $sdkRoots = @(@(
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME,
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Android\Sdk' } else { $null })
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)

  if ($sdkRoots.Count -eq 0) {
    throw ("ANDROID_" + $toolRole + "_DISCOVERY_NO_SDK_ROOT")
  }

  $buildToolsRootFound = $false
  foreach ($sdkRoot in $sdkRoots) {
    $buildToolsRoot = Join-Path $sdkRoot 'build-tools'
    if (-not (Test-Path -LiteralPath $buildToolsRoot -PathType Container)) { continue }
    $buildToolsRootFound = $true

    $versions = Get-ChildItem -LiteralPath $buildToolsRoot -Directory -ErrorAction SilentlyContinue |
      Sort-Object {
        try { [version]$_.Name } catch { [version]'0.0' }
      } -Descending

    foreach ($versionDir in $versions) {
      foreach ($name in $Names) {
        $candidate = Join-Path $versionDir.FullName $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
          return $candidate
        }
      }
    }
  }

  if (-not $buildToolsRootFound) {
    throw ("ANDROID_" + $toolRole + "_DISCOVERY_NO_BUILD_TOOLS_DIR")
  }
  throw ("ANDROID_" + $toolRole + "_DISCOVERY_BINARY_MISSING")
}

function Quote-ProcessArg([string]$Value) {
  return '"' + ($Value -replace '"', '\"') + '"'
}

function New-ToolProcessStartInfo([string]$FileName, [string[]]$ToolArgs) {
  $renderedArgs = (($ToolArgs | ForEach-Object {
    if ($_ -match '\s|"') { Quote-ProcessArg $_ } else { $_ }
  }) -join ' ')

  $psi = New-Object Diagnostics.ProcessStartInfo
  $extension = [IO.Path]::GetExtension($FileName)

  if ($extension -match '(?i)^\.(bat|cmd)$') {
    $psi.FileName = $env:ComSpec
    $psi.Arguments = '/d /s /c ""' + $FileName + '" ' + $renderedArgs + '"'
  } else {
    $psi.FileName = $FileName
    $psi.Arguments = $renderedArgs
  }

  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  return $psi
}

function Invoke-PlainProcess([string]$FileName, [string[]]$ToolArgs) {
  $psi = New-ToolProcessStartInfo $FileName $ToolArgs
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true

  $p = New-Object Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()

  if ($p.ExitCode -ne 0) {
    throw ("ANDROID_BUILD_TOOL_FAILED: exit=" + $p.ExitCode)
  }

  return $stdout
}

function Invoke-ApkSignerWithSecureStdin(
  [string]$FileName,
  [string[]]$ToolArgs,
  [Security.SecureString]$Password
) {
  $psi = New-ToolProcessStartInfo $FileName $ToolArgs
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true

  $p = New-Object Diagnostics.Process
  $p.StartInfo = $psi
  $bstr = [IntPtr]::Zero
  $chars = $null

  try {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
    $length = [Runtime.InteropServices.Marshal]::ReadInt32($bstr, -4) / 2
    $chars = New-Object char[] $length

    for ($i = 0; $i -lt $length; $i++) {
      $chars[$i] = [char][Runtime.InteropServices.Marshal]::ReadInt16($bstr, $i * 2)
    }

    [void]$p.Start()
    $p.StandardInput.Write($chars, 0, $chars.Length)
    $p.StandardInput.WriteLine()
    $p.StandardInput.Write($chars, 0, $chars.Length)
    $p.StandardInput.WriteLine()
    $p.StandardInput.Close()

    $stdout = $p.StandardOutput.ReadToEnd()
    $stderr = $p.StandardError.ReadToEnd()
    $p.WaitForExit()

    if ($p.ExitCode -ne 0) {
      throw ("APKSIGNER_FAILED: exit=" + $p.ExitCode)
    }

    return $stdout
  } finally {
    if ($chars -ne $null) { [Array]::Clear($chars, 0, $chars.Length) }
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($p) {
      try {
        if (-not $p.HasExited) { $p.Kill() }
      } catch {}
    }
  }
}

if ([string]::IsNullOrWhiteSpace($SecretsDir)) {
  throw 'STABLE_SIGNING_DIR_REQUIRED: use the existing canonical signer directory only.'
}

$unsigned = (Resolve-Path -LiteralPath $UnsignedApk).Path
$actualUnsignedSha256 = (Get-FileHash -LiteralPath $unsigned -Algorithm SHA256).Hash.ToUpperInvariant()
$expectedUnsigned = $ExpectedUnsignedSha256.Trim().Replace(':','').ToUpperInvariant()

if ($actualUnsignedSha256 -ne $expectedUnsigned) {
  throw 'UNSIGNED_APK_SHA256_MISMATCH'
}

$keystore = Join-Path $SecretsDir 'tigeriq-release.jks'
$passwordBlob = Join-Path $SecretsDir 'signing-password.dpapi.txt'
$aliasFile = Join-Path $SecretsDir 'key-alias.txt'

foreach ($required in @($keystore, $passwordBlob, $aliasFile)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw 'CANONICAL_SIGNING_IDENTITY_RECOVERY_REQUIRED: signer bundle is incomplete.'
  }
}

$alias = [IO.File]::ReadAllText($aliasFile).Trim()
if ([string]::IsNullOrWhiteSpace($alias)) {
  throw 'STABLE_SIGNING_ALIAS_REQUIRED'
}

$apksignerExe = $null
$apksignerJarPath = $null
$javaExe = $null
$apksignerPrefixArgs = @()
$apksignerMode = 'local-build-tools'

if (-not [string]::IsNullOrWhiteSpace($ApkSignerJar)) {
  if ([string]::IsNullOrWhiteSpace($ExpectedApkSignerJarSha256)) {
    throw 'APKSIGNER_JAR_SHA256_REQUIRED'
  }
  $apksignerJarPath = (Resolve-Path -LiteralPath $ApkSignerJar).Path
  $actualApkSignerJarSha256 = (Get-FileHash -LiteralPath $apksignerJarPath -Algorithm SHA256).Hash.ToUpperInvariant()
  $expectedApkSignerJarSha256Normalized = $ExpectedApkSignerJarSha256.Trim().Replace(':','').ToUpperInvariant()
  if ($actualApkSignerJarSha256 -ne $expectedApkSignerJarSha256Normalized) {
    throw 'APKSIGNER_JAR_SHA256_MISMATCH'
  }
  if (-not [string]::IsNullOrWhiteSpace($Java)) {
    $javaExe = Resolve-Tool $Java @('java.exe', 'java')
  } else {
    $javaCmd = Get-Command java.exe -ErrorAction SilentlyContinue
    if (-not $javaCmd) { $javaCmd = Get-Command java -ErrorAction SilentlyContinue }
    if ($javaCmd) {
      $javaExe = $javaCmd.Source
    } elseif (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
      $javaCandidate = Join-Path $env:JAVA_HOME 'bin\java.exe'
      if (-not (Test-Path -LiteralPath $javaCandidate -PathType Leaf)) { throw 'JAVA_RUNTIME_REQUIRED' }
      $javaExe = (Resolve-Path -LiteralPath $javaCandidate).Path
    } else {
      throw 'JAVA_RUNTIME_REQUIRED'
    }
  }
  $apksignerPrefixArgs = @('-jar', $apksignerJarPath)
  $apksignerMode = 'portable-pinned-jar'
} else {
  $apksignerExe = Resolve-AndroidBuildTool $ApkSigner @('apksigner.bat', 'apksigner')
}

$zipalignExe = if ($PrealignedInput) { $null } else { Resolve-AndroidBuildTool $ZipAlign @('zipalign.exe', 'zipalign') }
$apksignerFile = if ($apksignerMode -eq 'portable-pinned-jar') { $javaExe } else { $apksignerExe }

$outputDir = Split-Path -Parent $OutputApk
if ([string]::IsNullOrWhiteSpace($outputDir)) {
  $outputDir = (Get-Location).Path
}
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$output = Join-Path (Resolve-Path -LiteralPath $outputDir).Path (Split-Path -Leaf $OutputApk)
if ([IO.Path]::GetFullPath($output) -eq [IO.Path]::GetFullPath($unsigned)) {
  throw 'OUTPUT_APK_MUST_DIFFER_FROM_UNSIGNED_APK'
}

$aligned = Join-Path (Split-Path -Parent $output) ([IO.Path]::GetFileNameWithoutExtension($output) + '.aligned.tmp.apk')

Remove-Item -LiteralPath $aligned, $output, ($output + '.idsig') -Force -ErrorAction SilentlyContinue

try {
  $signerInput = $unsigned
  if (-not $PrealignedInput) {
    Invoke-PlainProcess $zipalignExe @('-f', '-p', '4', $unsigned, $aligned) | Out-Null
    $signerInput = $aligned
  }

  try {
    $securePassword = ([IO.File]::ReadAllText($passwordBlob).Trim() | ConvertTo-SecureString)
  } catch {
    throw 'DPAPI_PASSWORD_DECRYPT_FAILED'
  }

  Invoke-ApkSignerWithSecureStdin $apksignerFile ($apksignerPrefixArgs + @(
    'sign',
    '--ks', $keystore,
    '--ks-key-alias', $alias,
    '--ks-pass', 'stdin',
    '--key-pass', 'stdin',
    '--v1-signing-enabled', 'false',
    '--v2-signing-enabled', 'true',
    '--v3-signing-enabled', 'true',
    '--out', $output,
    $signerInput
  )) $securePassword | Out-Null

  $verify = Invoke-PlainProcess $apksignerFile ($apksignerPrefixArgs + @('verify', '--verbose', '--print-certs', $output))
  $certLine = (
    $verify -split [Environment]::NewLine |
      Where-Object { $_ -match 'certificate SHA-256 digest:\s*[0-9a-fA-F:]+' } |
      Select-Object -First 1
  )

  if (-not $certLine -or $certLine -notmatch 'certificate SHA-256 digest:\s*([0-9a-fA-F:]+)') {
    throw 'APK_CERTIFICATE_FINGERPRINT_NOT_FOUND'
  }

  $actualCert = $Matches[1].Trim().Replace(':','').ToUpperInvariant()
  if ($actualCert -ne $CanonicalCertificateSha256) {
    Remove-Item -LiteralPath $output, ($output + '.idsig') -Force -ErrorAction SilentlyContinue
    throw 'APK_SIGNING_IDENTITY_MISMATCH'
  }

  if ($verify -notmatch 'Verified using v2 scheme \(APK Signature Scheme v2\): true') {
    throw 'APK_V2_SIGNATURE_REQUIRED'
  }

  if ($verify -notmatch 'Verified using v3 scheme \(APK Signature Scheme v3\): true') {
    throw 'APK_V3_SIGNATURE_REQUIRED'
  }

  $signedSha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToUpperInvariant()

  [ordered]@{
    status = 'ANDROID_WORKER_CANONICAL_SIGNING_READY'
    outputApk = $output
    signedSha256 = $signedSha256
    certificateSha256 = $CanonicalCertificateSha256
    v2 = $true
    v3 = $true
    plaintextSecretPrinted = $false
    plaintextSecretWrittenToDisk = $false
    passwordTransport = 'stdin-only'
    apksignerMode = $apksignerMode
    prealignedInput = [bool]$PrealignedInput
  } | ConvertTo-Json -Compress
} catch {
  Remove-Item -LiteralPath $output, ($output + '.idsig') -Force -ErrorAction SilentlyContinue
  throw
} finally {
  Remove-Item -LiteralPath $aligned -Force -ErrorAction SilentlyContinue
  $securePasswordVariable = Get-Variable securePassword -ErrorAction SilentlyContinue
  if ($securePasswordVariable -and $securePasswordVariable.Value) { $securePasswordVariable.Value.Dispose() }
  Remove-Variable securePassword,securePasswordVariable -ErrorAction SilentlyContinue
}
