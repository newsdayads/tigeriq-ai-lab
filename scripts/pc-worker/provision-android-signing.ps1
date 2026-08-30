param(
  [string]$SecretsDir = 'F:\TigerIQ\Secrets\android-worker-signing',
  [string]$Alias = 'tigeriq-worker-stable'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$KeyStorePath = Join-Path $SecretsDir 'tigeriq-worker.jks'
$StorePasswordPath = Join-Path $SecretsDir 'store-password.txt'
$KeyPasswordPath = Join-Path $SecretsDir 'key-password.txt'
$FingerprintPath = Join-Path $SecretsDir 'certificate-sha256.txt'

function New-RandomSecret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Protect-File([string]$Path) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
  Set-Acl -Path $Path -AclObject $acl
}

$keytool = Get-Command keytool.exe -ErrorAction SilentlyContinue
if (-not $keytool) { throw 'KEYTOOL_MISSING: install/use a JDK before provisioning the signing identity.' }
New-Item -ItemType Directory -Force -Path $SecretsDir | Out-Null

if (-not (Test-Path $KeyStorePath)) {
  $storePassword = New-RandomSecret
  $keyPassword = New-RandomSecret
  [IO.File]::WriteAllText($StorePasswordPath, $storePassword, (New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($KeyPasswordPath, $keyPassword, (New-Object Text.UTF8Encoding($false)))
  & $keytool.Source -genkeypair -v -keystore $KeyStorePath -storepass $storePassword -keypass $keyPassword -alias $Alias -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=TigerIQ Worker, OU=AI Lab, O=TigerIQ, L=Ho Chi Minh City, C=VN'
  if ($LASTEXITCODE -ne 0) { throw 'KEYSTORE_CREATE_FAILED' }
  Protect-File $KeyStorePath
  Protect-File $StorePasswordPath
  Protect-File $KeyPasswordPath
} elseif (-not (Test-Path $StorePasswordPath) -or -not (Test-Path $KeyPasswordPath)) {
  throw 'SIGNING_SECRET_INCOMPLETE: keystore exists but password files are missing.'
}

$store = [IO.File]::ReadAllText($StorePasswordPath).Trim()
$certificate = & $keytool.Source -list -v -keystore $KeyStorePath -storepass $store -alias $Alias 2>$null
if ($LASTEXITCODE -ne 0) { throw 'KEYSTORE_VERIFY_FAILED' }
$fingerprintLine = $certificate | Where-Object { $_ -match '^\s*SHA256:\s*' } | Select-Object -First 1
if (-not $fingerprintLine) { throw 'CERTIFICATE_FINGERPRINT_NOT_FOUND' }
$fingerprint = ($fingerprintLine -replace '^\s*SHA256:\s*','').Trim().ToUpperInvariant()

if (Test-Path $FingerprintPath) {
  $expected = [IO.File]::ReadAllText($FingerprintPath).Trim().ToUpperInvariant()
  if ($expected -ne $fingerprint) { throw 'SIGNING_IDENTITY_CHANGED: stable certificate fingerprint mismatch.' }
} else {
  [IO.File]::WriteAllText($FingerprintPath, $fingerprint, (New-Object Text.UTF8Encoding($false)))
  Protect-File $FingerprintPath
}

[ordered]@{
  status = 'STABLE_SIGNING_READY'
  alias = $Alias
  keystore = $KeyStorePath
  certificateSha256 = $fingerprint
  secretsPrinted = $false
} | ConvertTo-Json -Compress
