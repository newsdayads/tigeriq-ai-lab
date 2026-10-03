param(
  [string]$SecretsDir = $env:TIGERIQ_ANDROID_SIGNING_DIR,
  [string]$Alias = $env:TIGERIQ_ANDROID_KEY_ALIAS
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$CanonicalCertificateSha256 = '63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293'
if ([string]::IsNullOrWhiteSpace($SecretsDir)) {
  throw 'STABLE_SIGNING_DIR_REQUIRED: point to the recovered existing canonical signer; never generate a replacement identity.'
}

$KeyStorePath = Join-Path $SecretsDir 'tigeriq-worker.jks'
$StorePasswordPath = Join-Path $SecretsDir 'store-password.txt'
$KeyPasswordPath = Join-Path $SecretsDir 'key-password.txt'
$FingerprintPath = Join-Path $SecretsDir 'certificate-sha256.txt'
$AliasPath = Join-Path $SecretsDir 'key-alias.txt'

foreach ($required in @($KeyStorePath,$StorePasswordPath,$KeyPasswordPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw 'CANONICAL_SIGNING_IDENTITY_RECOVERY_REQUIRED: existing canonical signer material is incomplete; do not create a new key.'
  }
}
if ([string]::IsNullOrWhiteSpace($Alias) -and (Test-Path -LiteralPath $AliasPath -PathType Leaf)) {
  $Alias = [IO.File]::ReadAllText($AliasPath).Trim()
}
if ([string]::IsNullOrWhiteSpace($Alias)) { throw 'STABLE_SIGNING_ALIAS_REQUIRED' }

$keytool = Get-Command keytool.exe -ErrorAction SilentlyContinue
if (-not $keytool) { throw 'KEYTOOL_MISSING: install/use a JDK before verifying the signing identity.' }

$store = [IO.File]::ReadAllText($StorePasswordPath).Trim()
$certificate = & $keytool.Source -list -v -keystore $KeyStorePath -storepass $store -alias $Alias 2>$null
if ($LASTEXITCODE -ne 0) { throw 'KEYSTORE_VERIFY_FAILED' }
$fingerprintLine = $certificate | Where-Object { $_ -match '^\s*SHA256:\s*' } | Select-Object -First 1
if (-not $fingerprintLine) { throw 'CERTIFICATE_FINGERPRINT_NOT_FOUND' }
$fingerprint = ($fingerprintLine -replace '^\s*SHA256:\s*','').Trim().Replace(':','').ToUpperInvariant()
if ($fingerprint -ne $CanonicalCertificateSha256) {
  throw 'SIGNING_IDENTITY_CHANGED: recovered signer does not match the established TigerIQ Android certificate.'
}

if (Test-Path -LiteralPath $FingerprintPath -PathType Leaf) {
  $expected = [IO.File]::ReadAllText($FingerprintPath).Trim().Replace(':','').ToUpperInvariant()
  if ($expected -ne $CanonicalCertificateSha256) { throw 'SIGNING_IDENTITY_CHANGED: pinned fingerprint file is not canonical.' }
}

[ordered]@{
  status = 'STABLE_SIGNING_READY'
  alias = $Alias
  keystore = $KeyStorePath
  certificateSha256 = $CanonicalCertificateSha256
  secretsPrinted = $false
  identityCreated = $false
} | ConvertTo-Json -Compress
