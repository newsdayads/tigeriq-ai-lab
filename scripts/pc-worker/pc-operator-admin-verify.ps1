param(
  [Parameter(Mandatory=$true)]
  [string]$ReceiptPath
)

$ErrorActionPreference='Stop'
$EvidenceRoot=[IO.Path]::GetFullPath('D:\TigerIQ\Evidence') + '\'
$Full=[IO.Path]::GetFullPath($ReceiptPath)
if(-not $Full.StartsWith($EvidenceRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'ADMIN_VERIFY_RECEIPT_PATH_NOT_ALLOWED'}
if([IO.Path]::GetExtension($Full) -ine '.json'){throw 'ADMIN_VERIFY_RECEIPT_EXTENSION_NOT_ALLOWED'}
if(-not [IO.Path]::GetFileName($Full).StartsWith('gh5365-admin-verify-',[StringComparison]::OrdinalIgnoreCase)){throw 'ADMIN_VERIFY_RECEIPT_NAME_NOT_ALLOWED'}

$Identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$Principal=[Security.Principal.WindowsPrincipal]$Identity
$Elevated=$Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$IsSystem=$Identity.User.Value -eq 'S-1-5-18'
& "$env:SystemRoot\System32\fltmc.exe" *> $null
$FltmcExitCode=$LASTEXITCODE

$Accepted=($Elevated -eq $true -and $IsSystem -eq $false -and $FltmcExitCode -eq 0)
$Receipt=[ordered]@{
  schema='TIGERIQ_PC_OPERATOR_ADMIN_VERIFY_V1'
  action='verify_elevation'
  user=$Identity.Name
  elevated=$Elevated
  isSystem=$IsSystem
  fltmcExitCode=$FltmcExitCode
  accepted=$Accepted
  timestamp=(Get-Date).ToUniversalTime().ToString('o')
}
$Receipt | ConvertTo-Json -Compress | Set-Content -LiteralPath $Full -Encoding UTF8
if(-not $Accepted){exit 5}
