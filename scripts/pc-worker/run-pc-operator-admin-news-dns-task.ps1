param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('snapshot','cutover','rollback')]
  [string]$Action,
  [string]$ReceiptPath=''
)

$ErrorActionPreference='Stop'
$TaskName='TigerIQ PC Operator Admin Verify'
$ExpectedUser='pc01\wdragons12x'
$ExpectedSid=([Security.Principal.NTAccount]::new($ExpectedUser)).Translate([Security.Principal.SecurityIdentifier]).Value
$Broker='D:\TigerIQ\Runtime\CoreSource\scripts\pc-worker\pc-operator-admin-verify-broker.ps1'
$RequestDir='D:\TigerIQ\State\pc-operator-admin'
$RequestPath=Join-Path $RequestDir 'verify-request.json'
$EvidenceRoot=[IO.Path]::GetFullPath('D:\TigerIQ\Evidence') + '\'

if([string]::IsNullOrWhiteSpace($ReceiptPath)){
  $Stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
  $ReceiptPath=Join-Path $EvidenceRoot ('gh5648-news-dns-'+$Action+'-'+$Stamp+'.json')
}
$Full=[IO.Path]::GetFullPath($ReceiptPath)
if(-not $Full.StartsWith($EvidenceRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'NEWS_DNS_RECEIPT_PATH_NOT_ALLOWED'}
if([IO.Path]::GetExtension($Full) -ine '.json'){throw 'NEWS_DNS_RECEIPT_EXTENSION_NOT_ALLOWED'}
if(-not [IO.Path]::GetFileName($Full).StartsWith('gh5648-news-dns-',[StringComparison]::OrdinalIgnoreCase)){throw 'NEWS_DNS_RECEIPT_NAME_NOT_ALLOWED'}
if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne $ExpectedSid){throw 'NEWS_DNS_CALLER_IDENTITY_MISMATCH'}
if(-not (Test-Path -LiteralPath $Broker -PathType Leaf)){throw 'NEWS_DNS_BROKER_MISSING'}
if(Test-Path -LiteralPath $Full){throw 'NEWS_DNS_RECEIPT_ALREADY_EXISTS'}
if(Test-Path -LiteralPath $RequestPath){throw 'NEWS_DNS_REQUEST_ALREADY_EXISTS'}

$Task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if(-not $Task){throw 'NEWS_DNS_BROKER_NOT_INSTALLED'}
$TaskSid=([Security.Principal.NTAccount]::new([string]$Task.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value
if($TaskSid -ne $ExpectedSid){throw 'NEWS_DNS_TASK_USER_MISMATCH'}
if(@('Highest','HighestAvailable','1') -notcontains [string]$Task.Principal.RunLevel){throw 'NEWS_DNS_TASK_RUNLEVEL_MISMATCH'}
$TaskAction=@($Task.Actions)[0]
$ExpectedArguments='-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+$Broker+'"'
if([IO.Path]::GetFileName([string]$TaskAction.Execute) -ine 'powershell.exe'){throw 'NEWS_DNS_TASK_EXECUTABLE_MISMATCH'}
if([string]$TaskAction.Arguments -ne $ExpectedArguments){throw 'NEWS_DNS_TASK_BROKER_MISMATCH'}

$ActionMap=@{
  snapshot='news_dns_snapshot'
  cutover='news_dns_cutover'
  rollback='news_dns_rollback'
}
New-Item -ItemType Directory -Path $RequestDir -Force | Out-Null
$Nonce=[guid]::NewGuid().ToString()
$Request=[ordered]@{
  schema='TIGERIQ_PC_OPERATOR_ADMIN_REQUEST_V2'
  action=$ActionMap[$Action]
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
  $Deadline=(Get-Date).AddSeconds(100)
  while((Get-Date) -lt $Deadline -and -not (Test-Path -LiteralPath $Full)){
    Start-Sleep -Milliseconds 250
  }
  if(-not (Test-Path -LiteralPath $Full)){throw 'NEWS_DNS_RECEIPT_TIMEOUT'}
  $Receipt=Get-Content -LiteralPath $Full -Raw | ConvertFrom-Json
  if($Receipt.schema -ne 'TIGERIQ_NEWS_DNS_ACTION_V1'){throw 'NEWS_DNS_RECEIPT_SCHEMA_INVALID'}
  if($Receipt.action -ne $ActionMap[$Action]){throw 'NEWS_DNS_RECEIPT_ACTION_INVALID'}
  if($Receipt.nonce -ne $Nonce){throw 'NEWS_DNS_RECEIPT_NONCE_MISMATCH'}
  if($Receipt.accepted -ne $true){throw ('NEWS_DNS_ACTION_REJECTED: '+[string]$Receipt.error)}
}
finally {
  Remove-Item -LiteralPath $TempPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $RequestPath -Force -ErrorAction SilentlyContinue
}
$RequestDeleted=-not (Test-Path -LiteralPath $RequestPath)
$TaskPersistent=[bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
if(-not $RequestDeleted){throw 'NEWS_DNS_REQUEST_CLEANUP_UNVERIFIED'}
if(-not $TaskPersistent){throw 'NEWS_DNS_BROKER_TASK_MISSING_AFTER_RUN'}

[ordered]@{
  accepted=$true
  action=$Action
  taskName=$TaskName
  taskPersistent=$TaskPersistent
  requestDeleted=$RequestDeleted
  receiptPath=$Full
  receipt=$Receipt
} | ConvertTo-Json -Compress -Depth 8
