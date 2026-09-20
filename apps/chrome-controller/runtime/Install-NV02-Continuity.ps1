param(
  [Parameter(Mandatory=$true)][string]$ExpectedHead,
  [string]$SourceRef='main',
  [string]$RepoRoot='D:\TigerIQ\Workspace\issue1122-nv02',
  [string]$InstallRoot='D:\TigerIQ\Apps\ChromeController',
  [string]$ConfigPath='D:\TigerIQ\Apps\ChromeController\Config\chrome-controller.json',
  [string]$TaskName='TigerIQ Chrome Controller Workspace',
  [switch]$ResumeAutomation
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$runtime=Join-Path $InstallRoot 'Runtime'
$short=$ExpectedHead.Substring(0,[Math]::Min(7,$ExpectedHead.Length))
$deploy=Join-Path $InstallRoot ("Deploy-1122-"+$short)
$launcher=Join-Path $runtime 'Start-Workspace-826.ps1'
$manifest=Join-Path $runtime 'nv02-continuity-install.json'
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir=Join-Path $runtime ("backup-nv02-continuity-"+$stamp)
$previousLauncher=$null
$configBackup=$null
$pausedBefore=$false

function Assert-Ok([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Invoke-Native([string]$File,[string[]]$ArgumentList){
  Push-Location $RepoRoot
  try{
    & $File @ArgumentList
    if($LASTEXITCODE -ne 0){throw "NATIVE_FAILED:${File}:$LASTEXITCODE"}
  }finally{Pop-Location}
}
function Wait-Http([string]$Url,[int]$Seconds=30){
  $deadline=(Get-Date).AddSeconds($Seconds)
  do{
    Start-Sleep -Milliseconds 500
    try{
      $r=Invoke-RestMethod -Uri $Url -TimeoutSec 2
      if($null -ne $r){return $r}
    }catch{}
  }while((Get-Date)-lt $deadline)
  throw "HTTP_HEALTH_TIMEOUT:$Url"
}
function Stop-Port([int]$Port){
  $l=Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if($l){Stop-Process -Id $l.OwningProcess -Force -ErrorAction Stop}
}
function Start-Workspace{
  Assert-Ok (Test-Path $launcher) "LAUNCHER_NOT_FOUND:$launcher"
  & $launcher
  $controller=Wait-Http 'http://127.0.0.1:8798/api/state' 30
  $bridge=Wait-Http 'http://127.0.0.1:8799/health' 30
  return @{controller=$controller;bridge=$bridge}
}
function Set-OwnerMode([bool]$Automation){
  $uri=if($Automation){'http://127.0.0.1:8798/api/resume'}else{'http://127.0.0.1:8798/api/pause'}
  Invoke-RestMethod -Method Post -Uri $uri -TimeoutSec 10 | Out-Null
}
function Write-Launcher([string]$Root){
  $content=@"
`$ErrorActionPreference='Stop'
`$root='$Root'
`$runtime='$runtime'
`$config='$ConfigPath'
`$selfSession=(Get-Process -Id `$PID).SessionId
if(`$selfSession -eq 0){throw 'INTERACTIVE_SESSION_REQUIRED'}
`$env:TIGERIQ_CHROME_CONFIG=`$config
`$env:TIGERIQ_INTERACTIVE_SESSION='1'
`$env:TIGERIQ_SESSION_ID=[string]`$selfSession
`$env:SESSIONNAME='Console'
`$controller=Get-NetTCPConnection -LocalPort 8798 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if(-not `$controller){
  `$server=Join-Path `$root 'dist\apps\chrome-controller\src\server.js'
  Start-Process node.exe -ArgumentList `$server -WorkingDirectory `$root -WindowStyle Hidden -RedirectStandardOutput (Join-Path `$runtime 'controller.out.log') -RedirectStandardError (Join-Path `$runtime 'controller.err.log')
  Start-Sleep -Seconds 3
}
`$tokenFile=Join-Path `$runtime 'NV02-ProfileToken.value'
if(Test-Path `$tokenFile){`$env:TIGERIQ_NV02_WORKER_TOKEN=(Get-Content `$tokenFile -Raw).Trim()}
`$bridgeListener=Get-NetTCPConnection -LocalPort 8799 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if(-not `$bridgeListener){
  `$bridge=Join-Path `$root 'apps\chrome-controller\direct-cdp-bridge.mjs'
  Start-Process node.exe -ArgumentList `$bridge -WorkingDirectory `$root -WindowStyle Hidden -RedirectStandardOutput (Join-Path `$runtime 'bridge.out.log') -RedirectStandardError (Join-Path `$runtime 'bridge.err.log')
  Start-Sleep -Seconds 2
}
try{Invoke-RestMethod -Method Post 'http://127.0.0.1:8798/api/workers/NV02/enable' -TimeoutSec 5|Out-Null}catch{}
"@
  [IO.File]::WriteAllText($launcher,$content,[Text.UTF8Encoding]::new($false))
}

Assert-Ok (Test-Path $RepoRoot) "REPO_NOT_FOUND:$RepoRoot"
Assert-Ok (Test-Path $ConfigPath) "CONFIG_NOT_FOUND:$ConfigPath"
Assert-Ok (Test-Path $runtime) "RUNTIME_NOT_FOUND:$runtime"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

try{
  $status=(& git -C $RepoRoot status --porcelain)
  Assert-Ok ([string]::IsNullOrWhiteSpace(($status -join ''))) 'REPO_WORKTREE_NOT_CLEAN'
  Invoke-Native -File 'git' -ArgumentList @('-C',$RepoRoot,'fetch','origin',$SourceRef)
  $remote=(& git -C $RepoRoot rev-parse 'FETCH_HEAD').Trim()
  Assert-Ok ($remote -eq $ExpectedHead) "REMOTE_HEAD_MISMATCH:$remote"
  Invoke-Native -File 'git' -ArgumentList @('-C',$RepoRoot,'checkout','--detach',$ExpectedHead)
  $head=(& git -C $RepoRoot rev-parse 'HEAD').Trim()
  Assert-Ok ($head -eq $ExpectedHead) "LOCAL_HEAD_MISMATCH:$head"

  Invoke-Native -File 'npx' -ArgumentList @('vitest','run','tests/chrome-controller-autonomy-hardening.test.ts','tests/nv02-continuity.test.mjs')
  Invoke-Native -File 'npm' -ArgumentList @('run','typecheck')
  Invoke-Native -File 'npm' -ArgumentList @('run','build')

  if(Test-Path $launcher){
    $previousLauncher=Join-Path $backupDir 'Start-Workspace-826.ps1'
    Copy-Item $launcher $previousLauncher -Force
  }
  if(Test-Path $manifest){Copy-Item $manifest (Join-Path $backupDir 'nv02-continuity-install.json') -Force}
  $configBackup=Join-Path $backupDir 'chrome-controller.json'
  Copy-Item $ConfigPath $configBackup -Force
  $effectiveConfig=Get-Content $ConfigPath -Raw | ConvertFrom-Json
  Assert-Ok ($null -ne $effectiveConfig.autopilot) 'AUTOPILOT_CONFIG_MISSING'
  $effectiveConfig.autopilot.enabled=$false
  $effectiveConfig.autopilot.stateUrl=''
  [IO.File]::WriteAllText($ConfigPath,($effectiveConfig|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
  $effectiveConfig=Get-Content $ConfigPath -Raw | ConvertFrom-Json
  Assert-Ok ($effectiveConfig.autopilot.enabled -eq $false) 'APP_CHROME_AUTOPILOT_DISABLE_FAILED'
  Assert-Ok ([string]::IsNullOrWhiteSpace([string]$effectiveConfig.autopilot.stateUrl)) 'APP_CHROME_STATE_URL_DISABLE_FAILED'

  try{
    $state=Invoke-RestMethod -Uri 'http://127.0.0.1:8798/api/state' -TimeoutSec 3
    $pausedBefore=($state.ownerInteractionMode -eq 'READ_ONLY')
    Set-OwnerMode $false
  }catch{}

  if(-not (Test-Path $deploy)){
    New-Item -ItemType Directory -Path (Join-Path $deploy 'apps') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $deploy 'dist\apps') -Force | Out-Null
    Copy-Item (Join-Path $RepoRoot 'apps\chrome-controller') (Join-Path $deploy 'apps\chrome-controller') -Recurse
    Copy-Item (Join-Path $RepoRoot 'dist\apps\chrome-controller') (Join-Path $deploy 'dist\apps\chrome-controller') -Recurse
    Set-Content -Path (Join-Path $deploy 'VERSION.txt') -Value $ExpectedHead -Encoding ascii
  }else{
    $version=(Get-Content (Join-Path $deploy 'VERSION.txt') -Raw).Trim()
    Assert-Ok ($version -eq $ExpectedHead) "DEPLOY_VERSION_MISMATCH:$version"
  }

  Write-Launcher $deploy
  Stop-Port 8799
  Stop-Port 8798
  Start-Sleep -Seconds 1
  $started=Start-Workspace

  $controller=$started.controller
  $worker=@($controller.workers|Where-Object id -eq 'NV02')|Select-Object -First 1
  Assert-Ok ($null -ne $worker) 'NV02_STATE_MISSING'

  $deadline=(Get-Date).AddSeconds(30)
  do{
    Start-Sleep -Milliseconds 750
    $controller=Invoke-RestMethod -Uri 'http://127.0.0.1:8798/api/state' -TimeoutSec 3
    $worker=@($controller.workers|Where-Object id -eq 'NV02')|Select-Object -First 1
  }while((($null -eq $worker.lastHeartbeat) -or ($worker.lastHeartbeat.modelReady -ne $true)) -and (Get-Date)-lt $deadline)

  Assert-Ok ($null -ne $worker.lastHeartbeat) 'NV02_HEARTBEAT_MISSING'
  Assert-Ok ($worker.lastHeartbeat.modelReady -eq $true) 'NV02_MODEL_NOT_READY'
  Assert-Ok ([string]$worker.lastHeartbeat.reasoningEffort -eq 'high') 'NV02_REASONING_NOT_HIGH'
  Assert-Ok ([string]::IsNullOrWhiteSpace([string]$worker.lastHeartbeat.securityBlock)) 'NV02_SECURITY_BLOCK'

  $controllerPid=(Get-NetTCPConnection -LocalPort 8798 -State Listen|Select-Object -First 1).OwningProcess
  $bridgePid=(Get-NetTCPConnection -LocalPort 8799 -State Listen|Select-Object -First 1).OwningProcess
  $controllerCmd=(Get-CimInstance Win32_Process -Filter "ProcessId=$controllerPid").CommandLine
  $bridgeCmd=(Get-CimInstance Win32_Process -Filter "ProcessId=$bridgePid").CommandLine
  Assert-Ok ($controllerCmd -like "*$deploy*") 'CONTROLLER_NOT_RUNNING_DEPLOY_HEAD'
  Assert-Ok ($bridgeCmd -like "*$deploy*") 'BRIDGE_NOT_RUNNING_DEPLOY_HEAD'

  Set-OwnerMode ([bool]$ResumeAutomation)

  $result=[ordered]@{
    schemaVersion='tigeriq.nv02-continuity-install.v1'
    ok=$true
    exactHead=$ExpectedHead
    deployRoot=$deploy
    controllerPid=$controllerPid
    bridgePid=$bridgePid
    nv02State=$worker.status
    uiPhase=$worker.lastHeartbeat.uiPhase
    modelReady=$worker.lastHeartbeat.modelReady
    reasoningEffort=$worker.lastHeartbeat.reasoningEffort
    ownerInteractionMode=if($ResumeAutomation){'AUTOMATION'}else{'READ_ONLY'}
    chromeUiOnlyMode=$true
    externalWorkAutopilotEnabled=$false
    backupDir=$backupDir
    installedAt=(Get-Date).ToUniversalTime().ToString('o')
  }
  $result|ConvertTo-Json -Depth 6|Set-Content -Path $manifest -Encoding utf8
  $result|ConvertTo-Json -Depth 6
}catch{
  $message=$_.Exception.Message
  try{
    if($previousLauncher -and (Test-Path $previousLauncher)){Copy-Item $previousLauncher $launcher -Force}
    if($configBackup -and (Test-Path $configBackup)){Copy-Item $configBackup $ConfigPath -Force}
    Stop-Port 8799
    Stop-Port 8798
    Start-Sleep -Seconds 1
    Start-Workspace|Out-Null
    Set-OwnerMode (-not $pausedBefore)
  }catch{
    throw "NV02_PACKAGE_FAILED_AND_ROLLBACK_FAILED:$message :: $($_.Exception.Message)"
  }
  throw "NV02_PACKAGE_FAILED_ROLLBACK_APPLIED:$message"
}
