$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$TaskName='TigerIQ Android v0.21 OneShot Signer'
$ExpectedUser='pc01\wdragons12x'
$Runner='D:\TigerIQ\Runtime\CoreSource\scripts\pc-worker\invoke-v021-user-context-signer.ps1'
$ReceiptPath='D:\TigerIQ\Evidence\AndroidWorker\v0.21\user-context-sign-receipt.json'
$PowerShell='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$registered=$false;$cleanupOk=$true;$failure=$null;$receipt=$null

function Resolve-AccountSid([string]$account){try{return (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value}catch{return ''}}
function Test-InteractiveTokenLogon([string]$value){return @('Interactive','InteractiveToken','3') -contains $value}
function Test-SignerRunLevel([string]$value){return @('Highest','HighestAvailable','1') -contains $value}
function Safe-BridgeFailureCode([string]$message){
  $allowed=@(
    'V021_USER_CONTEXT_UNAVAILABLE','V021_USER_CONTEXT_RUNNER_MISSING','V021_USER_CONTEXT_TASK_COLLISION',
    'V021_USER_CONTEXT_TASK_REGISTER_FAILED','V021_USER_CONTEXT_TASK_USER_MISMATCH','V021_USER_CONTEXT_TASK_LOGON_MISMATCH',
    'V021_USER_CONTEXT_TASK_RUNLEVEL_MISMATCH','V021_USER_CONTEXT_TASK_START_FAILED','V021_USER_CONTEXT_TASK_TIMEOUT',
    'V021_USER_CONTEXT_RECEIPT_INVALID','V021_USER_CONTEXT_IDENTITY_MISMATCH','V021_USER_CONTEXT_SIGN_FAILED',
    'DPAPI_PASSWORD_DECRYPT_FAILED','V021_USER_CONTEXT_ARTIFACT_READ_DENIED','V021_USER_CONTEXT_SIGNING_BUNDLE_READ_DENIED',
    'V021_USER_CONTEXT_RELEASE_WRITE_DENIED','V021_USER_CONTEXT_WRAPPER_UNCLASSIFIED','STABLE_SIGNING_DIR_REQUIRED',
    'STABLE_SIGNING_ALIAS_REQUIRED','CANONICAL_SIGNING_IDENTITY_RECOVERY_REQUIRED','OUTPUT_APK_MUST_DIFFER_FROM_UNSIGNED_APK',
    'APKSIGNER_JAR_SHA256_REQUIRED','JAVA_RUNTIME_REQUIRED','ANDROID_BUILD_TOOL_REQUIRED','ANDROID_BUILD_TOOL_FAILED',
    'APK_CERTIFICATE_FINGERPRINT_NOT_FOUND','APK_V2_SIGNATURE_REQUIRED','APK_V3_SIGNATURE_REQUIRED','V021_SIGN_INPUT_MISSING',
    'V021_UNSIGNED_SHA256_MISMATCH','V021_APKSIGNER_JAR_SHA256_MISMATCH','V021_GIT_REQUIRED','V021_RELEASE_SOURCE_SHA_INVALID',
    'V021_ANDROID_TREE_SHA_INVALID','V021_ANDROID_SOURCE_DRIFT','V021_JAVA_REQUIRED','V021_SIGNER_RECEIPT_MISSING',
    'V021_SIGNER_RECEIPT_INVALID','V021_SIGNER_STATUS_INVALID','V021_SIGNER_IDENTITY_MISMATCH','V021_SIGNATURE_SCHEME_INVALID',
    'V021_PASSWORD_TRANSPORT_INVALID','V021_SECRET_SAFETY_VIOLATION','V021_APKSIGNER_MODE_INVALID','V021_PREALIGNED_RECEIPT_INVALID',
    'V021_SIGNED_APK_MISSING','V021_SIGNED_SHA256_MISMATCH','APKSIGNER_FAILED','APK_SIGNATURE_VERIFY_FAILED','APK_SIGNING_IDENTITY_MISMATCH'
  )
  foreach($code in $allowed){if($message-match[regex]::Escape($code)){return $code}};return 'V021_USER_CONTEXT_SIGN_FAILED'
}
function Assert-ExistingTaskSafe($task){
  if(-not $task){return};$principal=[string]$task.Principal.UserId;$principalSid=Resolve-AccountSid $principal;$expectedSid=Resolve-AccountSid $ExpectedUser
  $logonType=[string]$task.Principal.LogonType;$runLevel=[string]$task.Principal.RunLevel;$action=@($task.Actions|Select-Object -First 1)
  $exe=[string]$action.Execute;$args=[string]$action.Arguments
  if(-not $principalSid -or -not $expectedSid -or $principalSid-ne$expectedSid -or -not(Test-InteractiveTokenLogon $logonType) -or -not(Test-SignerRunLevel $runLevel) -or $exe-ine$PowerShell -or $args-notmatch[regex]::Escape($Runner)){throw 'V021_USER_CONTEXT_TASK_COLLISION'}
}

try{
  if(-not(Test-Path -LiteralPath $Runner -PathType Leaf)){throw 'V021_USER_CONTEXT_RUNNER_MISSING'}
  $expectedSid=Resolve-AccountSid $ExpectedUser;$activeUser=[string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName;$activeSid=Resolve-AccountSid $activeUser
  if(-not $expectedSid -or -not $activeSid -or $activeSid-ne$expectedSid){throw 'V021_USER_CONTEXT_UNAVAILABLE'}
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReceiptPath)|Out-Null;Remove-Item -LiteralPath $ReceiptPath -Force -ErrorAction SilentlyContinue
  $existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if($existing){Assert-ExistingTaskSafe $existing;if([string]$existing.State-eq'Running'){Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue};Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop}
  $args="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Runner`""
  $action=New-ScheduledTaskAction -Execute $PowerShell -Argument $args
  $principal=New-ScheduledTaskPrincipal -UserId $ExpectedUser -LogonType Interactive -RunLevel Highest
  $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
  $task=New-ScheduledTask -Action $action -Principal $principal -Settings $settings
  Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force -ErrorAction Stop|Out-Null;$registered=$true
  $fresh=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop;$freshUserSid=Resolve-AccountSid ([string]$fresh.Principal.UserId)
  if(-not $freshUserSid -or $freshUserSid-ne$expectedSid){throw 'V021_USER_CONTEXT_TASK_USER_MISMATCH'}
  if(-not(Test-InteractiveTokenLogon ([string]$fresh.Principal.LogonType))){throw 'V021_USER_CONTEXT_TASK_LOGON_MISMATCH'}
  if(-not(Test-SignerRunLevel ([string]$fresh.Principal.RunLevel))){throw 'V021_USER_CONTEXT_TASK_RUNLEVEL_MISMATCH'}
  Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $deadline=(Get-Date).AddSeconds(105);while((Get-Date)-lt$deadline){if(Test-Path -LiteralPath $ReceiptPath -PathType Leaf){break};Start-Sleep -Milliseconds 750}
  if(-not(Test-Path -LiteralPath $ReceiptPath -PathType Leaf)){throw 'V021_USER_CONTEXT_TASK_TIMEOUT'}
  try{$receipt=Get-Content -LiteralPath $ReceiptPath -Raw|ConvertFrom-Json -ErrorAction Stop}catch{throw 'V021_USER_CONTEXT_RECEIPT_INVALID'}
  if([string]$receipt.status-ne'ANDROID_WORKER_STABLE_RELEASE_READY'){$code=[string]$receipt.failure;if(-not $code){$code='V021_USER_CONTEXT_SIGN_FAILED'};throw $code}
  if([string]$receipt.executionIdentity -ine $ExpectedUser){throw 'V021_USER_CONTEXT_IDENTITY_MISMATCH'}
}catch{$failure=Safe-BridgeFailureCode ([string]$_.Exception.Message)}
finally{
  if($registered -or (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)){
    try{
      $current=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      if($current -and [string]$current.State-eq'Running'){$waitUntil=(Get-Date).AddSeconds(5);while((Get-Date)-lt$waitUntil -and [string](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State-eq'Running'){Start-Sleep -Milliseconds 250};$current=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;if($current -and [string]$current.State-eq'Running'){Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue}}
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    }catch{$cleanupOk=$false}
  }
}
if(-not $cleanupOk){[Console]::Error.WriteLine('V021_USER_CONTEXT_TASK_CLEANUP_FAILED');exit 1}
if($failure){[Console]::Error.WriteLine($failure);exit 1}
if(-not $receipt){[Console]::Error.WriteLine('V021_USER_CONTEXT_RECEIPT_MISSING');exit 1}
$out=[ordered]@{
  status=[string]$receipt.status;version=[string]$receipt.version;apkSha256=[string]$receipt.apkSha256
  unsignedApkSha256=[string]$receipt.unsignedApkSha256;certificateSha256=[string]$receipt.certificateSha256
  sourceSha=[string]$receipt.sourceSha;sourceArtifactSha=[string]$receipt.sourceArtifactSha
  sourceArtifactAndroidTreeSha=[string]$receipt.sourceArtifactAndroidTreeSha
  sourceWorkflowRunId=[string]$receipt.sourceWorkflowRunId;sourceArtifactId=[string]$receipt.sourceArtifactId
  signingIdentity=[string]$receipt.signingIdentity;passwordTransport=[string]$receipt.passwordTransport
  apksignerMode=[string]$receipt.apksignerMode;prealignedInput=[bool]$receipt.prealignedInput;secretsPrinted=[bool]$receipt.secretsPrinted
  executionIdentity=[string]$receipt.executionIdentity;taskName=$TaskName;taskPrincipal=$ExpectedUser;taskLogonType='InteractiveToken';taskRunLevel='Highest';taskDeleted=$true
}
$out|ConvertTo-Json -Compress
