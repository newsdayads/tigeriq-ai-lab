param(
  [string]$InstallRoot='D:\TigerIQ\Apps\ChromeController',
  [string]$ConfigPath='D:\TigerIQ\Apps\ChromeController\Config\chrome-controller.json'
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$runtime=Join-Path $InstallRoot 'Runtime'
$activePath=Join-Path $runtime 'active-deploy.json'
if(-not (Test-Path $activePath)){throw "ACTIVE_DEPLOY_MISSING:$activePath"}
$active=Get-Content $activePath -Raw | ConvertFrom-Json
$deploy=[string]$active.deploy
$head=[string]$active.exactHead
$bridgeHash=[string]$active.bridgeSha256
if([string]::IsNullOrWhiteSpace($deploy) -or -not (Test-Path $deploy)){throw "ACTIVE_DEPLOY_INVALID:$deploy"}
if([string]::IsNullOrWhiteSpace($head)){throw 'ACTIVE_HEAD_MISSING'}
if([string]::IsNullOrWhiteSpace($bridgeHash)){throw 'ACTIVE_BRIDGE_HASH_MISSING'}
$version=(Get-Content (Join-Path $deploy 'VERSION.txt') -Raw).Trim()
if($version -ne $head){throw "ACTIVE_VERSION_MISMATCH:$version"}
$bridge=Join-Path $deploy 'apps\chrome-controller\direct-cdp-bridge.mjs'
$actualBridgeHash=(Get-FileHash $bridge -Algorithm SHA256).Hash.ToLowerInvariant()
if($actualBridgeHash -ne $bridgeHash.ToLowerInvariant()){throw 'ACTIVE_BRIDGE_HASH_MISMATCH'}

$env:TIGERIQ_CHROME_CONFIG=$ConfigPath
$env:TIGERIQ_APPROVED_HEAD=$head
$env:TIGERIQ_DEPLOY_ROOT=$deploy
$env:TIGERIQ_NV02_BRIDGE_SHA256=$bridgeHash
$env:TIGERIQ_INTERACTIVE_SESSION='1'
$env:TIGERIQ_SESSION_ID=[string](Get-Process -Id $PID).SessionId
$env:TIGERIQ_WINDOWS_SESSION_ID=$env:TIGERIQ_SESSION_ID
$env:SESSIONNAME='Console'
$tokenFile=Join-Path $runtime 'NV02-ProfileToken.value'
if(Test-Path $tokenFile){$env:TIGERIQ_NV02_WORKER_TOKEN=(Get-Content $tokenFile -Raw).Trim()}

function Wait-Port([int]$Port,[int]$Seconds=30){
  $deadline=(Get-Date).AddSeconds($Seconds)
  do{
    if(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue){return}
    Start-Sleep -Milliseconds 500
  }while((Get-Date)-lt $deadline)
  throw "PORT_TIMEOUT:$Port"
}

if(-not(Get-NetTCPConnection -LocalPort 8800 -State Listen -ErrorAction SilentlyContinue)){
  $broker=Join-Path $deploy 'dist\apps\chrome-controller\src\chrome-launch-broker.js'
  Start-Process node.exe -ArgumentList @($broker,$ConfigPath) -WorkingDirectory $deploy -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'broker.out.log') -RedirectStandardError (Join-Path $runtime 'broker.err.log')
  Wait-Port 8800
}
if(-not(Get-NetTCPConnection -LocalPort 8798 -State Listen -ErrorAction SilentlyContinue)){
  $server=Join-Path $deploy 'dist\apps\chrome-controller\src\server.js'
  Start-Process node.exe -ArgumentList @($server) -WorkingDirectory $deploy -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'controller.out.log') -RedirectStandardError (Join-Path $runtime 'controller.err.log')
  Wait-Port 8798
}
if(-not(Get-NetTCPConnection -LocalPort 8799 -State Listen -ErrorAction SilentlyContinue)){
  Start-Process node.exe -ArgumentList @($bridge) -WorkingDirectory $deploy -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'bridge.out.log') -RedirectStandardError (Join-Path $runtime 'bridge.err.log')
  Wait-Port 8799
}
try{Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8798/api/resume' -TimeoutSec 5|Out-Null}catch{}
