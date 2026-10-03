$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$ExpectedUser='pc01\wdragons12x'
$TaskName='TigerIQ Android v0.20 OneShot Signer'
$Wrapper='D:\TigerIQ\Runtime\CoreSource\scripts\pc-worker\sign-v020-reviewed-artifact.ps1'
$ReceiptPath='D:\TigerIQ\Evidence\AndroidWorker\v0.20\user-context-sign-receipt.json'
$UnsignedApk='D:\TigerIQ\Releases\AndroidWorker\ci-artifact\v0.20\tigeriq-worker-unsigned-release.apk'
$ApkSignerJar='D:\TigerIQ\Releases\AndroidWorker\ci-artifact\v0.20\apksigner.jar'
$SecretsDir='D:\TigerIQ\Secrets\AndroidSigning'
$ReleaseDir='D:\TigerIQ\Releases\AndroidWorker\signed\0.20.0-update-lease-guard'
$identity=''
$identitySid=''

function Resolve-AccountSid([string]$account) {
  try{return (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value}catch{return ''}
}

function Test-FileReadable([string]$path) {
  try {
    $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
    $stream.Dispose()
    return $true
  } catch { return $false }
}

function Test-ReleaseWritable {
  $probe=Join-Path $ReleaseDir '.user-context-write-probe.tmp'
  try {
    New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
    [IO.File]::WriteAllText($probe,'ok',(New-Object Text.UTF8Encoding($false)))
    Remove-Item -LiteralPath $probe -Force -ErrorAction Stop
    return $true
  } catch {
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    return $false
  }
}

function Write-SafeReceipt($value) {
  $dir=Split-Path -Parent $ReceiptPath
  New-Item -ItemType Directory -Force -Path $dir|Out-Null
  $json=$value|ConvertTo-Json -Compress -Depth 5
  [IO.File]::WriteAllText($ReceiptPath,$json,(New-Object Text.UTF8Encoding($false)))
}

function Safe-FailureCode([string]$message) {
  $allowed=@(
    'DPAPI_PASSWORD_DECRYPT_FAILED',
    'V020_USER_CONTEXT_ARTIFACT_READ_DENIED',
    'V020_USER_CONTEXT_SIGNING_BUNDLE_READ_DENIED',
    'V020_USER_CONTEXT_RELEASE_WRITE_DENIED',
    'V020_USER_CONTEXT_WRAPPER_UNCLASSIFIED',
    'STABLE_SIGNING_DIR_REQUIRED',
    'STABLE_SIGNING_ALIAS_REQUIRED',
    'CANONICAL_SIGNING_IDENTITY_RECOVERY_REQUIRED',
    'OUTPUT_APK_MUST_DIFFER_FROM_UNSIGNED_APK',
    'APKSIGNER_JAR_SHA256_REQUIRED',
    'JAVA_RUNTIME_REQUIRED',
    'ANDROID_BUILD_TOOL_REQUIRED',
    'ANDROID_BUILD_TOOL_FAILED',
    'APK_CERTIFICATE_FINGERPRINT_NOT_FOUND',
    'APK_V2_SIGNATURE_REQUIRED',
    'APK_V3_SIGNATURE_REQUIRED',
    'V020_SIGN_INPUT_MISSING',
    'V020_UNSIGNED_SHA256_MISMATCH',
    'V020_APKSIGNER_JAR_SHA256_MISMATCH',
    'V020_JAVA_REQUIRED',
    'V020_SIGNER_RECEIPT_MISSING',
    'V020_SIGNER_RECEIPT_INVALID',
    'V020_SIGNER_STATUS_INVALID',
    'V020_SIGNER_IDENTITY_MISMATCH',
    'V020_SIGNATURE_SCHEME_INVALID',
    'V020_PASSWORD_TRANSPORT_INVALID',
    'V020_SECRET_SAFETY_VIOLATION',
    'V020_APKSIGNER_MODE_INVALID',
    'V020_PREALIGNED_RECEIPT_INVALID',
    'V020_SIGNED_APK_MISSING',
    'V020_SIGNED_SHA256_MISMATCH',
    'APKSIGNER_FAILED',
    'APK_SIGNATURE_VERIFY_FAILED',
    'APK_SIGNING_IDENTITY_MISMATCH'
  )
  foreach($code in $allowed){if($message -match [regex]::Escape($code)){return $code}}
  return 'V020_USER_CONTEXT_SIGN_FAILED'
}

try {
  $expectedSid=Resolve-AccountSid $ExpectedUser
  if(-not $expectedSid){throw 'V020_USER_CONTEXT_IDENTITY_MISMATCH'}
  $windowsIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $identity=$windowsIdentity.Name
  $identitySid=[string]$windowsIdentity.User.Value
  if($identitySid -ne $expectedSid){throw 'V020_USER_CONTEXT_IDENTITY_MISMATCH'}
  if(-not(Test-Path -LiteralPath $Wrapper -PathType Leaf)){throw 'V020_SIGN_INPUT_MISSING'}

  if(-not(Test-FileReadable $UnsignedApk) -or -not(Test-FileReadable $ApkSignerJar)){
    throw 'V020_USER_CONTEXT_ARTIFACT_READ_DENIED'
  }
  foreach($secretFile in @(
    (Join-Path $SecretsDir 'tigeriq-release.jks'),
    (Join-Path $SecretsDir 'signing-password.dpapi.txt'),
    (Join-Path $SecretsDir 'key-alias.txt')
  )){
    if(-not(Test-FileReadable $secretFile)){throw 'V020_USER_CONTEXT_SIGNING_BUNDLE_READ_DENIED'}
  }
  if(-not(Test-ReleaseWritable)){throw 'V020_USER_CONTEXT_RELEASE_WRITE_DENIED'}

  $output=& $Wrapper
  $line=$output|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
  if(-not $line){throw 'V020_SIGNER_RECEIPT_MISSING'}
  try{$receipt=$line|ConvertFrom-Json}catch{throw 'V020_SIGNER_RECEIPT_INVALID'}
  if([string]$receipt.status-ne'ANDROID_WORKER_STABLE_RELEASE_READY'){throw 'V020_SIGNER_STATUS_INVALID'}

  $safe=[ordered]@{
    status='ANDROID_WORKER_STABLE_RELEASE_READY'
    version=[string]$receipt.version
    apkSha256=[string]$receipt.apkSha256
    unsignedApkSha256=[string]$receipt.unsignedApkSha256
    certificateSha256=[string]$receipt.certificateSha256
    sourceSha=[string]$receipt.sourceSha
    sourceWorkflowRunId=[string]$receipt.sourceWorkflowRunId
    sourceArtifactId=[string]$receipt.sourceArtifactId
    signingIdentity=[string]$receipt.signingIdentity
    passwordTransport=[string]$receipt.passwordTransport
    apksignerMode=[string]$receipt.apksignerMode
    prealignedInput=[bool]$receipt.prealignedInput
    secretsPrinted=[bool]$receipt.secretsPrinted
    executionIdentity=$identity
    taskName=$TaskName
    taskPrincipal=$ExpectedUser
    taskLogonType='InteractiveToken'
    taskRunLevel='Limited'
  }
  Write-SafeReceipt $safe
  $safe|ConvertTo-Json -Compress
  exit 0
}catch{
  $code=Safe-FailureCode ([string]$_.Exception.Message)
  if($code -eq 'V020_USER_CONTEXT_SIGN_FAILED'){$code='V020_USER_CONTEXT_WRAPPER_UNCLASSIFIED'}
  Write-SafeReceipt ([ordered]@{
    status='FAILED'
    failure=$code
    executionIdentity=$identity
    taskName=$TaskName
    taskPrincipal=$ExpectedUser
    taskLogonType='InteractiveToken'
    taskRunLevel='Limited'
    secretsPrinted=$false
  })
  [Console]::Error.WriteLine($code)
  exit 1
}
