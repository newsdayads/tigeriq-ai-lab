$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedUser = 'pc01\wdragons12x'
$TaskName = 'TigerIQ Android Current OneShot Signer'
$RepoRoot = 'D:\TigerIQ\Runtime\CoreSource'
$MetadataPath = Join-Path $RepoRoot 'config\android-worker-current-ci-artifact.json'
$Wrapper = Join-Path $RepoRoot 'scripts\pc-worker\sign-current-reviewed-artifact.ps1'
$ReceiptPath = 'D:\TigerIQ\Evidence\AndroidWorker\current\user-context-sign-receipt.json'
$ArtifactDir = 'D:\TigerIQ\Releases\AndroidWorker\ci-artifact\current'
$UnsignedApk = Join-Path $ArtifactDir 'tigeriq-worker-unsigned-release.apk'
$ApkSignerJar = Join-Path $ArtifactDir 'apksigner.jar'
$SecretsDir = 'D:\TigerIQ\Secrets\AndroidSigning'
$identity = ''

function Resolve-AccountSid([string]$account) {
  try { return (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { return '' }
}
function Test-FileReadable([string]$path) {
  try {
    $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $stream.Dispose()
    return $true
  } catch {
    return $false
  }
}
function Write-SafeReceipt($value) {
  $dir = Split-Path -Parent $ReceiptPath
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  [IO.File]::WriteAllText($ReceiptPath, ($value | ConvertTo-Json -Compress -Depth 5), (New-Object Text.UTF8Encoding($false)))
}
function Safe-FailureCode([string]$message) {
  $allowed = @(
    'CURRENT_CI_METADATA_MISSING','CURRENT_CI_METADATA_INVALID','CURRENT_CI_METADATA_SCHEMA_INVALID','CURRENT_CI_METADATA_REPO_INVALID',
    'CURRENT_CI_METADATA_ARTIFACT_NAME_INVALID','CURRENT_CI_VERSION_INVALID','CURRENT_CI_HASH_INVALID','CURRENT_CI_SOURCE_INVALID',
    'CURRENT_CI_ID_INVALID','CURRENT_CI_SIGNER_PIN_MISMATCH','CURRENT_USER_CONTEXT_IDENTITY_MISMATCH',
    'CURRENT_USER_CONTEXT_ARTIFACT_READ_DENIED','CURRENT_USER_CONTEXT_SIGNING_BUNDLE_READ_DENIED','CURRENT_USER_CONTEXT_RELEASE_WRITE_DENIED',
    'CURRENT_SIGN_INPUT_MISSING','CURRENT_UNSIGNED_SHA256_MISMATCH','CURRENT_APKSIGNER_JAR_SHA256_MISMATCH','CURRENT_GIT_REQUIRED',
    'CURRENT_RELEASE_SOURCE_SHA_INVALID','CURRENT_ANDROID_TREE_SHA_INVALID','CURRENT_ANDROID_SOURCE_DRIFT','CURRENT_VERSION_SOURCE_MISMATCH',
    'CURRENT_JAVA_REQUIRED','CURRENT_SIGNER_RECEIPT_MISSING','CURRENT_SIGNER_RECEIPT_INVALID','CURRENT_SIGNER_STATUS_INVALID',
    'CURRENT_SIGNER_IDENTITY_MISMATCH','CURRENT_SIGNATURE_SCHEME_INVALID','CURRENT_PASSWORD_TRANSPORT_INVALID',
    'CURRENT_SECRET_SAFETY_VIOLATION','CURRENT_APKSIGNER_MODE_INVALID','CURRENT_PREALIGNED_RECEIPT_INVALID',
    'CURRENT_SIGNED_APK_MISSING','CURRENT_SIGNED_SHA256_MISMATCH','DPAPI_PASSWORD_DECRYPT_FAILED','STABLE_SIGNING_DIR_REQUIRED',
    'STABLE_SIGNING_ALIAS_REQUIRED','CANONICAL_SIGNING_IDENTITY_RECOVERY_REQUIRED','OUTPUT_APK_MUST_DIFFER_FROM_UNSIGNED_APK',
    'APKSIGNER_JAR_SHA256_REQUIRED','JAVA_RUNTIME_REQUIRED','ANDROID_BUILD_TOOL_REQUIRED','ANDROID_BUILD_TOOL_FAILED',
    'APKSIGNER_FAILED','APK_SIGNATURE_VERIFY_FAILED','APK_SIGNING_IDENTITY_MISMATCH'
  )
  foreach ($code in $allowed) {
    if ($message -match [regex]::Escape($code)) { return $code }
  }
  return 'CURRENT_USER_CONTEXT_WRAPPER_UNCLASSIFIED'
}

try {
  if (-not (Test-Path -LiteralPath $MetadataPath -PathType Leaf)) { throw 'CURRENT_CI_METADATA_MISSING' }
  try {
    $spec = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw 'CURRENT_CI_METADATA_INVALID'
  }
  $Version = [string]$spec.expectedVersion
  if ($Version -notmatch '^\d+\.\d+\.\d+[A-Za-z0-9._-]*$') { throw 'CURRENT_CI_VERSION_INVALID' }
  $ReleaseDir = Join-Path 'D:\TigerIQ\Releases\AndroidWorker\signed' $Version
  $probe = Join-Path $ReleaseDir '.current-user-context-write-probe.tmp'

  $expectedSid = Resolve-AccountSid $ExpectedUser
  if (-not $expectedSid) { throw 'CURRENT_USER_CONTEXT_IDENTITY_MISMATCH' }
  $windowsIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $identity = $windowsIdentity.Name
  if ([string]$windowsIdentity.User.Value -ne $expectedSid) { throw 'CURRENT_USER_CONTEXT_IDENTITY_MISMATCH' }
  if (-not (Test-Path -LiteralPath $Wrapper -PathType Leaf)) { throw 'CURRENT_SIGN_INPUT_MISSING' }
  if (-not (Test-FileReadable $UnsignedApk) -or -not (Test-FileReadable $ApkSignerJar)) { throw 'CURRENT_USER_CONTEXT_ARTIFACT_READ_DENIED' }
  foreach ($secretFile in @(
    (Join-Path $SecretsDir 'tigeriq-release.jks'),
    (Join-Path $SecretsDir 'signing-password.dpapi.txt'),
    (Join-Path $SecretsDir 'key-alias.txt')
  )) {
    if (-not (Test-FileReadable $secretFile)) { throw 'CURRENT_USER_CONTEXT_SIGNING_BUNDLE_READ_DENIED' }
  }
  try {
    New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
    [IO.File]::WriteAllText($probe, 'ok', (New-Object Text.UTF8Encoding($false)))
    Remove-Item -LiteralPath $probe -Force -ErrorAction Stop
  } catch {
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    throw 'CURRENT_USER_CONTEXT_RELEASE_WRITE_DENIED'
  }

  $output = & $Wrapper
  $line = $output | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Last 1
  if (-not $line) { throw 'CURRENT_SIGNER_RECEIPT_MISSING' }
  try {
    $receipt = $line | ConvertFrom-Json
  } catch {
    throw 'CURRENT_SIGNER_RECEIPT_INVALID'
  }
  if ([string]$receipt.status -ne 'ANDROID_WORKER_STABLE_RELEASE_READY') { throw 'CURRENT_SIGNER_STATUS_INVALID' }

  $safe = [ordered]@{
    status = [string]$receipt.status
    version = [string]$receipt.version
    apkSha256 = [string]$receipt.apkSha256
    unsignedApkSha256 = [string]$receipt.unsignedApkSha256
    certificateSha256 = [string]$receipt.certificateSha256
    sourceSha = [string]$receipt.sourceSha
    sourceArtifactSha = [string]$receipt.sourceArtifactSha
    sourceArtifactAndroidTreeSha = [string]$receipt.sourceArtifactAndroidTreeSha
    sourceWorkflowRunId = [string]$receipt.sourceWorkflowRunId
    sourceArtifactId = [string]$receipt.sourceArtifactId
    signingIdentity = [string]$receipt.signingIdentity
    passwordTransport = [string]$receipt.passwordTransport
    apksignerMode = [string]$receipt.apksignerMode
    prealignedInput = [bool]$receipt.prealignedInput
    secretsPrinted = [bool]$receipt.secretsPrinted
    executionIdentity = $identity
    taskName = $TaskName
    taskPrincipal = $ExpectedUser
    taskLogonType = 'InteractiveToken'
    taskRunLevel = 'Highest'
  }
  Write-SafeReceipt $safe
  $safe | ConvertTo-Json -Compress
  exit 0
} catch {
  $code = Safe-FailureCode ([string]$_.Exception.Message)
  Write-SafeReceipt ([ordered]@{
    status = 'FAILED'
    failure = $code
    executionIdentity = $identity
    taskName = $TaskName
    taskPrincipal = $ExpectedUser
    taskLogonType = 'InteractiveToken'
    taskRunLevel = 'Limited'
    secretsPrinted = $false
  })
  [Console]::Error.WriteLine($code)
  exit 1
}
