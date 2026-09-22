param(
  [string]$InstallRoot='D:\TigerIQ\Apps\ChromeController',
  [string]$ConfigPath='D:\TigerIQ\Apps\ChromeController\Config\chrome-controller.json',
  [int]$PollSeconds=15
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

if($PollSeconds -lt 5 -or $PollSeconds -gt 120){throw 'APPCHROME_POLL_INTERVAL_OUT_OF_RANGE'}

$runtime=Join-Path $InstallRoot 'Runtime'
$activePath=Join-Path $runtime 'active-deploy.json'
$supervisorLog=Join-Path $runtime 'appchrome-supervisor.jsonl'
$tokenFile=Join-Path $runtime 'NV02-ProfileToken.value'
$ownerStatePath=Join-Path $runtime 'owner-interaction-state.json'
$lastHead=''
$supervisorEpoch=[guid]::NewGuid().ToString('N')
$supervisorMutex=[Threading.Mutex]::new($false,'Global\TigerIQ.AppChrome.Unified.Supervisor')
$ownsSupervisorMutex=$false
try{$ownsSupervisorMutex=$supervisorMutex.WaitOne(0)}catch{}
if(-not$ownsSupervisorMutex){exit 0}

function Write-SupervisorEvent([string]$Event,$Data=@{}){
  $payload=[ordered]@{ts=(Get-Date).ToUniversalTime().ToString('o');event=$Event}
  if($Data){
    foreach($p in $Data.GetEnumerator()){$payload[$p.Key]=$p.Value}
  }
  [IO.File]::AppendAllText($supervisorLog,(($payload|ConvertTo-Json -Compress -Depth 8)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
}

function Read-ValidatedActive{
  if(-not(Test-Path -LiteralPath $activePath)){throw "ACTIVE_DEPLOY_MISSING:$activePath"}
  $active=Get-Content -LiteralPath $activePath -Raw|ConvertFrom-Json
  $deploy=[string]$active.deploy
  $head=[string]$active.exactHead
  $bridgeHash=[string]$active.bridgeSha256
  if([string]::IsNullOrWhiteSpace($deploy)-or-not(Test-Path -LiteralPath $deploy)){throw "ACTIVE_DEPLOY_INVALID:$deploy"}
  if([string]::IsNullOrWhiteSpace($head)){throw 'ACTIVE_HEAD_MISSING'}
  if([string]::IsNullOrWhiteSpace($bridgeHash)){throw 'ACTIVE_BRIDGE_HASH_MISSING'}
  $versionPath=Join-Path $deploy 'VERSION.txt'
  if(-not(Test-Path -LiteralPath $versionPath)){throw "ACTIVE_VERSION_MISSING:$versionPath"}
  $version=(Get-Content -LiteralPath $versionPath -Raw).Trim()
  if($version-ne$head){throw "ACTIVE_VERSION_MISMATCH:$version"}
  $bridge=Join-Path $deploy 'apps\chrome-controller\direct-cdp-bridge.mjs'
  if(-not(Test-Path -LiteralPath $bridge)){throw "ACTIVE_BRIDGE_MISSING:$bridge"}
  $actualBridgeHash=(Get-FileHash -LiteralPath $bridge -Algorithm SHA256).Hash.ToLowerInvariant()
  if($actualBridgeHash-ne$bridgeHash.ToLowerInvariant()){throw 'ACTIVE_BRIDGE_HASH_MISMATCH'}
  [pscustomobject]@{deploy=$deploy;head=$head;bridgeHash=$bridgeHash;bridge=$bridge}
}

function Set-RuntimeEnvironment($Active){
  $env:TIGERIQ_CHROME_CONFIG=$ConfigPath
  $env:TIGERIQ_APPROVED_HEAD=$Active.head
  $env:TIGERIQ_DEPLOY_ROOT=$Active.deploy
  $env:TIGERIQ_NV02_BRIDGE_SHA256=$Active.bridgeHash
  $env:TIGERIQ_APPCHROME_SUPERVISOR_EPOCH=$supervisorEpoch
  $env:TIGERIQ_INTERACTIVE_SESSION='1'
  $env:TIGERIQ_SESSION_ID=[string](Get-Process -Id $PID).SessionId
  $env:TIGERIQ_WINDOWS_SESSION_ID=$env:TIGERIQ_SESSION_ID
  $env:SESSIONNAME='Console'
  if(Test-Path -LiteralPath $tokenFile){$env:TIGERIQ_NV02_WORKER_TOKEN=(Get-Content -LiteralPath $tokenFile -Raw).Trim()}
}

function Get-PortListener([int]$Port){
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue|Select-Object -First 1
}

function Owner-AutomationAllowed{
  try{
    if(Test-Path -LiteralPath $ownerStatePath){
      $state=Get-Content -LiteralPath $ownerStatePath -Raw|ConvertFrom-Json
      if($state.PSObject.Properties.Name -contains 'readOnly'){return -not[bool]$state.readOnly}
    }
  }catch{}
  return $true
}

function Get-TrustedListenerIdentity([int]$Port,[string]$ExpectedDeploy){
  try{
    if($Port -eq 8798){
      $state=Invoke-RestMethod -Uri 'http://127.0.0.1:8798/api/state' -TimeoutSec 3
      $deploy=[string]$state.runtimeProvenance.deployRoot
      if([string]::IsNullOrWhiteSpace($deploy) -or $deploy -notlike ($InstallRoot+'*')){
        return @{trusted=$false;current=$false;reason='CONTROLLER_PROVENANCE_INVALID'}
      }
      return @{trusted=$true;current=($deploy -eq $ExpectedDeploy);identity=('controller:'+ $deploy)}
    }
    if($Port -eq 8799){
      $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8799/health' -TimeoutSec 3
      $deploy=[string]$health.deployRoot
      if($health.ok -ne $true -or [string]::IsNullOrWhiteSpace($deploy) -or $deploy -notlike ($InstallRoot+'*')){
        return @{trusted=$false;current=$false;reason='BRIDGE_PROVENANCE_INVALID'}
      }
      return @{trusted=$true;current=($deploy -eq $ExpectedDeploy);identity=('bridge:'+ $deploy)}
    }
    if($Port -eq 8800){
      $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8800/health' -TimeoutSec 3
      $deploy=[string]$health.deployRoot
      $head=[string]$health.approvedHead
      if($health.ok -ne $true -or [string]$health.service -ne 'chrome-launch-broker' -or [string]::IsNullOrWhiteSpace($deploy) -or $deploy -notlike ($InstallRoot+'*') -or [string]::IsNullOrWhiteSpace($head)){
        return @{trusted=$false;current=$false;reason='BROKER_PROVENANCE_INVALID'}
      }
      return @{trusted=$true;current=($deploy -eq $ExpectedDeploy);identity=('broker:'+ $head+':'+ $deploy)}
    }
    return @{trusted=$false;current=$false;reason='UNSUPPORTED_PORT'}
  }catch{
    return @{trusted=$false;current=$false;reason=('PORT_IDENTITY_PROBE_FAILED:'+ $_.Exception.Message)}
  }
}

function Wait-Port([int]$Port,[int]$Seconds=30){
  $deadline=(Get-Date).AddSeconds($Seconds)
  do{
    if(Get-PortListener $Port){return}
    Start-Sleep -Milliseconds 500
  }while((Get-Date)-lt$deadline)
  throw "PORT_TIMEOUT:$Port"
}

function Stop-StaleTrustedListener([int]$Port,[string]$ExpectedDeploy){
  $listener=Get-PortListener $Port
  if(-not$listener){return $false}
  $ownerPid=[int]$listener.OwningProcess
  $identity=Get-TrustedListenerIdentity $Port $ExpectedDeploy
  if($identity.current){return $false}
  if(-not $identity.trusted){
    $again=Get-PortListener $Port
    if(-not $again -or [int]$again.OwningProcess -ne $ownerPid){return $true}
    throw "PORT_OWNED_BY_UNTRUSTED_PROCESS:${Port}:${ownerPid}:$($identity.reason)"
  }
  Write-SupervisorEvent 'STALE_RUNTIME_STOP' @{port=$Port;pid=$ownerPid;identity=$identity.identity;expectedDeploy=$ExpectedDeploy}
  Stop-Process -Id $ownerPid -Force -ErrorAction Stop
  $deadline=(Get-Date).AddSeconds(10)
  do{
    if(-not(Get-PortListener $Port)){return $true}
    Start-Sleep -Milliseconds 250
  }while((Get-Date)-lt$deadline)
  throw "STALE_PORT_DID_NOT_STOP:$Port"
}

function Start-Component([int]$Port,[string]$ScriptPath,[string[]]$Arguments,[string]$Name,$Active){
  $stale=Stop-StaleTrustedListener $Port $Active.deploy
  if(Get-PortListener $Port){return @{started=$false;staleStopped=$stale}}
  if(-not(Test-Path -LiteralPath $ScriptPath)){throw "COMPONENT_SCRIPT_MISSING:${Name}:$ScriptPath"}
  $out=Join-Path $runtime ($Name+'.out.log')
  $err=Join-Path $runtime ($Name+'.err.log')
  Start-Process node.exe -ArgumentList $Arguments -WorkingDirectory $Active.deploy -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
  Wait-Port $Port
  Write-SupervisorEvent 'COMPONENT_STARTED' @{name=$Name;port=$Port;head=$Active.head;deploy=$Active.deploy}
  @{started=$true;staleStopped=$stale}
}

function Wait-LiveVerified($Active,[int]$Seconds=30){
  $deadline=(Get-Date).AddSeconds($Seconds)
  $last=''
  do{
    try{
      $controller=Invoke-RestMethod -Uri 'http://127.0.0.1:8798/api/state' -TimeoutSec 4
      $bridge=Invoke-RestMethod -Uri 'http://127.0.0.1:8799/health' -TimeoutSec 4
      $controllerHead=[string]$controller.runtimeProvenance.approvedHead
      $bridgeHead=[string]$bridge.approvedHead
      $bridgeSource=[string]$bridge.sourceSha256
      if($controllerHead-eq$Active.head-and$bridgeHead-eq$Active.head-and$bridgeSource-eq$Active.bridgeHash){
        return [pscustomobject]@{controller=$controller;bridge=$bridge}
      }
      $last="HEAD_OR_HASH_MISMATCH:controller=${controllerHead}:bridge=${bridgeHead}:source=$bridgeSource"
    }catch{$last=$_.Exception.Message}
    Start-Sleep -Milliseconds 750
  }while((Get-Date)-lt$deadline)
  throw "APPCHROME_LIVE_VERIFY_TIMEOUT:$last"
}

function Ensure-AppChrome{
  $active=Read-ValidatedActive
  Set-RuntimeEnvironment $active
  $headChanged=$lastHead-ne$active.head

  $broker=Join-Path $active.deploy 'dist\apps\chrome-controller\src\chrome-launch-broker.js'
  $server=Join-Path $active.deploy 'dist\apps\chrome-controller\src\server.js'
  $b=Start-Component 8800 $broker @($broker,$ConfigPath) 'broker' $active
  $c=Start-Component 8798 $server @($server) 'controller' $active
  $g=Start-Component 8799 $active.bridge @($active.bridge) 'bridge' $active

  $live=Wait-LiveVerified $active
  $changed=$headChanged-or$b.started-or$c.started-or$g.started-or$b.staleStopped-or$c.staleStopped-or$g.staleStopped
  if($changed){
    if(Owner-AutomationAllowed){
      try{Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8798/api/resume' -TimeoutSec 5|Out-Null}catch{}
    }else{
      Write-SupervisorEvent 'OWNER_PAUSE_PRESERVED' @{head=$active.head}
    }
    Write-SupervisorEvent 'LIVE_VERIFIED' @{head=$active.head;deploy=$active.deploy;externalWorkAutopilotEnabled=[bool]$live.controller.externalWorkAutopilotEnabled}
  }
  $script:lastHead=$active.head
}

Write-SupervisorEvent 'SUPERVISOR_STARTED' @{pid=$PID;pollSeconds=$PollSeconds;supervisorEpoch=$supervisorEpoch}
try{
  while($true){
    try{Ensure-AppChrome}
    catch{
      Write-SupervisorEvent 'SUPERVISOR_RECOVERY_ERROR' @{error=$_.Exception.Message}
    }
    Start-Sleep -Seconds $PollSeconds
  }
}finally{
  if($ownsSupervisorMutex){try{$supervisorMutex.ReleaseMutex()}catch{}}
  $supervisorMutex.Dispose()
}
