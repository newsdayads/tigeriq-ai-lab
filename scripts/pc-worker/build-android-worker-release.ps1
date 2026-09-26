param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$SecretsDir = 'F:\TigerIQ\Secrets\android-worker-signing',
  [string]$ReleaseRoot = 'F:\TigerIQ\Releases\android-worker',
  [string]$Alias = 'tigeriq-worker-stable'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$keystore = Join-Path $SecretsDir 'tigeriq-worker.jks'
$storePasswordFile = Join-Path $SecretsDir 'store-password.txt'
$keyPasswordFile = Join-Path $SecretsDir 'key-password.txt'
$fingerprintFile = Join-Path $SecretsDir 'certificate-sha256.txt'
foreach ($required in @($keystore,$storePasswordFile,$keyPasswordFile,$fingerprintFile)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "STABLE_SIGNING_NOT_PROVISIONED: missing private signing material." }
}

$workerDir = Join-Path $RepoRoot 'apps\android-worker'
$gradle = Join-Path $workerDir 'gradlew.bat'
if (-not (Test-Path -LiteralPath $gradle -PathType Leaf)) { throw 'GRADLE_WRAPPER_MISSING' }

$env:TIGERIQ_ANDROID_KEYSTORE = $keystore
$env:TIGERIQ_ANDROID_KEY_ALIAS = $Alias
$env:TIGERIQ_ANDROID_STORE_PASSWORD_FILE = $storePasswordFile
$env:TIGERIQ_ANDROID_KEY_PASSWORD_FILE = $keyPasswordFile

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
$expected = ([IO.File]::ReadAllText($fingerprintFile).Trim().Replace(':','').ToUpperInvariant())
if ($actual -ne $expected) { throw 'APK_SIGNING_IDENTITY_MISMATCH' }

$sha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToUpperInvariant()
$versionLine = Select-String -Path (Join-Path $workerDir 'app\build.gradle.kts') -Pattern 'versionName\s*=\s*"([^"]+)"' | Select-Object -First 1
if (-not $versionLine) { throw 'WORKER_VERSION_NOT_FOUND' }
$version = $versionLine.Matches[0].Groups[1].Value
$git = Get-Command git.exe -ErrorAction SilentlyContinue
$sourceSha = if ($git) { (& $git.Source -C $RepoRoot rev-parse HEAD).Trim() } else { 'unknown' }

$releaseDir = Join-Path $ReleaseRoot $version
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$outApk = Join-Path $releaseDir "tigeriq-worker-$version.apk"
Copy-Item -LiteralPath $apk -Destination $outApk -Force
$manifest = [ordered]@{
  schema = 'tigeriq.android-worker.release.v1'
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  version = $version
  applicationId = 'ai.tigeriq.worker'
  sourceSha = $sourceSha
  apk = (Split-Path $outApk -Leaf)
  apkSha256 = $sha256
  certificateSha256 = $expected
  signingIdentity = 'stable-private-pc01'
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
  secretsPrinted = $false
} | ConvertTo-Json -Compress
