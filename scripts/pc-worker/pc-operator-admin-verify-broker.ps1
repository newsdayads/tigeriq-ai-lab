$ErrorActionPreference='Stop'
$ExpectedUser='pc01\wdragons12x'
$RequestPath='D:\TigerIQ\State\pc-operator-admin\verify-request.json'
$EvidenceRoot=[IO.Path]::GetFullPath('D:\TigerIQ\Evidence') + '\'

$Identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$Principal=[Security.Principal.WindowsPrincipal]$Identity
$Elevated=$Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$IsSystem=$Identity.User.Value -eq 'S-1-5-18'
if($Identity.Name -ine $ExpectedUser){throw 'ADMIN_VERIFY_BROKER_IDENTITY_MISMATCH'}
if(-not $Elevated){throw 'ADMIN_VERIFY_BROKER_NOT_ELEVATED'}
if($IsSystem){throw 'ADMIN_VERIFY_BROKER_SYSTEM_NOT_ALLOWED'}
if(-not (Test-Path -LiteralPath $RequestPath -PathType Leaf)){throw 'ADMIN_VERIFY_REQUEST_MISSING'}

$Request=Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
if($Request.schema -ne 'TIGERIQ_PC_OPERATOR_ADMIN_REQUEST_V1'){throw 'ADMIN_VERIFY_REQUEST_SCHEMA_INVALID'}
if($Request.action -ne 'verify_elevation'){throw 'ADMIN_VERIFY_REQUEST_ACTION_INVALID'}
if([string]$Request.requestUser -ine $ExpectedUser){throw 'ADMIN_VERIFY_REQUEST_USER_INVALID'}
$Nonce=[string]$Request.nonce
if($Nonce -notmatch '^[A-Za-z0-9-]{16,64}$'){throw 'ADMIN_VERIFY_REQUEST_NONCE_INVALID'}
$RequestedAt=[DateTimeOffset]::Parse([string]$Request.requestedAt)
$Age=((Get-Date).ToUniversalTime()-$RequestedAt.UtcDateTime).TotalSeconds
if($Age -lt -30 -or $Age -gt 120){throw 'ADMIN_VERIFY_REQUEST_STALE'}

$Full=[IO.Path]::GetFullPath([string]$Request.receiptPath)
if(-not $Full.StartsWith($EvidenceRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'ADMIN_VERIFY_RECEIPT_PATH_NOT_ALLOWED'}
if([IO.Path]::GetExtension($Full) -ine '.json'){throw 'ADMIN_VERIFY_RECEIPT_EXTENSION_NOT_ALLOWED'}
if(-not [IO.Path]::GetFileName($Full).StartsWith('gh5365-admin-verify-',[StringComparison]::OrdinalIgnoreCase)){throw 'ADMIN_VERIFY_RECEIPT_NAME_NOT_ALLOWED'}
if(Test-Path -LiteralPath $Full){throw 'ADMIN_VERIFY_RECEIPT_ALREADY_EXISTS'}

Remove-Item -LiteralPath $RequestPath -Force -ErrorAction Stop
& "$env:SystemRoot\System32\fltmc.exe" *> $null
$FltmcExitCode=$LASTEXITCODE
$Accepted=($Elevated -eq $true -and $IsSystem -eq $false -and $FltmcExitCode -eq 0)
$Receipt=[ordered]@{
  schema='TIGERIQ_PC_OPERATOR_ADMIN_VERIFY_V1'
  action='verify_elevation'
  nonce=$Nonce
  user=$Identity.Name
  elevated=$Elevated
  isSystem=$IsSystem
  fltmcExitCode=$FltmcExitCode
  accepted=$Accepted
  timestamp=(Get-Date).ToUniversalTime().ToString('o')
}
$Receipt | ConvertTo-Json -Compress | Set-Content -LiteralPath $Full -Encoding UTF8
if(-not $Accepted){exit 5}
