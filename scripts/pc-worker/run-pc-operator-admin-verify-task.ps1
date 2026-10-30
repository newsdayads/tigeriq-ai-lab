param(
  [Parameter(Mandatory=$true)]
  [string]$ReceiptPath
)

$ErrorActionPreference='Stop'
$TaskName='TigerIQ PC Operator Admin Verify'
$ExpectedUser='pc01\wdragons12x'
$Broker='D:\TigerIQ\Runtime\CoreSource\scripts\pc-worker\pc-operator-admin-verify-broker.ps1'
$RequestDir='D:\TigerIQ\State\pc-operator-admin'
$RequestPath=Join-Path $RequestDir 'verify-request.json'
$EvidenceRoot=[IO.Path]::GetFullPath('D:\TigerIQ\Evidence') + '\'
$Full=[IO.Path]::GetFullPath($ReceiptPath)

if(-not $Full.StartsWith($EvidenceRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'ADMIN_VERIFY_RECEIPT_PATH_NOT_ALLOWED'}
if([IO.Path]::GetExtension($Full) -ine '.json'){throw 'ADMIN_VERIFY_RECEIPT_EXTENSION_NOT_ALLOWED'}
if(-not [IO.Path]::GetFileName($Full).StartsWith('gh5365-admin-verify-',[StringComparison]::OrdinalIgnoreCase)){throw 'ADMIN_VERIFY_RECEIPT_NAME_NOT_ALLOWED'}
if([Security.Principal.WindowsIdentity]::GetCurrent().Name -ine $ExpectedUser){throw 'ADMIN_VERIFY_CALLER_IDENTITY_MISMATCH'}
if(-not (Test-Path -LiteralPath $Broker -PathType Leaf)){throw 'ADMIN_VERIFY_BROKER_MISSING'}
if(Test-Path -LiteralPath $Full){throw 'ADMIN_VERIFY_RECEIPT_ALREADY_EXISTS'}
if(Test-Path -LiteralPath $RequestPath){throw 'ADMIN_VERIFY_REQUEST_ALREADY_EXISTS'}

$Task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if(-not $Task){throw 'ADMIN_VERIFY_BROKER_NOT_INSTALLED'}
if($Task.Principal.UserId -ine $ExpectedUser){throw 'ADMIN_VERIFY_TASK_USER_MISMATCH'}
if(@('Highest','HighestAvailable','1') -notcontains [string]$Task.Principal.RunLevel){throw 'ADMIN_VERIFY_TASK_RUNLEVEL_MISMATCH'}
$TaskAction=@($Task.Actions)[0]
$ExpectedArguments='-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+$Broker+'"'
if([IO.Path]::GetFileName([string]$TaskAction.Execute) -ine 'powershell.exe'){throw 'ADMIN_VERIFY_TASK_EXECUTABLE_MISMATCH'}
if([string]$TaskAction.Arguments -ne $ExpectedArguments){throw 'ADMIN_VERIFY_TASK_BROKER_MISMATCH'}

New-Item -ItemType Directory -Path $RequestDir -Force | Out-Null
$Nonce=[guid]::NewGuid().ToString()
$Request=[ordered]@{
  schema='TIGERIQ_PC_OPERATOR_ADMIN_REQUEST_V1'
  action='verify_elevation'
  nonce=$Nonce
  receiptPath=$Full
  requestedAt=(Get-Date).ToUniversalTime().ToString('o')
  requestUser=[Security.Principal.WindowsIdentity]::GetCurrent().Name
}
$TempPath=Join-Path $RequestDir ($Nonce+'.tmp')
$Request | ConvertTo-Json -Compress | Set-Content -LiteralPath $TempPath -Encoding UTF8
Move-Item -LiteralPath $TempPath -Destination $RequestPath -ErrorAction Stop

try {
  Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $Deadline=(Get-Date).AddSeconds(45)
  while((Get-Date) -lt $Deadline -and -not (Test-Path -LiteralPath $Full)){
    Start-Sleep -Milliseconds 250
  }
  if(-not (Test-Path -LiteralPath $Full)){throw 'ADMIN_VERIFY_RECEIPT_TIMEOUT'}
  $Receipt=Get-Content -LiteralPath $Full -Raw | ConvertFrom-Json
  if($Receipt.schema -ne 'TIGERIQ_PC_OPERATOR_ADMIN_VERIFY_V1'){throw 'ADMIN_VERIFY_RECEIPT_SCHEMA_INVALID'}
  if($Receipt.action -ne 'verify_elevation'){throw 'ADMIN_VERIFY_RECEIPT_ACTION_INVALID'}
  if($Receipt.nonce -ne $Nonce){throw 'ADMIN_VERIFY_RECEIPT_NONCE_MISMATCH'}
  if($Receipt.elevated -ne $true -or $Receipt.isSystem -ne $false -or [int]$Receipt.fltmcExitCode -ne 0 -or $Receipt.accepted -ne $true){throw 'ADMIN_VERIFY_RECEIPT_NOT_ACCEPTED'}
}
finally {
  Remove-Item -LiteralPath $TempPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $RequestPath -Force -ErrorAction SilentlyContinue
}
$RequestDeleted=-not (Test-Path -LiteralPath $RequestPath)
$TaskPersistent=[bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
if(-not $RequestDeleted){throw 'ADMIN_VERIFY_REQUEST_CLEANUP_UNVERIFIED'}
if(-not $TaskPersistent){throw 'ADMIN_VERIFY_BROKER_TASK_MISSING_AFTER_RUN'}

[ordered]@{
  accepted=$true
  taskName=$TaskName
  taskPersistent=$TaskPersistent
  requestDeleted=$RequestDeleted
  receiptPath=$Full
  receipt=$Receipt
} | ConvertTo-Json -Compress -Depth 6
