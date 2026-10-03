$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$ExpectedUser='pc01\wdragons12x'
$TaskName='TigerIQ Android v0.20 OneShot Signer'
$Wrapper='D:\TigerIQ\Runtime\CoreSource\scripts\pc-worker\sign-v020-reviewed-artifact.ps1'
$ReceiptPath='D:\TigerIQ\Evidence\AndroidWorker\v0.20\user-context-sign-receipt.json'
$identity=''
$identitySid=''

function Resolve-AccountSid([string]$account) {
  try{return (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value}catch{return ''}
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
