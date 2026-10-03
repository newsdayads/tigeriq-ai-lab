param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$SecretsDir = $env:TIGERIQ_ANDROID_SIGNING_DIR,
  [string]$ReleaseRoot = 'D:\TigerIQ\Releases\AndroidWorker\signed',
  [string]$Alias = $env:TIGERIQ_ANDROID_KEY_ALIAS
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$CanonicalCertificateSha256 = '63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293'

if ([string]::IsNullOrWhiteSpace($SecretsDir)) {
  throw 'STABLE_SIGNING_DIR_REQUIRED: provide TIGERIQ_ANDROID_SIGNING_DIR or -SecretsDir for the existing canonical signer.'
}

$aliasFile = Join-Path $SecretsDir 'key-alias.txt'
if ([string]::IsNullOrWhiteSpace($Alias) -and (Test-Path -LiteralPath $aliasFile -PathType Leaf)) {
  $Alias = [IO.File]::ReadAllText($aliasFile).Trim()
}
if ([string]::IsNullOrWhiteSpace($Alias)) { throw 'STABLE_SIGNING_ALIAS_REQUIRED' }

$dpapiKeystore = Join-Path $SecretsDir 'tigeriq-release.jks'
$dpapiPasswordBlob = Join-Path $SecretsDir 'signing-password.dpapi.txt'
foreach ($required in @($dpapiKeystore,$dpapiPasswordBlob,$aliasFile)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw 'STABLE_SIGNING_NOT_PROVISIONED: canonical DPAPI signer bundle is required.'
  }
}

$workerDir = Join-Path $RepoRoot 'apps\android-worker'

function Resolve-GradleCommand {
  $wrapper = Join-Path $workerDir 'gradlew.bat'
  if (Test-Path -LiteralPath $wrapper -PathType Leaf) { return $wrapper }

  foreach ($name in @('gradle.bat','gradle')) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:GRADLE_HOME)) {
    $candidate = Join-Path $env:GRADLE_HOME 'bin\gradle.bat'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    $cacheRoot = Join-Path $env:USERPROFILE '.gradle\wrapper\dists\gradle-8.7-bin'
    if (Test-Path -LiteralPath $cacheRoot -PathType Container) {
      $cached = Get-ChildItem -LiteralPath $cacheRoot -Filter 'gradle.bat' -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName.EndsWith('\gradle-8.7\bin\gradle.bat',[System.StringComparison]::OrdinalIgnoreCase) } |
        Sort-Object FullName |
        Select-Object -First 1
      if ($cached) { return $cached.FullName }
    }
  }

  throw 'GRADLE_COMMAND_MISSING: use the existing Gradle 8.7 installation/cache; no network install is performed by the release builder.'
}

$gradle = Resolve-GradleCommand

$versionLine = Select-String -Path (Join-Path $workerDir 'app\build.gradle.kts') -Pattern 'versionName\s*=\s*"([^"]+)"' | Select-Object -First 1
if (-not $versionLine) { throw 'WORKER_VERSION_NOT_FOUND' }
$version = $versionLine.Matches[0].Groups[1].Value

$releaseDir = Join-Path $ReleaseRoot $version
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$outApk = Join-Path $releaseDir "tigeriq-worker-$version.apk"

Remove-Item Env:TIGERIQ_ANDROID_KEYSTORE,Env:TIGERIQ_ANDROID_KEY_ALIAS,Env:TIGERIQ_ANDROID_STORE_PASSWORD_FILE,Env:TIGERIQ_ANDROID_KEY_PASSWORD_FILE -ErrorAction SilentlyContinue

try {
  Push-Location $workerDir
  & $gradle --no-daemon clean :app:assembleRelease
  if ($LASTEXITCODE -ne 0) { throw 'ANDROID_RELEASE_BUILD_FAILED' }
} finally {
  Pop-Location
}

$unsignedApk = Join-Path $workerDir 'app\build\outputs\apk\release\app-release-unsigned.apk'
if (-not (Test-Path -LiteralPath $unsignedApk -PathType Leaf)) { throw 'UNSIGNED_APK_NOT_FOUND' }

$unsignedSha256 = (Get-FileHash -LiteralPath $unsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()
$helper = Join-Path $RepoRoot 'scripts\pc-worker\sign-android-worker-with-dpapi.ps1'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'DPAPI_SIGNER_HELPER_MISSING' }

$helperOutput = & $helper -UnsignedApk $unsignedApk -OutputApk $outApk -ExpectedUnsignedSha256 $unsignedSha256 -SecretsDir $SecretsDir
$receiptLine = $helperOutput | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Last 1
if (-not $receiptLine) { throw 'DPAPI_SIGNER_RECEIPT_MISSING' }

try {
  $receipt = $receiptLine | ConvertFrom-Json
} catch {
  throw 'DPAPI_SIGNER_RECEIPT_INVALID'
}

if ($receipt.status -ne 'ANDROID_WORKER_CANONICAL_SIGNING_READY') { throw 'DPAPI_SIGNER_STATUS_INVALID' }
if (([string]$receipt.certificateSha256).ToUpperInvariant() -ne $CanonicalCertificateSha256) { throw 'APK_SIGNING_IDENTITY_MISMATCH' }
if (-not $receipt.v2 -or -not $receipt.v3) { throw 'APK_SIGNATURE_VERIFY_FAILED' }
if ($receipt.plaintextSecretPrinted -ne $false -or $receipt.plaintextSecretWrittenToDisk -ne $false) { throw 'SIGNING_SECRET_SAFETY_VIOLATION' }
if (-not (Test-Path -LiteralPath $outApk -PathType Leaf)) { throw 'SIGNED_APK_NOT_FOUND' }

$sha256 = (Get-FileHash -LiteralPath $outApk -Algorithm SHA256).Hash.ToUpperInvariant()
if ($sha256 -ne ([string]$receipt.signedSha256).ToUpperInvariant()) { throw 'SIGNED_APK_SHA256_MISMATCH' }

$git = Get-Command git.exe -ErrorAction SilentlyContinue
$sourceSha = if ($git) { (& $git.Source -C $RepoRoot rev-parse HEAD).Trim() } else { 'unknown' }

$manifest = [ordered]@{
  schema = 'tigeriq.android-worker.release.v1'
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  version = $version
  applicationId = 'ai.tigeriq.worker'
  sourceSha = $sourceSha
  apk = (Split-Path $outApk -Leaf)
  apkSha256 = $sha256
  certificateSha256 = $CanonicalCertificateSha256
  signingIdentity = 'stable-private-pc01-dpapi-stdin'
  secretsIncluded = $false
}
$manifestPath = Join-Path $releaseDir 'release-manifest.json'
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8

[ordered]@{
  status = 'ANDROID_WORKER_STABLE_RELEASE_READY'
  version = $version
  apk = $outApk
  manifest = $manifestPath
  apkSha256 = $sha256
  certificateSha256 = $CanonicalCertificateSha256
  sourceSha = $sourceSha
  signingIdentity = 'stable-private-pc01-dpapi-stdin'
  secretsPrinted = $false
} | ConvertTo-Json -Compress
