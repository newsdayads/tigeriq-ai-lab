# One-time LOCAL INTERACTIVE enrollment. Never execute this from ChatGPT/RDC or SYSTEM.
# Run on the physical PC01 session signed in as PC01\wdragons12x.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if($identity -cne 'PC01\wdragons12x'){throw 'LOCAL_INTERACTIVE_USER_REQUIRED'}
if(-not [Environment]::UserInteractive){throw 'LOCAL_INTERACTIVE_CONSOLE_REQUIRED'}
$store=Join-Path $env:LOCALAPPDATA 'TigerIQ\UltraCarSigner'
$ksPath=Join-Path $store 'keystore-pass.dpapi'
$keyPath=Join-Path $store 'key-pass.dpapi'
if((Test-Path -LiteralPath $ksPath) -or (Test-Path -LiteralPath $keyPath)){
  throw 'SECURE_STORE_ALREADY_ENROLLED_NO_OVERWRITE'
}
if(-not (Test-Path -LiteralPath $store)){
  New-Item -ItemType Directory -Path $store -Force | Out-Null
}
# Windows ConvertFrom-SecureString without -Key uses current-user DPAPI.
$ks=Read-Host -Prompt 'Existing UltraCar keystore password (PC01 console only)' -AsSecureString
$key=Read-Host -Prompt 'Existing UltraCar key password (PC01 console only)' -AsSecureString
try {
  if($ks.Length -eq 0 -or $key.Length -eq 0){throw 'EMPTY_PASSWORD_NOT_ALLOWED'}
  $ks | ConvertFrom-SecureString | Set-Content -LiteralPath $ksPath -Encoding ASCII -NoNewline
  $key | ConvertFrom-SecureString | Set-Content -LiteralPath $keyPath -Encoding ASCII -NoNewline
  Write-Output 'LOCAL_DPAPI_SIGNER_ENROLLED|IDENTITY=PC01\wdragons12x|SECRET_VALUES_NOT_EXPORTED'
} finally {
  if($ks){$ks.Dispose()}
  if($key){$key.Dispose()}
}
