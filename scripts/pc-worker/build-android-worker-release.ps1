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
$dpapiReady = (
  (Test-Path -LiteralPath $dpapiKeystore -PathType Leaf) -and
  (Test-Path -LiteralPath $dpapiPasswordBlob -PathType Leaf) -and
  (Test-Path -LiteralPath $aliasFile -PathType Leaf)
)

$legacyKeystore = Join-Path $SecretsDir 'tigeriq-worker.jks'
$legacyStorePasswordFile = Join-Path $SecretsDir 'store-password.txt'
$legacyKeyPasswordFile = Join-Path $SecretsDir 'key-password.txt'
$legacyFingerprintFile = Join-Path $SecretsDir 'certificate-sha256.txt'
$legacyReady = (
  (Test-Path -LiteralPath $legacyKeystore -PathType Leaf) -and
  (Test-Path -LiteralPath $legacyStorePasswordFile -PathType Leaf) -and
  (Test-Path -LiteralPath $legacyKeyPasswordFile -PathType Leaf) -and
  (Test-Path -LiteralPath $legacyFingerprintFile -PathType Leaf)
)

if (-not $dpapiReady -and -not $legacyReady) {
  throw 'STABLE_SIGNING_NOT_PROVISIONED: canonical DPAPI signer bundle or pre-provisioned legacy signer bundle is required.'
}

$workerDir = Join-Path $RepoRoot 'apps\android-worker'
$gradle = Join-Path $workerDir 'gradlew.bat'
if (-not (Test-Path -LiteralPath $gradle -PathType Leaf)) { throw 'GRADLE_WRAPPER_MISSING' }

$versionLine = Select-String -Path (Join-Path $workerDir 'app\build.gradle.kts') -Pattern 'versionName\s*=\s*"([^"]+)"' | Select-Object -First 1
if (-not $versionLine) { throw 'WORKER_VERSION_NOT_FOUND' }
$version = $versionLine.Matches[0].Groups[1].Value

$releaseDir = Join-Path $ReleaseRoot $version
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$outApk = Join-Path $releaseDir "tigeriq-worker-$version.apk"

$signingIdentity = ''
$sha256 = ''
$expected = $CanonicalCertificateSha256

if ($dpapiReady) {
  Remove-Item Env:TIGERIQ_ANDROID_KEYSTORE,Env:TIGERIQ_ANDROID_KEY_ALIAS,Env:TIGERIQ_ANDROID_STORE_PASSWORD_FILE,Env:TIGERIQ_ANDROID_KEY_PASSWORD_FILE -ErrorAction SilentlyContinue

  try {
    Push-Location $workerDir
    & $gradle clean :app:assembleRelease
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
  $signingIdentity = 'stable-private-pc01-dpapi-stdin'
} else {
  $expected = ([IO.File]::ReadAllText($legacyFingerprintFile).Trim().Replace(':','').ToUpperInvariant())
  if ($expected -ne $CanonicalCertificateSha256) {
    throw 'CANONICAL_SIGNING_IDENTITY_MISMATCH: pinned signer directory is not the established TigerIQ Android signer.'
  }

  $keytool = Get-Command keytool.exe -ErrorAction SilentlyContinue
  if (-not $keytool) { throw 'KEYTOOL_MISSING: a JDK is required to verify the canonical signer before building.' }
  $storePassword = [IO.File]::ReadAllText($legacyStorePasswordFile).Trim()
  $certificate = & $keytool.Source -list -v -keystore $legacyKeystore -storepass $storePassword -alias $Alias 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'KEYSTORE_VERIFY_FAILED' }
  $preflightLine = $certificate | Where-Object { $_ -match '^\s*SHA256:\s*' } | Select-Object -First 1
  if (-not $preflightLine) { throw 'KEYSTORE_CERTIFICATE_FINGERPRINT_NOT_FOUND' }
  $preflightFingerprint = ($preflightLine -replace '^\s*SHA256:\s*','').Trim().Replace(':','').ToUpperInvariant()
  if ($preflightFingerprint -ne $CanonicalCertificateSha256) { throw 'KEYSTORE_SIGNING_IDENTITY_MISMATCH' }

  $env:TIGERIQ_ANDROID_KEYSTORE = $legacyKeystore
  $env:TIGERIQ_ANDROID_KEY_ALIAS = $Alias
  $env:TIGERIQ_ANDROID_STORE_PASSWORD_FILE = $legacyStorePasswordFile
  $env:TIGERIQ_ANDROID_KEY_PASSWORD_FILE = $legacyKeyPasswordFile

  try {
    Push-Location $workerDir
    & $gradle clean :app:assembleRelease
    if ($LASTEXITCODE -ne 0) { throw 'ANDROID_RELEASE_BUILD_FAILED' }
  } finally {
    Pop-Location
    Remove-Item Env:TIGERIQ_ANDROID_KEYSTORE,Env:TIGERIQ_ANDROID_KEY_ALIAS,Env:TIGERIQ_ANDROID_STORE_PASSWORD_FILE,Env:TIGERIQ_ANDROID_KEY_PASSWORD_FILE -ErrorAction SilentlyContinue
  }

  $apk = Join-Path $workerDir 'app\build\outputs\apk\release\app-release.apk'
  if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw 'SIGNED_APK_NOT_FOUND' }

  $apksigner = Get-Command apksigner.bat -ErrorAction SilentlyContinue
  if (-not $apksigner) { $apksigner = Get-Command apksigner -ErrorAction SilentlyContinue }
  if (-not $apksigner) { throw 'APKSIGNER_MISSING: Android SDK build-tools are required to verify the release certificate.' }

  $verify = & $apksigner.Source verify --verbose --print-certs $apk 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'APK_SIGNATURE_VERIFY_FAILED' }
  $certLine = $verify | Where-Object { $_ -match 'Signer #1 certificate SHA-256 digest:' } | Select-Object -First 1
  if (-not $certLine) { throw 'APK_CERTIFICATE_FINGERPRINT_NOT_FOUND' }
  $actual = (($certLine -split ':',2)[1]).Trim().Replace(':','').ToUpperInvariant()
  if ($actual -ne $CanonicalCertificateSha256) { throw 'APK_SIGNING_IDENTITY_MISMATCH' }

  Copy-Item -LiteralPath $apk -Destination $outApk -Force
  $sha256 = (Get-FileHash -LiteralPath $outApk -Algorithm SHA256).Hash.ToUpperInvariant()
  $signingIdentity = 'stable-private-pc01-legacy-preprovisioned'
}

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
  certificateSha256 = $expected
  signingIdentity = $signingIdentity
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
  certificateSha256 = $expected
  sourceSha = $sourceSha
  signingIdentity = $signingIdentity
  secretsPrinted = $false
} | ConvertTo-Json -Compress
