param(
  [Parameter(Mandatory=$true)][string]$ExpectedSha,
  [Parameter(Mandatory=$true)][string]$ReleaseIssue,
  [Parameter(Mandatory=$true)][string]$ReleaseClass,
  [Parameter(Mandatory=$true)][string]$OwnerAuthorized,
  [Parameter(Mandatory=$true)][string]$ReleaseReason
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$TaskName='TigerIQ Vercel LIVE OneShot Deploy'
$ExpectedUser='pc01\wdragons12x'
$Runner='D:\TigerIQ\Runtime\CoreSource\scripts\pc-worker\invoke-vercel-user-context-deploy.ps1'
$RequestPath='D:\TigerIQ\Evidence\Vercel\live-r7-request.json'
$ReceiptPath='D:\TigerIQ\Evidence\Vercel\live-r7-receipt.json'
$PowerShell='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$registered=$false;$cleanupOk=$true;$failure=$null;$receipt=$null

function Resolve-AccountSid([string]$account){try{return (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value}catch{return ''}}
function Test-InteractiveTokenLogon([string]$value){return @('Interactive','InteractiveToken','3') -contains $value}
function Test-RunLevel([string]$value){return @('Highest','HighestAvailable','1') -contains $value}
function Fail([string]$code){throw $code}
function Assert-ExistingTaskSafe($task){
  if(-not $task){return}
  $principalSid=Resolve-AccountSid ([string]$task.Principal.UserId);$expectedSid=Resolve-AccountSid $ExpectedUser
  $action=@($task.Actions|Select-Object -First 1)
  if(-not $principalSid -or -not $expectedSid -or $principalSid-ne$expectedSid -or
     -not(Test-InteractiveTokenLogon ([string]$task.Principal.LogonType)) -or
     -not(Test-RunLevel ([string]$task.Principal.RunLevel)) -or
     [string]$action.Execute -ine $PowerShell -or [string]$action.Arguments -notmatch [regex]::Escape($Runner)){
    Fail 'VERCEL_USER_CONTEXT_TASK_COLLISION'
  }
}

try{
  if($ExpectedSha-notmatch'^[0-9a-fA-F]{40}$'){Fail 'VERCEL_USER_CONTEXT_SHA_INVALID'}
  if($ReleaseIssue-notmatch'^\d+$'){Fail 'VERCEL_USER_CONTEXT_ISSUE_INVALID'}
  if($ReleaseClass-ne'WEB_LIVE'){Fail 'VERCEL_USER_CONTEXT_RELEASE_CLASS_INVALID'}
  if($OwnerAuthorized-ne'true'){Fail 'VERCEL_USER_CONTEXT_OWNER_AUTH_REQUIRED'}
  if([string]::IsNullOrWhiteSpace($ReleaseReason)){Fail 'VERCEL_USER_CONTEXT_RELEASE_REASON_REQUIRED'}
  if(-not(Test-Path -LiteralPath $Runner -PathType Leaf)){Fail 'VERCEL_USER_CONTEXT_RUNNER_MISSING'}

  $expectedSid=Resolve-AccountSid $ExpectedUser
  $activeUser=[string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
  $activeSid=Resolve-AccountSid $activeUser
  if(-not $expectedSid -or -not $activeSid -or $activeSid-ne$expectedSid){Fail 'VERCEL_USER_CONTEXT_UNAVAILABLE'}

  $dir=Split-Path -Parent $RequestPath;New-Item -ItemType Directory -Force -Path $dir|Out-Null
  Remove-Item -LiteralPath $RequestPath,$ReceiptPath -Force -ErrorAction SilentlyContinue
  $request=[ordered]@{taskName=$TaskName;expectedUser=$ExpectedUser;expectedSha=$ExpectedSha.ToLowerInvariant();releaseIssue=$ReleaseIssue;releaseClass='WEB_LIVE';ownerAuthorized=$true;releaseReason=$ReleaseReason}
  [IO.File]::WriteAllText($RequestPath,($request|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))

  $existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if($existing){Assert-ExistingTaskSafe $existing;if([string]$existing.State-eq'Running'){Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue};Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop}
  $args="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Runner`""
  $action=New-ScheduledTaskAction -Execute $PowerShell -Argument $args
  $principal=New-ScheduledTaskPrincipal -UserId $ExpectedUser -LogonType Interactive -RunLevel Highest
  $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
  $task=New-ScheduledTask -Action $action -Principal $principal -Settings $settings
  Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force -ErrorAction Stop|Out-Null;$registered=$true
  $fresh=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if((Resolve-AccountSid ([string]$fresh.Principal.UserId))-ne$expectedSid){Fail 'VERCEL_USER_CONTEXT_TASK_USER_MISMATCH'}
  if(-not(Test-InteractiveTokenLogon ([string]$fresh.Principal.LogonType))){Fail 'VERCEL_USER_CONTEXT_TASK_LOGON_MISMATCH'}
  if(-not(Test-RunLevel ([string]$fresh.Principal.RunLevel))){Fail 'VERCEL_USER_CONTEXT_TASK_RUNLEVEL_MISMATCH'}
  Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop

  $deadline=(Get-Date).AddSeconds(115)
  while((Get-Date)-lt$deadline){if(Test-Path -LiteralPath $ReceiptPath -PathType Leaf){break};Start-Sleep -Milliseconds 750}
  if(-not(Test-Path -LiteralPath $ReceiptPath -PathType Leaf)){Fail 'VERCEL_USER_CONTEXT_TASK_TIMEOUT'}
  try{$receipt=Get-Content -LiteralPath $ReceiptPath -Raw|ConvertFrom-Json -ErrorAction Stop}catch{Fail 'VERCEL_USER_CONTEXT_RECEIPT_INVALID'}
  if([string]$receipt.status-ne'TIGERIQ_LIVE_3150_PRODUCTION_DEPLOYED'){
    $code=[string]$receipt.failure;if(-not $code){$code='VERCEL_USER_CONTEXT_DEPLOY_FAILED'};Fail $code
  }
  if([string]$receipt.executionIdentity -ine $ExpectedUser){Fail 'VERCEL_USER_CONTEXT_IDENTITY_MISMATCH'}
}catch{$failure=[string]$_.Exception.Message;if($failure-notmatch'^VERCEL_[A-Z0-9_]+$'){$failure='VERCEL_USER_CONTEXT_DEPLOY_FAILED'}}
finally{
  if($registered -or (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)){
    try{$current=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;if($current -and [string]$current.State-eq'Running'){Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue};Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop}catch{$cleanupOk=$false}
  }
  Remove-Item -LiteralPath $RequestPath -Force -ErrorAction SilentlyContinue
}
if(-not $cleanupOk){[Console]::Error.WriteLine('VERCEL_USER_CONTEXT_TASK_CLEANUP_FAILED');exit 1}
if($failure){[Console]::Error.WriteLine($failure);exit 1}
if(-not $receipt){[Console]::Error.WriteLine('VERCEL_USER_CONTEXT_RECEIPT_MISSING');exit 1}
$receipt|Add-Member -NotePropertyName taskDeleted -NotePropertyValue $true -Force
$receipt|ConvertTo-Json -Compress
