param(
  [Parameter(Mandatory = $true)][string]$UnsignedApk,
  [Parameter(Mandatory = $true)][string]$OutputApk,
  [Parameter(Mandatory = $true)][string]$ExpectedUnsignedSha256,
  [string]$SecretsDir = $env:TIGERIQ_ANDROID_SIGNING_DIR,
  [string]$ApkSigner = $env:TIGERIQ_APKSIGNER,
  [string]$ZipAlign = $env:TIGERIQ_ZIPALIGN
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$CanonicalCertificateSha256 = '63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293'

function Resolve-Tool([string]$ExplicitPath, [string[]]$Names) {
  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) { throw "ANDROID_BUILD_TOOL_NOT_FOUND: $ExplicitPath" }
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }
  foreach ($name in $Names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  throw "ANDROID_BUILD_TOOL_REQUIRED: provide an explicit tool path."
}

function Quote-ProcessArg([string]$Value) {
  return '"' + ($Value -replace '"','\"') + '"'
}

function New-ToolProcessStartInfo([string]$FileName, [string[]]$Args) {
  $renderedArgs = (($Args | ForEach-Object { if ($_ -match '\s|"') { Quote-ProcessArg $_ } else { $_ } }) -join ' ')
  $psi = New-Object Diagnostics.ProcessStartInfo
  if ($FileName -match '(?i)\.(bat|cmd)
  $p = New-Object Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) { throw ("PROCESS_FAILED: " + $FileName + " exit=" + $p.ExitCode + " stderr=" + $stderr.Trim()) }
  return $stdout
}

function Invoke-ApkSignerWithSecureStdin(
  [string]$FileName,
  [string[]]$Args,
  [Security.SecureString]$Password
) {
  $psi = New-ToolProcessStartInfo $FileName $Args
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
      throw ("APKSIGNER_FAILED: exit=" + $p.ExitCode + " stderr=" + $stderr.Trim())
    }
    return $stdout
  } finally {
    if ($chars -ne $null) { [Array]::Clear($chars, 0, $chars.Length) }
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($p -and -not $p.HasExited) { try { $p.Kill() } catch {} }
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
if ([string]::IsNullOrWhiteSpace($alias)) { throw 'STABLE_SIGNING_ALIAS_REQUIRED' }

$apksignerExe = Resolve-Tool $ApkSigner @('apksigner.bat','apksigner')
$zipalignExe = Resolve-Tool $ZipAlign @('zipalign.exe','zipalign')

$outputDir = Split-Path -Parent $OutputApk
if ([string]::IsNullOrWhiteSpace($outputDir)) { $outputDir = (Get-Location).Path }
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$output = Join-Path (Resolve-Path -LiteralPath $outputDir).Path (Split-Path -Leaf $OutputApk)
if ([IO.Path]::GetFullPath($output) -eq [IO.Path]::GetFullPath($unsigned)) {
  throw 'OUTPUT_APK_MUST_DIFFER_FROM_UNSIGNED_APK'
}
$aligned = Join-Path (Split-Path -Parent $output) ([IO.Path]::GetFileNameWithoutExtension($output) + '.aligned.tmp.apk')

Remove-Item -LiteralPath $aligned, $output, ($output + '.idsig') -Force -ErrorAction SilentlyContinue

try {
  Invoke-PlainProcess $zipalignExe @('-f','-p','4',$unsigned,$aligned) | Out-Null
  $securePassword = ([IO.File]::ReadAllText($passwordBlob).Trim() | ConvertTo-SecureString)

  Invoke-ApkSignerWithSecureStdin $apksignerExe @(
    'sign',
    '--ks', $keystore,
    '--ks-key-alias', $alias,
    '--ks-pass', 'stdin',
    '--key-pass', 'stdin',
    '--v1-signing-enabled', 'false',
    '--v2-signing-enabled', 'true',
    '--v3-signing-enabled', 'true',
    '--out', $output,
    $aligned
  ) $securePassword | Out-Null

  $verify = Invoke-PlainProcess $apksignerExe @('verify','--verbose','--print-certs',$output)
  $certLine = ($verify -split [Environment]::NewLine | Where-Object { $_ -match 'Signer #1 certificate SHA-256 digest:' } | Select-Object -First 1)
  if (-not $certLine) { throw 'APK_CERTIFICATE_FINGERPRINT_NOT_FOUND' }
  $actualCert = (($certLine -split ':',2)[1]).Trim().Replace(':','').ToUpperInvariant()
  if ($actualCert -ne $CanonicalCertificateSha256) {
    Remove-Item -LiteralPath $output, ($output + '.idsig') -Force -ErrorAction SilentlyContinue
    throw 'APK_SIGNING_IDENTITY_MISMATCH'
  }
  if ($verify -notmatch 'Verified using v2 scheme \(APK Signature Scheme v2\): true') { throw 'APK_V2_SIGNATURE_REQUIRED' }
  if ($verify -notmatch 'Verified using v3 scheme \(APK Signature Scheme v3\): true') { throw 'APK_V3_SIGNATURE_REQUIRED' }

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
  } | ConvertTo-Json -Compress
} catch {
  Remove-Item -LiteralPath $output, ($output + '.idsig') -Force -ErrorAction SilentlyContinue
  throw
} finally {
  Remove-Item -LiteralPath $aligned -Force -ErrorAction SilentlyContinue
  Remove-Variable securePassword -ErrorAction SilentlyContinue
}
) {
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

function Invoke-PlainProcess([string]$FileName, [string[]]$Args) {
  $psi = New-ToolProcessStartInfo $FileName $Args
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = New-Object Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) { throw ("PROCESS_FAILED: " + $FileName + " exit=" + $p.ExitCode + " stderr=" + $stderr.Trim()) }
  return $stdout
}

function Invoke-ApkSignerWithSecureStdin(
  [string]$FileName,
  [string[]]$Args,
  [Security.SecureString]$Password
) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $FileName
  $psi.Arguments = (($Args | ForEach-Object { if ($_ -match '\s|"') { Quote-ProcessArg $_ } else { $_ } }) -join ' ')
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
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
      throw ("APKSIGNER_FAILED: exit=" + $p.ExitCode + " stderr=" + $stderr.Trim())
    }
    return $stdout
  } finally {
    if ($chars -ne $null) { [Array]::Clear($chars, 0, $chars.Length) }
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($p -and -not $p.HasExited) { try { $p.Kill() } catch {} }
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
if ([string]::IsNullOrWhiteSpace($alias)) { throw 'STABLE_SIGNING_ALIAS_REQUIRED' }

$apksignerExe = Resolve-Tool $ApkSigner @('apksigner.bat','apksigner')
$zipalignExe = Resolve-Tool $ZipAlign @('zipalign.exe','zipalign')

$outputDir = Split-Path -Parent $OutputApk
if ([string]::IsNullOrWhiteSpace($outputDir)) { $outputDir = (Get-Location).Path }
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$output = Join-Path (Resolve-Path -LiteralPath $outputDir).Path (Split-Path -Leaf $OutputApk)
if ([IO.Path]::GetFullPath($output) -eq [IO.Path]::GetFullPath($unsigned)) {
  throw 'OUTPUT_APK_MUST_DIFFER_FROM_UNSIGNED_APK'
}
$aligned = Join-Path (Split-Path -Parent $output) ([IO.Path]::GetFileNameWithoutExtension($output) + '.aligned.tmp.apk')

Remove-Item -LiteralPath $aligned, $output, ($output + '.idsig') -Force -ErrorAction SilentlyContinue

try {
  Invoke-PlainProcess $zipalignExe @('-f','-p','4',$unsigned,$aligned) | Out-Null
  $securePassword = ([IO.File]::ReadAllText($passwordBlob).Trim() | ConvertTo-SecureString)

  Invoke-ApkSignerWithSecureStdin $apksignerExe @(
    'sign',
    '--ks', $keystore,
    '--ks-key-alias', $alias,
    '--ks-pass', 'stdin',
    '--key-pass', 'stdin',
    '--v1-signing-enabled', 'false',
    '--v2-signing-enabled', 'true',
    '--v3-signing-enabled', 'true',
    '--out', $output,
    $aligned
  ) $securePassword | Out-Null

  $verify = Invoke-PlainProcess $apksignerExe @('verify','--verbose','--print-certs',$output)
  $certLine = ($verify -split [Environment]::NewLine | Where-Object { $_ -match 'Signer #1 certificate SHA-256 digest:' } | Select-Object -First 1)
  if (-not $certLine) { throw 'APK_CERTIFICATE_FINGERPRINT_NOT_FOUND' }
  $actualCert = (($certLine -split ':',2)[1]).Trim().Replace(':','').ToUpperInvariant()
  if ($actualCert -ne $CanonicalCertificateSha256) {
    Remove-Item -LiteralPath $output, ($output + '.idsig') -Force -ErrorAction SilentlyContinue
    throw 'APK_SIGNING_IDENTITY_MISMATCH'
  }
  if ($verify -notmatch 'Verified using v2 scheme \(APK Signature Scheme v2\): true') { throw 'APK_V2_SIGNATURE_REQUIRED' }
  if ($verify -notmatch 'Verified using v3 scheme \(APK Signature Scheme v3\): true') { throw 'APK_V3_SIGNATURE_REQUIRED' }

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
  } | ConvertTo-Json -Compress
} catch {
  Remove-Item -LiteralPath $output, ($output + '.idsig') -Force -ErrorAction SilentlyContinue
  throw
} finally {
  Remove-Item -LiteralPath $aligned -Force -ErrorAction SilentlyContinue
  Remove-Variable securePassword -ErrorAction SilentlyContinue
}
