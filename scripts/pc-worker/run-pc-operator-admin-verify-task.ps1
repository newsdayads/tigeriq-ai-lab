param(
  [Parameter(Mandatory=$true)]
  [string]$ReceiptPath
)

$ErrorActionPreference='Stop'
$TaskName='TigerIQ PC Operator Admin Verify'
$ExpectedUser='pc01\wdragons12x'
$Runner='D:\TigerIQ\Runtime\CoreSource\scripts\pc-worker\pc-operator-admin-verify.ps1'
$EvidenceRoot=[IO.Path]::GetFullPath('D:\TigerIQ\Evidence') + '\'
$Full=[IO.Path]::GetFullPath($ReceiptPath)

if(-not $Full.StartsWith($EvidenceRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'ADMIN_VERIFY_RECEIPT_PATH_NOT_ALLOWED'}
if([IO.Path]::GetExtension($Full) -ine '.json'){throw 'ADMIN_VERIFY_RECEIPT_EXTENSION_NOT_ALLOWED'}
if(-not [IO.Path]::GetFileName($Full).StartsWith('gh5365-admin-verify-',[StringComparison]::OrdinalIgnoreCase)){throw 'ADMIN_VERIFY_RECEIPT_NAME_NOT_ALLOWED'}
if([Security.Principal.WindowsIdentity]::GetCurrent().Name -ine $ExpectedUser){throw 'ADMIN_VERIFY_CALLER_IDENTITY_MISMATCH'}
if(-not (Test-Path -LiteralPath $Runner -PathType Leaf)){throw 'ADMIN_VERIFY_RUNNER_MISSING'}
if(Test-Path -LiteralPath $Full){throw 'ADMIN_VERIFY_RECEIPT_ALREADY_EXISTS'}
if(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue){throw 'ADMIN_VERIFY_TASK_ALREADY_EXISTS'}

$Arguments='-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+$Runner+'" -ReceiptPath "'+$Full+'"'
$Action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Arguments
$Principal=New-ScheduledTaskPrincipal -UserId $ExpectedUser -LogonType Interactive -RunLevel Highest
$Settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

$Registered=$false
$TaskDeleted=$false
$Receipt=$null
try {
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Principal $Principal -Settings $Settings -ErrorAction Stop | Out-Null
  $Registered=$true

  $Task=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if($Task.Principal.UserId -ine $ExpectedUser){throw 'ADMIN_VERIFY_TASK_USER_MISMATCH'}
  if(@('Highest','HighestAvailable','1') -notcontains [string]$Task.Principal.RunLevel){throw 'ADMIN_VERIFY_TASK_RUNLEVEL_MISMATCH'}
  $TaskAction=@($Task.Actions)[0]
  if([IO.Path]::GetFileName([string]$TaskAction.Execute) -ine 'powershell.exe'){throw 'ADMIN_VERIFY_TASK_EXECUTABLE_MISMATCH'}
  if(([string]$TaskAction.Arguments).IndexOf($Runner,[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'ADMIN_VERIFY_TASK_RUNNER_MISMATCH'}
  if(([string]$TaskAction.Arguments).IndexOf($Full,[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'ADMIN_VERIFY_TASK_RECEIPT_MISMATCH'}

  Start-ScheduledTask -TaskName $TaskName
  $Deadline=(Get-Date).AddSeconds(45)
  while((Get-Date) -lt $Deadline -and -not (Test-Path -LiteralPath $Full)){
    Start-Sleep -Milliseconds 250
  }
  if(-not (Test-Path -LiteralPath $Full)){throw 'ADMIN_VERIFY_RECEIPT_TIMEOUT'}
  $Receipt=Get-Content -LiteralPath $Full -Raw | ConvertFrom-Json
  if($Receipt.schema -ne 'TIGERIQ_PC_OPERATOR_ADMIN_VERIFY_V1'){throw 'ADMIN_VERIFY_RECEIPT_SCHEMA_INVALID'}
  if($Receipt.action -ne 'verify_elevation'){throw 'ADMIN_VERIFY_RECEIPT_ACTION_INVALID'}
  if($Receipt.elevated -ne $true -or $Receipt.isSystem -ne $false -or [int]$Receipt.fltmcExitCode -ne 0 -or $Receipt.accepted -ne $true){throw 'ADMIN_VERIFY_RECEIPT_NOT_ACCEPTED'}
}
finally {
  if($Registered){
    try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop } catch {}
    $TaskDeleted = -not [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
  }
}
if(-not $TaskDeleted){throw 'ADMIN_VERIFY_TASK_CLEANUP_UNVERIFIED'}

[ordered]@{
  accepted=$true
  taskName=$TaskName
  taskDeleted=$TaskDeleted
  receiptPath=$Full
  receipt=$Receipt
} | ConvertTo-Json -Compress -Depth 6
