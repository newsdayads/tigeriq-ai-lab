$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$TaskName='TigerIQ Android Current Release Builder'
$ExpectedUser='pc01\wdragons12x'
$Runner='D:\TigerIQ\Runtime\CoreSource\scripts\pc-worker\invoke-current-user-context-release-build.ps1'
$ReceiptPath='D:\TigerIQ\Evidence\AndroidWorker\current-release-build-receipt.json'
$PowerShell='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$registered=$false;$cleanupOk=$true;$failure=$null;$receipt=$null

function Resolve-AccountSid([string]$account){try{return (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value}catch{return ''}}
function Test-InteractiveTokenLogon([string]$value){return @('Interactive','InteractiveToken','3') -contains $value}
function Test-SignerRunLevel([string]$value){return @('Highest','HighestAvailable','1') -contains $value}
function Assert-ExistingTaskSafe($task){
  if(-not $task){return}
  $principalSid=Resolve-AccountSid ([string]$task.Principal.UserId);$expectedSid=Resolve-AccountSid $ExpectedUser
  $logonType=[string]$task.Principal.LogonType;$runLevel=[string]$task.Principal.RunLevel;$action=@($task.Actions|Select-Object -First 1)
  if(-not $principalSid -or -not $expectedSid -or $principalSid-ne$expectedSid -or -not(Test-InteractiveTokenLogon $logonType) -or -not(Test-SignerRunLevel $runLevel) -or [string]$action.Execute-ine$PowerShell -or [string]$action.Arguments-notmatch[regex]::Escape($Runner)){throw 'CURRENT_RELEASE_TASK_COLLISION'}
}

try{
  if(-not(Test-Path -LiteralPath $Runner -PathType Leaf)){throw 'CURRENT_RELEASE_RUNNER_MISSING'}
  $expectedSid=Resolve-AccountSid $ExpectedUser;$activeUser=[string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName;$activeSid=Resolve-AccountSid $activeUser
  if(-not $expectedSid -or -not $activeSid -or $activeSid-ne$expectedSid){throw 'CURRENT_RELEASE_USER_CONTEXT_UNAVAILABLE'}
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReceiptPath)|Out-Null
  Remove-Item -LiteralPath $ReceiptPath -Force -ErrorAction SilentlyContinue
  $existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if($existing){Assert-ExistingTaskSafe $existing;if([string]$existing.State-eq'Running'){Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue};Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop}
  $args="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Runner`""
  $action=New-ScheduledTaskAction -Execute $PowerShell -Argument $args
  $principal=New-ScheduledTaskPrincipal -UserId $ExpectedUser -LogonType Interactive -RunLevel Highest
  $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
  $task=New-ScheduledTask -Action $action -Principal $principal -Settings $settings
  Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force -ErrorAction Stop|Out-Null;$registered=$true
  Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $deadline=(Get-Date).AddSeconds(180);while((Get-Date)-lt$deadline){if(Test-Path -LiteralPath $ReceiptPath -PathType Leaf){break};Start-Sleep -Milliseconds 750}
  if(-not(Test-Path -LiteralPath $ReceiptPath -PathType Leaf)){throw 'CURRENT_RELEASE_TASK_TIMEOUT'}
  try{$receipt=Get-Content -LiteralPath $ReceiptPath -Raw|ConvertFrom-Json -ErrorAction Stop}catch{throw 'CURRENT_RELEASE_RECEIPT_INVALID'}
  if([string]$receipt.status-ne'ANDROID_WORKER_STABLE_RELEASE_READY'){$failure=[string]$receipt.failure;if(-not $failure){$failure='CURRENT_RELEASE_BUILD_FAILED'};throw $failure}
  if([string]$receipt.executionIdentity -ine $ExpectedUser){throw 'CURRENT_RELEASE_IDENTITY_MISMATCH'}
}catch{$failure=[string]$_.Exception.Message}
finally{
  if($registered -or (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)){
    try{
      $current=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      if($current -and [string]$current.State-eq'Running'){Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue}
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    }catch{$cleanupOk=$false}
  }
}
if(-not $cleanupOk){[Console]::Error.WriteLine('CURRENT_RELEASE_TASK_CLEANUP_FAILED');exit 1}
if($failure){[Console]::Error.WriteLine($failure);exit 1}
if(-not $receipt){[Console]::Error.WriteLine('CURRENT_RELEASE_RECEIPT_MISSING');exit 1}
$out=[ordered]@{
  status=[string]$receipt.status;version=[string]$receipt.version;apk=[string]$receipt.apk;manifest=[string]$receipt.manifest
  apkSha256=[string]$receipt.apkSha256;certificateSha256=[string]$receipt.certificateSha256;sourceSha=[string]$receipt.sourceSha
  signingIdentity=[string]$receipt.signingIdentity;secretsPrinted=[bool]$receipt.secretsPrinted;executionIdentity=[string]$receipt.executionIdentity
  taskName=$TaskName;taskPrincipal=$ExpectedUser;taskLogonType='InteractiveToken';taskRunLevel='Highest';taskDeleted=$true
}
$out|ConvertTo-Json -Compress
