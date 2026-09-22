param([int]$IntervalSeconds=120)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$controlRepo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$runtimeRepo='D:\TigerIQ\Runtime\CoreSource'
$runtimeSourceState='D:\TigerIQ\State\core-runtime-source.json'
$updaterRuntime='D:\TigerIQ\Runtime\CoreUpdater\update-core-runtime.ps1'
$launcherRuntime='D:\TigerIQ\Runtime\CoreLaunchers'
$state='D:\TigerIQ\State\core-runtime-updater.json'
$openclawState='D:\TigerIQ\State\openclaw-runtime-applied.json'
$openclawCanaryState='D:\TigerIQ\State\openclaw-runtime-canary.json'
$openclawCli='D:\OpenClaw\npm-global\openclaw.cmd'
$openclawAgent='operator-local'
$openclawCanaryIssue=1430
$coreTask='TigerIQ Core 24x7'
$webTask='TigerIQ Web Control 24x7'
$codingTask='TigerIQ Coding Lane 24x7'
$openclawTask='TigerIQ OpenClaw Gateway'
$updaterTask='TigerIQ Core Runtime Updater'
$webRuntime='D:\TigerIQ\Runtime\WebControl24x7'
$tokenPath='D:\TigerIQ\Secrets\github-command-center.token'
$corePath=(Join-Path $runtimeRepo 'apps\tigeriq-core\core-entry.mjs').ToLowerInvariant()
$legacyCorePath=(Join-Path $controlRepo 'apps\tigeriq-core\core-entry.mjs').ToLowerInvariant()
$codingPath=(Join-Path $runtimeRepo 'apps\tigeriq-coding-lane\coding-entry.mjs').ToLowerInvariant()
$legacyCodingPath=(Join-Path $controlRepo 'apps\tigeriq-coding-lane\coding-entry.mjs').ToLowerInvariant()
$webPath=(Join-Path $webRuntime 'web-control-server.mjs').ToLowerInvariant()
$mutex=New-Object Threading.Mutex($false,'Global\TigerIQCoreRuntimeUpdaterV2')
$healthFailures=@{core=0;web=0;coding=0}
$lastHeal=@{core=[DateTime]::MinValue;web=[DateTime]::MinValue;coding=[DateTime]::MinValue}
$healCooldownSec=300
$watchdog=$null
function Save-State([hashtable]$d){$d.updatedAt=(Get-Date).ToUniversalTime().ToString('o');$tmp="$state.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $state}
function Head([string]$repoPath,[string]$ref){(& git -C $repoPath rev-parse $ref 2>$null|Out-String).Trim()}
function Save-RuntimeSourceState([string]$currentSha,[string]$previousSha,[string]$gateSha){
  $d=[ordered]@{schema='TIGERIQ_RUNTIME_SOURCE_V1';sourcePath=$runtimeRepo;currentSha=$currentSha;previousSha=$previousSha;gateSha=$gateSha;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp="$runtimeSourceState.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $runtimeSourceState
}
function Runtime-Source-Dirty(){
  if(-not(Test-Path -LiteralPath $runtimeRepo)){return $false}
  $inside=(& git -C $runtimeRepo rev-parse --is-inside-work-tree 2>$null|Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $inside -ne 'true'){throw 'RUNTIME_SOURCE_INVALID'}
  return [bool](@(git -C $runtimeRepo status --porcelain).Count)
}
function Ensure-NodeModules(){param([string]$repoPath)
  $modulesPath=Join-Path $repoPath 'node_modules'
  $packageLock=Join-Path $repoPath 'package-lock.json'
  $packageJson=Join-Path $repoPath 'package.json'
  $valid=$true
  if(-not(Test-Path -LiteralPath $modulesPath)){$valid=$false}
  elseif((Test-Path -LiteralPath $packageLock) -and (Test-Path -LiteralPath $packageJson)){
    $lockTime=(Get-Item -LiteralPath $packageLock).LastWriteTimeUtc
    $jsonTime=(Get-Item -LiteralPath $packageJson).LastWriteTimeUtc
    $modTime=(Get-Item -LiteralPath $modulesPath).LastWriteTimeUtc
    if($lockTime -gt $modTime -or $jsonTime -gt $modTime){$valid=$false}
  }
  if(-not $valid){
    if(-not(Test-Path -LiteralPath $packageLock)){throw 'PACKAGE_LOCK_MISSING'}
    & npm --prefix $repoPath ci --ignore-scripts --no-audit --no-fund
    if($LASTEXITCODE -ne 0){throw 'NPM_CI_FAILED'}
  }
}
function Ensure-RuntimeSource([string]$targetSha){
  if(Test-Path -LiteralPath $runtimeRepo){
    if(Runtime-Source-Dirty){throw 'RUNTIME_SOURCE_DIRTY'}
    git -C $runtimeRepo reset --hard $targetSha|Out-Null
    if($LASTEXITCODE -ne 0){throw 'RUNTIME_SOURCE_RESET_FAILED'}
    return
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeRepo) -Force|Out-Null
  git -C $controlRepo worktree add --detach $runtimeRepo $targetSha|Out-Null
  if($LASTEXITCODE -ne 0){throw 'RUNTIME_SOURCE_CREATE_FAILED'}
}
function Sync-Launchers(){
  New-Item -ItemType Directory -Path $launcherRuntime -Force|Out-Null
  foreach($name in @('run-core.ps1','run-coding-lane.ps1')){
    $source=Join-Path $runtimeRepo ('scripts\tigeriq-core\'+$name);if(-not(Test-Path -LiteralPath $source)){throw ('LAUNCHER_SOURCE_MISSING:'+ $name)}
    $target=Join-Path $launcherRuntime $name;$tmp=$target+'.tmp';Copy-Item -LiteralPath $source -Destination $tmp -Force;Move-Item -LiteralPath $tmp -Destination $target -Force
  }
}
function Sync-UpdaterRuntime(){
  $source=Join-Path $runtimeRepo 'scripts\tigeriq-core\update-core-runtime.ps1';if(-not(Test-Path -LiteralPath $source)){throw 'UPDATER_SOURCE_MISSING'}
  New-Item -ItemType Directory -Path (Split-Path -Parent $updaterRuntime) -Force|Out-Null
  $tmp=$updaterRuntime+'.tmp';Copy-Item -LiteralPath $source -Destination $tmp -Force;Move-Item -LiteralPath $tmp -Destination $updaterRuntime -Force
}
function HealthInfo([string]$url){try{$r=Invoke-RestMethod -Uri $url -TimeoutSec 5;if($r.ok){return $r}}catch{};return $null}
function Task-Exists([string]$name){return [bool](Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)}
function Test-TcpPort([string]$targetHost,[int]$port,[int]$timeoutMs=2500){
  $client=New-Object Net.Sockets.TcpClient
  try{
    $async=$client.BeginConnect($targetHost,$port,$null,$null)
    if(-not $async.AsyncWaitHandle.WaitOne($timeoutMs,$false)){return $false}
    $client.EndConnect($async)
    return [bool]$client.Connected
  }catch{return $false}
  finally{$client.Close()}
}
function OpenClaw-TreeSha(){
  if(-not(Test-Path -LiteralPath $runtimeRepo)){return $null}
  $sha=(& git -C $runtimeRepo rev-parse 'HEAD:apps/openclaw-tigeriq-runtime' 2>$null|Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or -not $sha){return $null}
  return $sha
}
function Save-OpenClawAppliedState([string]$treeSha){
  $d=[ordered]@{schema='TIGERIQ_OPENCLAW_RUNTIME_V1';treeSha=$treeSha;port=18789;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp="$openclawState.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $openclawState
}
function Get-OpenClawAppliedTree(){
  try{if(Test-Path -LiteralPath $openclawState){$d=Get-Content -LiteralPath $openclawState -Raw|ConvertFrom-Json;return [string]$d.treeSha}}catch{}
  return $null
}
function Restart-OpenClawGateway(){
  if(-not(Task-Exists $openclawTask)){throw ('TASK_MISSING:'+ $openclawTask)}
  Stop-ScheduledTask -TaskName $openclawTask -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $openclawTask
  $deadline=(Get-Date).AddSeconds(45)
  while((Get-Date)-lt$deadline){
    $task=Get-ScheduledTask -TaskName $openclawTask -ErrorAction SilentlyContinue
    if($task -and $task.State -eq 'Running' -and (Test-TcpPort '127.0.0.1' 18789)){return @{healthy=$true;port=18789;taskState=[string]$task.State}}
    Start-Sleep -Seconds 2
  }
  return $null
}
function Reconcile-OpenClawRuntime(){
  $treeSha=OpenClaw-TreeSha
  if(-not $treeSha){return @{action='skip';reason='plugin_tree_missing'}}
  $applied=Get-OpenClawAppliedTree
  if($applied -eq $treeSha){
    return @{action='none';treeSha=$treeSha;portHealthy=(Test-TcpPort '127.0.0.1' 18789)}
  }
  if(-not(Task-Exists $openclawTask)){return @{action='blocked';reason='task_missing';treeSha=$treeSha}}
  $health=Restart-OpenClawGateway
  if(-not $health){throw 'OPENCLAW_GATEWAY_HEALTH_FAILED'}
  Save-OpenClawAppliedState $treeSha
  return @{action='restarted';treeSha=$treeSha;portHealthy=$true}
}
function Get-OpenClawCanaryState(){
  try{if(Test-Path -LiteralPath $openclawCanaryState){return (Get-Content -LiteralPath $openclawCanaryState -Raw|ConvertFrom-Json)}}catch{}
  return $null
}
function Save-OpenClawCanaryState([string]$installedSha,[string]$treeSha,[string]$result,[string]$reason){
  $d=[ordered]@{schema='TIGERIQ_OPENCLAW_CANARY_V1';installedSha=$installedSha;treeSha=$treeSha;result=$result;reason=$reason;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp=$openclawCanaryState+'.tmp';[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $openclawCanaryState
}
function Report-OpenClawCanary([string]$installedSha,[string]$treeSha,[string]$result,[string]$reason){
  $body=@(
    'TIGERIQ_OPENCLAW_CANARY_V1',
    ('installedSha='+$installedSha),
    ('pluginTreeSha='+$treeSha),
    ('result='+$result),
    ('reason='+$reason),
    'agent=operator-local',
    'tool=tigeriq_runtime',
    'action=core_status',
    'rawOutputPublished=false'
  ) -join [Environment]::NewLine
  & gh issue comment $openclawCanaryIssue --repo newsdayads/tigeriq-ai-lab --body $body 2>$null|Out-Null
  return ($LASTEXITCODE -eq 0)
}
function Invoke-OpenClawCanary([string]$installedSha,[string]$treeSha){
  if(-not $installedSha -or -not $treeSha){return @{action='skip';reason='identity_missing'}}
  $previous=Get-OpenClawCanaryState
  if($previous -and [string]$previous.installedSha -eq $installedSha -and [string]$previous.treeSha -eq $treeSha){
    return @{action='none';result=[string]$previous.result;reason=[string]$previous.reason;reported=$true}
  }
  $result='BLOCKED';$reason='UNKNOWN';$reported=$false
  try{
    if(-not(Test-Path -LiteralPath $openclawCli)){$reason='OPENCLAW_CLI_MISSING'}
    elseif(-not(Task-Exists $openclawTask) -or -not(Test-TcpPort '127.0.0.1' 18789)){$reason='OPENCLAW_GATEWAY_UNHEALTHY'}
    else{
      $oldHome=$env:OPENCLAW_HOME;$oldState=$env:OPENCLAW_STATE_DIR;$oldConfig=$env:OPENCLAW_CONFIG_PATH
      try{
        $env:OPENCLAW_HOME='D:\OpenClaw'
        $env:OPENCLAW_STATE_DIR='D:\TigerIQ-OpenClaw\state'
        $env:OPENCLAW_CONFIG_PATH='D:\TigerIQ-OpenClaw\state\openclaw.json'
        $message='Use only tigeriq_runtime. Call core_status exactly once. If the tool call succeeds and its evidence reports shell=false, arbitraryFileAccess=false, arbitraryCommandExecution=false, reply exactly TIGERIQ_OPENCLAW_CANARY_PASS. Otherwise reply exactly TIGERIQ_OPENCLAW_CANARY_BLOCKED.'
        $output=(& $openclawCli agent --agent $openclawAgent --message $message --timeout 90 2>&1|Out-String)
        $exitCode=$LASTEXITCODE
        if($exitCode -eq 0 -and $output -match '(?m)^\s*TIGERIQ_OPENCLAW_CANARY_PASS\s*$'){$result='PASS';$reason='CORE_STATUS_TYPED_TOOL_PASS'}
        elseif($exitCode -ne 0){$reason=('OPENCLAW_AGENT_EXIT_'+$exitCode)}
        elseif($output -match 'TIGERIQ_OPENCLAW_CANARY_BLOCKED'){$reason='AGENT_REPORTED_BLOCKED'}
        else{$reason='UNEXPECTED_AGENT_REPLY'}
      }finally{
        if($null-eq$oldHome){Remove-Item Env:OPENCLAW_HOME -ErrorAction SilentlyContinue}else{$env:OPENCLAW_HOME=$oldHome}
        if($null-eq$oldState){Remove-Item Env:OPENCLAW_STATE_DIR -ErrorAction SilentlyContinue}else{$env:OPENCLAW_STATE_DIR=$oldState}
        if($null-eq$oldConfig){Remove-Item Env:OPENCLAW_CONFIG_PATH -ErrorAction SilentlyContinue}else{$env:OPENCLAW_CONFIG_PATH=$oldConfig}
      }
    }
  }catch{$reason=('CANARY_EXCEPTION_'+$_.Exception.GetType().Name)}
  Save-OpenClawCanaryState $installedSha $treeSha $result $reason
  $reported=Report-OpenClawCanary $installedSha $treeSha $result $reason
  return @{action='executed';result=$result;reason=$reason;reported=$reported}
}
function Gates-Pass([string]$sha){
  $runs=gh api "repos/newsdayads/tigeriq-ai-lab/actions/runs?head_sha=$sha&status=completed&per_page=30"|ConvertFrom-Json
  $need=@('CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify')
  foreach($n in $need){if(-not(@($runs.workflow_runs|Where-Object{$_.name -eq $n -and $_.conclusion -eq 'success'}))){return $false}}
  return $true
}
function Resolve-GateSha([string]$remote){
  if(Gates-Pass $remote){return $remote}
  try{$prs=gh api -H 'Accept: application/vnd.github+json' "repos/newsdayads/tigeriq-ai-lab/commits/$remote/pulls"|ConvertFrom-Json}catch{return $null}
  foreach($pr in @($prs)){$head=[string]$pr.head.sha;if($head -and (Gates-Pass $head)){return $head}}
  return $null
}
function Get-NodePidByMatch([string]$match){
  $m=$match.ToLowerInvariant()
  $p=Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($m)} | Select-Object -First 1
  if($p){return [int]$p.ProcessId};return $null
}
function Stop-NodeProcessesByMatch([string]$match){
  $m=$match.ToLowerInvariant()
  $procs=Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($m)}
  foreach($p in $procs){try{Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop}catch{}}
}
function Get-CorePid(){$p=Get-NodePidByMatch $corePath;if($p){return $p};return Get-NodePidByMatch $legacyCorePath}
function Stop-CoreProcesses(){Stop-NodeProcessesByMatch $corePath;Stop-NodeProcessesByMatch $legacyCorePath}
function Restart-Core($oldPid){
  if(-not(Task-Exists $coreTask)){throw ('TASK_MISSING:'+ $coreTask)}
  $previousPid=if($null-ne$oldPid){[int]$oldPid}else{Get-CorePid}
  Stop-ScheduledTask -TaskName $coreTask -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2
  Stop-CoreProcesses;Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName $coreTask
  $deadline=(Get-Date).AddSeconds(60)
  while((Get-Date)-lt$deadline){
    $h=HealthInfo 'http://100.97.23.87:8795/health';$newPid=Get-CorePid
    if($h -and $newPid -and (($null-eq$previousPid)-or([int]$newPid-ne[int]$previousPid))){return $h}
    Start-Sleep -Seconds 2
  }
  return $null
}
function Restart-ServiceTask([string]$name,[string]$healthUrl,[string]$processMatch,[string]$legacyProcessMatch=''){
  if(-not(Task-Exists $name)){throw ('TASK_MISSING:'+ $name)}
  $oldPid=Get-NodePidByMatch $processMatch
  if(-not $oldPid -and $legacyProcessMatch){$oldPid=Get-NodePidByMatch $legacyProcessMatch}
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2
  Stop-NodeProcessesByMatch $processMatch
  if($legacyProcessMatch){Stop-NodeProcessesByMatch $legacyProcessMatch}
  Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName $name
  $deadline=(Get-Date).AddSeconds(45)
  while((Get-Date)-lt$deadline){
    $h=HealthInfo $healthUrl;$newPid=Get-NodePidByMatch $processMatch
    if($h -and $newPid -and (($null-eq$oldPid)-or([int]$newPid-ne[int]$oldPid))){return @{health=$h;pid=[int]$newPid;previousPid=$oldPid}}
    Start-Sleep -Seconds 2
  }
  return $null
}
function Sync-WebRuntime(){
  New-Item -ItemType Directory -Path $webRuntime -Force|Out-Null
  $files=@(
    @{src='apps\tigeriq-core\web-control-server.mjs';dst='web-control-server.mjs'},
    @{src='apps\tigeriq-core\web-control-truth.js';dst='web-control-truth.js'},
    @{src='apps\tigeriq-core\web-control.html';dst='web-control.html'},
    @{src='scripts\tigeriq-core\run-web-control-bundle.ps1';dst='run-web-control-bundle.ps1'}
  )
  foreach($f in $files){$source=Join-Path $runtimeRepo $f.src;if(-not(Test-Path -LiteralPath $source)){throw ('WEB_RUNTIME_SOURCE_MISSING:'+ $f.src)};$target=Join-Path $webRuntime $f.dst;$tmp=$target+'.tmp';Copy-Item -LiteralPath $source -Destination $tmp -Force;Move-Item -LiteralPath $tmp -Destination $target -Force}
}
function Ensure-ServiceHealth([string]$key,[string]$url){
  $h=HealthInfo $url
  if($h){$healthFailures[$key]=0;return @{service=$key;healthy=$true;action='none';pid=if($key-eq'web'){Get-NodePidByMatch $webPath}elseif($key-eq'coding'){Get-NodePidByMatch $codingPath}else{$h.pid}}}
  $healthFailures[$key]=[int]$healthFailures[$key]+1
  if($healthFailures[$key]-lt 2){return @{service=$key;healthy=$false;action='observe';failures=$healthFailures[$key]}}
  $since=((Get-Date)-[DateTime]$lastHeal[$key]).TotalSeconds
  if($since-lt$healCooldownSec){return @{service=$key;healthy=$false;action='cooldown';failures=$healthFailures[$key];cooldownRemainingSec=[int]($healCooldownSec-$since)}}
  $lastHeal[$key]=Get-Date
  try{
    if($key-eq'core'){$after=Restart-Core $null}
    elseif($key-eq'web'){Sync-WebRuntime;$after=Restart-ServiceTask $webTask 'http://100.97.23.87:8796/health' $webPath}
    elseif($key-eq'coding'){$after=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health' $codingPath $legacyCodingPath}
    else{throw ('UNKNOWN_SERVICE:'+ $key)}
    if($after){$healthFailures[$key]=0;return @{service=$key;healthy=$true;action='restarted';pid=$after.pid;previousPid=$after.previousPid}}
    return @{service=$key;healthy=$false;action='restart_failed';failures=$healthFailures[$key]}
  }catch{return @{service=$key;healthy=$false;action='restart_error';error=$_.Exception.Message;failures=$healthFailures[$key]}}
}
function Runtime-Watchdog(){
  $events=@(
    (Ensure-ServiceHealth 'core' 'http://100.97.23.87:8795/health'),
    (Ensure-ServiceHealth 'web' 'http://100.97.23.87:8796/health'),
    (Ensure-ServiceHealth 'coding' 'http://100.97.23.87:8797/health')
  )
  return @{ok=(@($events|Where-Object{-not $_.healthy}).Count-eq 0);updaterRunning=$true;services=$events;checkedAt=(Get-Date).ToUniversalTime().ToString('o')}
}
function Get-Impact([string[]]$paths){
  $web=[bool](@($paths|Where-Object{$_ -match '^apps/tigeriq-core/web-control(?:\.|-)' -or $_ -match '^scripts/tigeriq-core/(?:run|install)-web-control'}).Count)
  $coding=[bool](@($paths|Where-Object{$_ -match '^apps/tigeriq-coding-lane/' -or $_ -match '^scripts/tigeriq-core/(?:run|install)-coding-lane'}).Count)
  $core=[bool](@($paths|Where-Object{($_ -match '^apps/tigeriq-core/' -and $_ -notmatch '^apps/tigeriq-core/web-control(?:\.|-)') -or $_ -match '^scripts/tigeriq-core/(?:run-core|install-core-task)\.ps1$'}).Count)
  $openclaw=[bool](@($paths|Where-Object{$_ -match '^apps/openclaw-tigeriq-runtime/'}).Count)
  $updater=[bool](@($paths|Where-Object{$_ -eq 'scripts/tigeriq-core/update-core-runtime.ps1'}).Count)
  return @{core=$core;web=$web;coding=$coding;openclaw=$openclaw;updater=$updater}
}
function Restart-UpdaterAfterExit(){
  $cmd="Start-Sleep -Seconds 4; Start-ScheduledTask -TaskName '$updaterTask'"
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-Command',$cmd) -WindowStyle Hidden|Out-Null
}
while($true){
  $locked=$false
  try{
    $locked=$mutex.WaitOne(0);if(-not $locked){Start-Sleep -Seconds $IntervalSeconds;continue}
    $watchdog=Runtime-Watchdog
    if(-not(Test-Path -LiteralPath $tokenPath)){Save-State @{result='GITHUB_TOKEN_MISSING';watchdog=$watchdog};continue}
    $env:GH_TOKEN=[IO.File]::ReadAllText($tokenPath).Trim();if(-not $env:GH_TOKEN){Save-State @{result='GITHUB_TOKEN_EMPTY';watchdog=$watchdog};continue}
    git -C $controlRepo fetch origin main --prune|Out-Null;if($LASTEXITCODE -ne 0){throw 'FETCH_FAILED'}
    $remote=Head $controlRepo 'origin/main';if(-not $remote){throw 'REMOTE_MAIN_MISSING'}
    $runtimeExists=Test-Path -LiteralPath $runtimeRepo
    if($runtimeExists -and (Runtime-Source-Dirty)){Save-State @{result='BLOCKED_DIRTY_RUNTIME';runtimeSource=$runtimeRepo;watchdog=$watchdog};continue}
    $local=if($runtimeExists){Head $runtimeRepo 'HEAD'}else{$null}
    $openclawReconcile=if($runtimeExists){Reconcile-OpenClawRuntime}else{@{action='skip';reason='runtime_missing'}}
    $openclawCanary=if($runtimeExists -and $local){Invoke-OpenClawCanary $local (OpenClaw-TreeSha)}else{@{action='skip';reason='runtime_missing'}}
    if($runtimeExists -and $local -eq $remote){Save-State @{result='NO_CHANGE';installedSha=$local;runtimeSource=$runtimeRepo;openclawReconcile=$openclawReconcile;openclawCanary=$openclawCanary;watchdog=$watchdog};continue}
    $gateSha=Resolve-GateSha $remote
    if(-not $gateSha){Save-State @{result='WAIT_GATES';candidateSha=$remote;runtimeSource=$runtimeRepo;watchdog=$watchdog};continue}
    [string[]]$changed=if($runtimeExists){@(git -C $controlRepo diff --name-only $local $remote)}else{@('apps/tigeriq-core/','apps/tigeriq-coding-lane/','scripts/tigeriq-core/')}
    $impact=if($runtimeExists){Get-Impact $changed}else{@{core=$true;web=$true;coding=$true;openclaw=$false;updater=$true;bootstrap=$true}}
    $oldCore=HealthInfo 'http://100.97.23.87:8795/health';$oldPid=if($oldCore){[int]$oldCore.pid}else{$null}
    $previousRuntimeSha=$local
    Ensure-RuntimeSource $remote
    Ensure-NodeModules $runtimeRepo
    Save-RuntimeSourceState $remote $previousRuntimeSha $gateSha
    Sync-Launchers
    if($impact.updater){Sync-UpdaterRuntime}
    $coreHealth=$oldCore;$webHealth=$null;$codingHealth=$null;$openclawHealth=$null
    try{
      if($impact.core){$coreHealth=Restart-Core $oldPid;if(-not $coreHealth){throw 'CORE_HEALTH_OR_PID_FAILED'}}
      elseif(-not(HealthInfo 'http://100.97.23.87:8795/health')){throw 'CORE_HEALTH_LOST_WITHOUT_CORE_CHANGE'}
      if($impact.web){Sync-WebRuntime;$webHealth=Restart-ServiceTask $webTask 'http://100.97.23.87:8796/health' $webPath;if(-not $webHealth){throw 'WEB_CONTROL_HEALTH_OR_PID_FAILED'}}
      if($impact.coding){$codingHealth=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health' $codingPath $legacyCodingPath;if(-not $codingHealth){throw 'CODING_LANE_HEALTH_OR_PID_FAILED'}}
      if($impact.openclaw){$openclawHealth=Restart-OpenClawGateway;if(-not $openclawHealth){throw 'OPENCLAW_GATEWAY_HEALTH_FAILED'};Save-OpenClawAppliedState (OpenClaw-TreeSha)}
    }catch{
      if($previousRuntimeSha){
        git -C $runtimeRepo reset --hard $previousRuntimeSha|Out-Null
        Save-RuntimeSourceState $previousRuntimeSha $remote $previousRuntimeSha
        Sync-Launchers
        if($impact.updater){Sync-UpdaterRuntime}
      }else{
        git -C $controlRepo worktree remove --force $runtimeRepo 2>$null|Out-Null
        Remove-Item -LiteralPath $runtimeSourceState -Force -ErrorAction SilentlyContinue
      }
      if($impact.core){$null=Restart-Core $null}
      if($impact.web -and (Task-Exists $webTask)){Sync-WebRuntime;$null=Restart-ServiceTask $webTask 'http://100.97.23.87:8796/health' $webPath}
      if($impact.coding -and (Task-Exists $codingTask)){$null=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health' $codingPath $legacyCodingPath}
      if($impact.openclaw -and (Task-Exists $openclawTask)){$null=Restart-OpenClawGateway;$rollbackTree=OpenClaw-TreeSha;if($rollbackTree){Save-OpenClawAppliedState $rollbackTree}}
      throw ('ROLLED_BACK:'+ $_.Exception.Message)
    }
    $newCore=HealthInfo 'http://100.97.23.87:8795/health'
    $openclawCanary=Invoke-OpenClawCanary $remote (OpenClaw-TreeSha)
    Save-State @{result='UPDATED';installedSha=$remote;gateSha=$gateSha;previousSha=$previousRuntimeSha;runtimeSource=$runtimeRepo;changedPaths=$changed;impact=$impact;openclawReconcile=$openclawReconcile;openclawCanary=$openclawCanary;corePid=if($newCore){[int]$newCore.pid}else{$null};previousCorePid=$oldPid;coreRestarted=$impact.core;webRestarted=$impact.web;codingRestarted=$impact.coding;openclawRestarted=$impact.openclaw;openclawPortHealthy=if($openclawHealth){[bool]$openclawHealth.healthy}else{$null};webPid=if($webHealth){$webHealth.pid}else{$null};codingPid=if($codingHealth){$codingHealth.pid}else{$null};watchdog=$watchdog}
    if($impact.updater){Restart-UpdaterAfterExit;exit 75}
  }catch{Save-State @{result='FAILED';error=$_.Exception.Message;watchdog=$watchdog}}
  finally{Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue;if($locked){$mutex.ReleaseMutex()|Out-Null}}
  Start-Sleep -Seconds $IntervalSeconds
}
