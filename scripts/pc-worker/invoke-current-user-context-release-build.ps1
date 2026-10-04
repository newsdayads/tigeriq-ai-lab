$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$ExpectedUser='pc01\wdragons12x'
$TaskName='TigerIQ Android Current Release Builder'
$Builder='D:\TigerIQ\Runtime\CoreSource\scripts\pc-worker\build-android-worker-release.ps1'
$ReceiptPath='D:\TigerIQ\Evidence\AndroidWorker\current-release-build-receipt.json'
$RepoRoot='D:\TigerIQ\Runtime\CoreSource'
$SecretsDir='D:\TigerIQ\Secrets\AndroidSigning'
$ReleaseRoot='D:\TigerIQ\Releases\AndroidWorker\signed'
$identity=''
$failure=$null

function Resolve-AccountSid([string]$account){try{return (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value}catch{return ''}}
function Write-SafeReceipt($value){
  $dir=Split-Path -Parent $ReceiptPath
  New-Item -ItemType Directory -Force -Path $dir|Out-Null
  [IO.File]::WriteAllText($ReceiptPath,($value|ConvertTo-Json -Compress -Depth 5),(New-Object Text.UTF8Encoding($false)))
}
function Safe-Code([string]$message){
  $allowed=@(
    'GRADLE_COMMAND_MISSING','ANDROID_RELEASE_BUILD_FAILED','UNSIGNED_APK_NOT_FOUND','DPAPI_SIGNER_HELPER_MISSING',
    'DPAPI_PASSWORD_DECRYPT_FAILED','DPAPI_SIGNER_RECEIPT_MISSING','DPAPI_SIGNER_RECEIPT_INVALID','DPAPI_SIGNER_STATUS_INVALID',
    'APK_SIGNING_IDENTITY_MISMATCH','APK_SIGNATURE_VERIFY_FAILED','SIGNING_SECRET_SAFETY_VIOLATION','SIGNED_APK_NOT_FOUND',
    'SIGNED_APK_SHA256_MISMATCH','STABLE_SIGNING_DIR_REQUIRED','STABLE_SIGNING_ALIAS_REQUIRED','STABLE_SIGNING_NOT_PROVISIONED',
    'ANDROID_APKSIGNER_DISCOVERY_NO_SDK_ROOT','ANDROID_APKSIGNER_DISCOVERY_NO_BUILD_TOOLS_DIR','ANDROID_APKSIGNER_DISCOVERY_BINARY_MISSING',
    'ANDROID_ZIPALIGN_DISCOVERY_NO_SDK_ROOT','ANDROID_ZIPALIGN_DISCOVERY_NO_BUILD_TOOLS_DIR','ANDROID_ZIPALIGN_DISCOVERY_BINARY_MISSING',
    'JAVA_RUNTIME_REQUIRED','ANDROID_BUILD_TOOL_REQUIRED','ANDROID_BUILD_TOOL_FAILED','APKSIGNER_FAILED','WORKER_VERSION_NOT_FOUND'
  )
  foreach($code in $allowed){if($message-match[regex]::Escape($code)){return $code}}
  return 'CURRENT_RELEASE_BUILD_FAILED'
}

try{
  $expectedSid=Resolve-AccountSid $ExpectedUser
  $current=[Security.Principal.WindowsIdentity]::GetCurrent()
  $identity=[string]$current.Name
  if(-not $expectedSid -or [string]$current.User.Value-ne$expectedSid){throw 'CURRENT_RELEASE_USER_CONTEXT_INVALID'}
  if(-not(Test-Path -LiteralPath $Builder -PathType Leaf)){throw 'CURRENT_RELEASE_BUILDER_MISSING'}
  $out=& $Builder -RepoRoot $RepoRoot -SecretsDir $SecretsDir -ReleaseRoot $ReleaseRoot
  $line=$out|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
  if(-not $line){throw 'CURRENT_RELEASE_RECEIPT_MISSING'}
  try{$receipt=$line|ConvertFrom-Json}catch{throw 'CURRENT_RELEASE_RECEIPT_INVALID'}
  if([string]$receipt.status-ne'ANDROID_WORKER_STABLE_RELEASE_READY'){throw 'CURRENT_RELEASE_STATUS_INVALID'}
  $safe=[ordered]@{
    status=[string]$receipt.status;version=[string]$receipt.version;apk=[string]$receipt.apk;manifest=[string]$receipt.manifest
    apkSha256=[string]$receipt.apkSha256;certificateSha256=[string]$receipt.certificateSha256;sourceSha=[string]$receipt.sourceSha
    signingIdentity=[string]$receipt.signingIdentity;secretsPrinted=[bool]$receipt.secretsPrinted;executionIdentity=$identity
    taskName=$TaskName;taskPrincipal=$ExpectedUser;taskLogonType='InteractiveToken';taskRunLevel='Highest'
  }
  Write-SafeReceipt $safe
  $safe|ConvertTo-Json -Compress
  exit 0
}catch{
  $failure=Safe-Code ([string]$_.Exception.Message)
  Write-SafeReceipt ([ordered]@{status='FAILED';failure=$failure;executionIdentity=$identity;taskName=$TaskName;taskPrincipal=$ExpectedUser;secretsPrinted=$false})
  [Console]::Error.WriteLine($failure)
  exit 1
}
