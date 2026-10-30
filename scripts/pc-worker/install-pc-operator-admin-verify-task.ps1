param(
  [string]$ReceiptPath=''
)

$ErrorActionPreference='Stop'
$TaskName='TigerIQ PC Operator Admin Verify'
$ExpectedUser='pc01\wdragons12x'
$ExpectedSid=([Security.Principal.NTAccount]::new($ExpectedUser)).Translate([Security.Principal.SecurityIdentifier]).Value
$Broker='D:\TigerIQ\Runtime\CoreSource\scripts\pc-worker\pc-operator-admin-verify-broker.ps1'
$EvidenceRoot='D:\TigerIQ\Evidence'

$Identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$Principal=[Security.Principal.WindowsPrincipal]$Identity
$Elevated=$Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$IsSystem=$Identity.User.Value -eq 'S-1-5-18'
if($Identity.User.Value -ne $ExpectedSid){throw 'ADMIN_VERIFY_INSTALL_IDENTITY_MISMATCH'}
if(-not $Elevated){throw 'ADMIN_VERIFY_INSTALL_UAC_REQUIRED'}
if($IsSystem){throw 'ADMIN_VERIFY_INSTALL_SYSTEM_NOT_ALLOWED'}
if(-not (Test-Path -LiteralPath $Broker -PathType Leaf)){throw 'ADMIN_VERIFY_INSTALL_BROKER_MISSING'}

$Arguments='-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+$Broker+'"'
$Existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$AlreadyInstalled=$false
if($Existing){
  $ExistingAction=@($Existing.Actions)[0]
  $ExistingSid=([Security.Principal.NTAccount]::new([string]$Existing.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value
  $Matches=($ExistingSid -eq $ExpectedSid) -and
    (@('Highest','HighestAvailable','1') -contains [string]$Existing.Principal.RunLevel) -and
    ([IO.Path]::GetFileName([string]$ExistingAction.Execute) -ieq 'powershell.exe') -and
    ([string]$ExistingAction.Arguments -eq $Arguments)
  if(-not $Matches){throw 'ADMIN_VERIFY_INSTALL_EXISTING_TASK_MISMATCH'}
  $AlreadyInstalled=$true
}
else {
  $Action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Arguments
  $TaskPrincipal=New-ScheduledTaskPrincipal -UserId $ExpectedUser -LogonType Interactive -RunLevel Highest
  $Settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Principal $TaskPrincipal -Settings $Settings -ErrorAction Stop | Out-Null
}

$Task=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$TaskAction=@($Task.Actions)[0]
$TaskSid=([Security.Principal.NTAccount]::new([string]$Task.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value
if($TaskSid -ne $ExpectedSid){throw 'ADMIN_VERIFY_INSTALL_TASK_USER_MISMATCH'}
if(@('Highest','HighestAvailable','1') -notcontains [string]$Task.Principal.RunLevel){throw 'ADMIN_VERIFY_INSTALL_TASK_RUNLEVEL_MISMATCH'}
if([IO.Path]::GetFileName([string]$TaskAction.Execute) -ine 'powershell.exe'){throw 'ADMIN_VERIFY_INSTALL_TASK_EXECUTABLE_MISMATCH'}
if([string]$TaskAction.Arguments -ne $Arguments){throw 'ADMIN_VERIFY_INSTALL_TASK_ACTION_MISMATCH'}

if([string]::IsNullOrWhiteSpace($ReceiptPath)){
  $Stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
  $ReceiptPath=Join-Path $EvidenceRoot ('gh5365-admin-broker-install-'+$Stamp+'.json')
}
$Full=[IO.Path]::GetFullPath($ReceiptPath)
$Root=[IO.Path]::GetFullPath($EvidenceRoot) + '\'
if(-not $Full.StartsWith($Root,[StringComparison]::OrdinalIgnoreCase)){throw 'ADMIN_VERIFY_INSTALL_RECEIPT_PATH_NOT_ALLOWED'}
if([IO.Path]::GetExtension($Full) -ine '.json'){throw 'ADMIN_VERIFY_INSTALL_RECEIPT_EXTENSION_NOT_ALLOWED'}
$Receipt=[ordered]@{
  schema='TIGERIQ_PC_OPERATOR_ADMIN_BROKER_INSTALL_V1'
  installed=$true
  alreadyInstalled=$AlreadyInstalled
  taskName=$TaskName
  user=$Identity.Name
  elevated=$Elevated
  isSystem=$IsSystem
  runLevel=[string]$Task.Principal.RunLevel
  brokerPath=$Broker
  timestamp=(Get-Date).ToUniversalTime().ToString('o')
}
$Receipt | ConvertTo-Json -Compress | Set-Content -LiteralPath $Full -Encoding UTF8
$Receipt | ConvertTo-Json -Compress
