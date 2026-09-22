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
$appChromeIssue=1372
$appChromeController='http://127.0.0.1:8798'
$appChromeResumeState='D:\TigerIQ\State\app-chrome-runtime-recovery.json'
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
function Ensure-UpdaterTaskRuntimeTarget(){
  $task=Get-ScheduledTask -TaskName $updaterTask -ErrorAction SilentlyContinue
  if(-not $task){return @{action='missing';reason='UPDATER_TASK_MISSING'}}
  $action=@($task.Actions|Select-Object -First 1)
  $expectedExe='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  $expectedArgs="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$updaterRuntime`" -IntervalSeconds $IntervalSeconds"
  $currentExe=[string]$action.Execute
  $currentArgs=[string]$action.Arguments
  if($currentExe -ieq $expectedExe -and $currentArgs -match [regex]::Escape($updaterRuntime)){
    return @{action='none';target=$updaterRuntime}
  }
  $newAction=New-ScheduledTaskAction -Execute $expectedExe -Argument $expectedArgs
  Set-ScheduledTask -TaskName $updaterTask -Action $newAction|Out-Null
  return @{action='retargeted';target=$updaterRuntime;previousExecute=$currentExe;previousArguments=$currentArgs}
}
function HealthInfo([string]$url){try{$r=Invoke-RestMethod -Uri $url -TimeoutSec 5;if($r.ok){return $r}}catch{};return $null}
function Owner-AppChromeResumeRequested(){
  try{
    $body=(& gh issue view $appChromeIssue --repo newsdayads/tigeriq-ai-lab --json body --jq '.body' 2>$null|Out-String)
    if($LASTEXITCODE -ne 0){return $false}
    return [bool]($body -match '(?m)^OWNER_RUNTIME_RESUME=true\s*$')
  }catch{return $false}
}
function Get-AppChromeResumeState(){
  try{if(Test-Path -LiteralPath $appChromeResumeState){return (Get-Content -LiteralPath $appChromeResumeState -Raw|ConvertFrom-Json)}}catch{}
  return $null
}
function Save-AppChromeResumeState([string]$installedSha,[string]$result,[string]$reason,[bool]$reported){
  $d=[ordered]@{schema='TIGERIQ_APP_CHROME_RUNTIME_RECOVERY_V1';installedSha=$installedSha;result=$result;reason=$reason;reported=$reported;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp="$appChromeResumeState.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $appChromeResumeState
}
function Report-AppChromeResume([string]$installedSha,[string]$result,[string]$reason,$state){
  $nv02=@($state.workers|Where-Object{$_.id -eq 'NV02'}|Select-Object -First 1)
  $body=@(
    'TIGERIQ_APP_CHROME_RUNTIME_RECOVERY_V1',
    ('installedSha='+$installedSha),
    ('result='+$result),
    ('reason='+$reason),
    ('paused='+[string][bool]$state.paused),
    ('killed='+[string][bool]$state.killed),
    ('ownerInteractionMode='+[string]$state.ownerInteractionMode),
    ('externalWorkAutopilotEnabled='+[string][bool]$state.externalWorkAutopilotEnabled),
    ('nv02WindowState='+[string]$nv02.windowState),
    ('nv02Blocked='+[string][bool]$nv02.blocked),
    'rawOutputPublished=false'
  ) -join [Environment]::NewLine
  & gh issue comment $appChromeIssue --repo newsdayads/tigeriq-ai-lab --body $body 2>$null|Out-Null
  return ($LASTEXITCODE -eq 0)
}
function Invoke-AppChromeOwnerResume([string]$installedSha){
  if(-not(Owner-AppChromeResumeRequested)){return @{action='none';reason='not_requested'}}
  $after=$null
  try{
    $before=Invoke-RestMethod -Uri ($appChromeController+'/api/state') -TimeoutSec 5
    $workers=@($before.workers)
    $nv02=@($workers|Where-Object{$_.id -eq 'NV02'}|Select-Object -First 1)
    $needsResume=[bool]$before.paused -or [bool]$before.killed -or [string]$before.ownerInteractionMode -eq 'READ_ONLY' -or -not [bool]$before.externalWorkAutopilotEnabled
    $needsStart=($null -eq $nv02) -or ([string]$nv02.windowState -notmatch 'OPEN|RUNNING|READY|WORKING')
    $needsUnblock=($null -ne $nv02) -and [bool]$nv02.blocked
    if($needsResume){Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($appChromeController+'/api/resume') -TimeoutSec 10|Out-Null}
    if($needsUnblock){Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($appChromeController+'/api/workers/NV02/unblock') -TimeoutSec 15|Out-Null}
    if($needsStart){Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($appChromeController+'/api/start-all') -TimeoutSec 20|Out-Null}
    if($needsResume -or $needsUnblock -or $needsStart){Start-Sleep -Seconds 3}
    $after=Invoke-RestMethod -Uri ($appChromeController+'/api/state') -TimeoutSec 5
    $nv02After=@($after.workers|Where-Object{$_.id -eq 'NV02'}|Select-Object -First 1)
    $ok=(-not [bool]$after.paused) -and (-not [bool]$after.killed) -and ([string]$after.ownerInteractionMode -ne 'READ_ONLY') -and ($null -ne $nv02After) -and (-not [bool]$nv02After.blocked)
    $result=if($ok){'PASS'}else{'BLOCKED'}
    $reason=if($ok){'NV02_RUNTIME_RESUMED'}else{'CONTROLLER_STATE_NOT_RECOVERED'}
    $previous=Get-AppChromeResumeState
    $reported=[bool]($previous -and [string]$previous.installedSha -eq $installedSha -and [string]$previous.result -eq $result -and [bool]$previous.reported)
    if(-not $reported){$reported=Report-AppChromeResume $installedSha $result $reason $after}
    Save-AppChromeResumeState $installedSha $result $reason $reported
    return @{action=if($needsResume -or $needsUnblock -or $needsStart){'recovered'}else{'verified'};result=$result;reason=$reason;reported=$reported}
  }catch{
    $reason=('APP_CHROME_RECOVERY_EXCEPTION_'+$_.Exception.GetType().Name)
    Save-AppChromeResumeState $installedSha 'BLOCKED' $reason $false
    return @{action='blocked';result='BLOCKED';reason=$reason;reported=$false}
  }
}
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
function Reconcile-OpenClawRuntime([string]$installedSha){
  $treeSha=OpenClaw-TreeSha
  if(-not $treeSha){return @{action='skip';reason='plugin_tree_missing'}}
  $applied=Get-OpenClawAppliedTree
  if($applied -eq $treeSha){
    return @{action='none';treeSha=$treeSha;portHealthy=(Test-TcpPort '127.0.0.1' 18789)}
  }
  $previous=Get-OpenClawCanaryState
  if($previous -and [string]$previous.installedSha -eq $installedSha -and [string]$previous.treeSha -eq $treeSha -and [string]$previous.result -ne 'PASS'){
    return @{action='blocked';reason='terminal_canary_blocked';treeSha=$treeSha;portHealthy=(Test-TcpPort '127.0.0.1' 18789)}
  }
  if(-not(Task-Exists $openclawTask)){return @{action='blocked';reason='task_missing';treeSha=$treeSha}}
  $health=Restart-OpenClawGateway
  if(-not $health){throw 'OPENCLAW_GATEWAY_HEALTH_FAILED'}
  return @{action='restarted';treeSha=$treeSha;portHealthy=$true}
}
function Get-OpenClawCanaryState(){
  try{if(Test-Path -LiteralPath $openclawCanaryState){return (Get-Content -LiteralPath $openclawCanaryState -Raw|ConvertFrom-Json)}}catch{}
  return $null
}
function Save-OpenClawCanaryState([string]$installedSha,[string]$treeSha,[string]$result,[string]$reason,[bool]$reported){
  $d=[ordered]@{schema='TIGERIQ_OPENCLAW_CANARY_V2';installedSha=$installedSha;treeSha=$treeSha;result=$result;reason=$reason;reported=$reported;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp=$openclawCanaryState+'.tmp';[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $openclawCanaryState
}
function Report-OpenClawCanary([string]$installedSha,[string]$treeSha,[string]$result,[string]$reason){
  $body=@(
    'TIGERIQ_OPENCLAW_CANARY_V2',
    ('installedSha='+$installedSha),
    ('pluginTreeSha='+$treeSha),
    ('result='+$result),
    ('reason='+$reason),
    'agent=operator-local',
    'tools=tigeriq_runtime,tigeriq_pc',
    'actions=core_status,task_status,tcp_probe,shell_exec,file_write,file_read',
    'pcTask=TigerIQ OpenClaw Gateway',
    'pcShellCommand=D:\TigerIQ\Runtime\CoreSource\apps\openclaw-tigeriq-runtime\operator.mjs',
    'pcCanaryFile=D:\TigerIQ\State\openclaw-pc-operator-canary.txt',
    'rawOutputPublished=false'
  ) -join [Environment]::NewLine
  & gh issue comment $openclawCanaryIssue --repo newsdayads/tigeriq-ai-lab --body $body 2>$null|Out-Null
  return ($LASTEXITCODE -eq 0)
}
function Invoke-OpenClawCanary([string]$installedSha,[string]$treeSha){
  if(-not $installedSha -or -not $treeSha){return @{action='skip';reason='identity_missing'}}
  $previous=Get-OpenClawCanaryState
  if($previous -and [string]$previous.installedSha -eq $installedSha -and [string]$previous.treeSha -eq $treeSha){
    $previousReported=[bool]$previous.reported
    if(-not $previousReported){
      $previousReported=Report-OpenClawCanary $installedSha $treeSha ([string]$previous.result) ([string]$previous.reason)
      Save-OpenClawCanaryState $installedSha $treeSha ([string]$previous.result) ([string]$previous.reason) $previousReported
    }
    return @{action='none';result=[string]$previous.result;reason=[string]$previous.reason;reported=$previousReported}
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
        $message='Use only tigeriq_runtime and tigeriq_pc. Call tigeriq_runtime action=core_status exactly once. Call tigeriq_pc action=task_status taskName=TigerIQ OpenClaw Gateway exactly once. Call tigeriq_pc action=tcp_probe host=127.0.0.1 port=18789 exactly once. Call tigeriq_pc action=shell_exec shell=cmd cwd=D:\TigerIQ command=D:\OpenClaw\npm-global\openclaw.cmd --version exactly once. Call tigeriq_pc action=file_write path=D:\TigerIQ\State\openclaw-pc-operator-canary.txt content=TIGERIQ_PC_FILE_WRITE_OK exactly once. Call tigeriq_pc action=file_read path=D:\TigerIQ\State\openclaw-pc-operator-canary.txt exactly once. If all six tool calls succeed, shell_exec returns exitCode=0, tcp_probe reports reachable=true, and file_read returns TIGERIQ_PC_FILE_WRITE_OK, reply exactly TIGERIQ_OPENCLAW_PC_OPERATOR_PASS. Otherwise reply exactly TIGERIQ_OPENCLAW_PC_OPERATOR_BLOCKED.'
        $output=(& $openclawCli agent --agent $openclawAgent --message $message --timeout 90 2>&1|Out-String)
        $exitCode=$LASTEXITCODE
        if($exitCode -eq 0 -and $output -match '(?m)^\s*TIGERIQ_OPENCLAW_PC_OPERATOR_PASS\s*$'){$result='PASS';$reason='PC_OPERATOR_E2E_PASS'}
        elseif($exitCode -ne 0){$reason=('OPENCLAW_AGENT_EXIT_'+$exitCode)}
        elseif($output -match 'TIGERIQ_OPENCLAW_PC_OPERATOR_BLOCKED'){$reason='AGENT_REPORTED_BLOCKED'}
        else{$reason='UNEXPECTED_AGENT_REPLY'}
      }finally{
        if($null-eq$oldHome){Remove-Item Env:OPENCLAW_HOME -ErrorAction SilentlyContinue}else{$env:OPENCLAW_HOME=$oldHome}
        if($null-eq$oldState){Remove-Item Env:OPENCLAW_STATE_DIR -ErrorAction SilentlyContinue}else{$env:OPENCLAW_STATE_DIR=$oldState}
        if($null-eq$oldConfig){Remove-Item Env:OPENCLAW_CONFIG_PATH -ErrorAction SilentlyContinue}else{$env:OPENCLAW_CONFIG_PATH=$oldConfig}
      }
    }
  }catch{$reason=('CANARY_EXCEPTION_'+$_.Exception.GetType().Name)}
  $reported=Report-OpenClawCanary $installedSha $treeSha $result $reason
  Save-OpenClawCanaryState $installedSha $treeSha $result $reason $reported
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
    $runtimeIdentity=if(Test-Path -LiteralPath $runtimeRepo){Head $runtimeRepo 'HEAD'}else{'BOOTSTRAP'}
    $appChromeRecovery=Invoke-AppChromeOwnerResume $runtimeIdentity
    git -C $controlRepo fetch origin main --prune|Out-Null;if($LASTEXITCODE -ne 0){throw 'FETCH_FAILED'}
    $remote=Head $controlRepo 'origin/main';if(-not $remote){throw 'REMOTE_MAIN_MISSING'}
    $runtimeExists=Test-Path -LiteralPath $runtimeRepo
    if($runtimeExists -and (Runtime-Source-Dirty)){Save-State @{result='BLOCKED_DIRTY_RUNTIME';runtimeSource=$runtimeRepo;watchdog=$watchdog};continue}
    $local=if($runtimeExists){Head $runtimeRepo 'HEAD'}else{$null}
    $openclawReconcile=if($runtimeExists){Reconcile-OpenClawRuntime $local}else{@{action='skip';reason='runtime_missing'}}
    $preOpenclawCanary=if($runtimeExists -and $local){Invoke-OpenClawCanary $local (OpenClaw-TreeSha)}else{@{action='skip';reason='runtime_missing'}}
    if([string]$openclawReconcile.action -eq 'restarted'){
      if([string]$preOpenclawCanary.result -eq 'PASS'){Save-OpenClawAppliedState (OpenClaw-TreeSha)}
      else{Save-State @{result='OPENCLAW_CANARY_BLOCKED';installedSha=$local;runtimeSource=$runtimeRepo;openclawReconcile=$openclawReconcile;openclawCanary=$preOpenclawCanary;watchdog=$watchdog};Start-Sleep -Seconds $IntervalSeconds;continue}
    }
    if($runtimeExists -and $local -eq $remote){Save-State @{result='NO_CHANGE';installedSha=$local;runtimeSource=$runtimeRepo;appChromeRecovery=$appChromeRecovery;openclawReconcile=$openclawReconcile;openclawCanary=$preOpenclawCanary;watchdog=$watchdog};Start-Sleep -Seconds $IntervalSeconds;continue}
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
    $updaterTaskTarget=@{action='none';target=$updaterRuntime}
    if($impact.updater){Sync-UpdaterRuntime;$updaterTaskTarget=Ensure-UpdaterTaskRuntimeTarget}
    $coreHealth=$oldCore;$webHealth=$null;$codingHealth=$null;$openclawHealth=$null;$openclawCanary=$null
    try{
      if($impact.core){$coreHealth=Restart-Core $oldPid;if(-not $coreHealth){throw 'CORE_HEALTH_OR_PID_FAILED'}}
      elseif(-not(HealthInfo 'http://100.97.23.87:8795/health')){throw 'CORE_HEALTH_LOST_WITHOUT_CORE_CHANGE'}
      if($impact.web){Sync-WebRuntime;$webHealth=Restart-ServiceTask $webTask 'http://100.97.23.87:8796/health' $webPath;if(-not $webHealth){throw 'WEB_CONTROL_HEALTH_OR_PID_FAILED'}}
      if($impact.coding){$codingHealth=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health' $codingPath $legacyCodingPath;if(-not $codingHealth){throw 'CODING_LANE_HEALTH_OR_PID_FAILED'}}
      if($impact.openclaw){$openclawHealth=Restart-OpenClawGateway;if(-not $openclawHealth){throw 'OPENCLAW_GATEWAY_HEALTH_FAILED'}}
      if($impact.updater -or $impact.openclaw){
        $tree=OpenClaw-TreeSha
        $openclawCanary=Invoke-OpenClawCanary $remote $tree
        if(-not $openclawCanary -or [string]$openclawCanary.result -ne 'PASS'){
          $why=if($openclawCanary){[string]$openclawCanary.reason}else{'NO_RESULT'}
          throw ('OPENCLAW_FUNCTIONAL_CANARY_FAILED:'+ $why)
        }
        if($impact.openclaw){Save-OpenClawAppliedState $tree}
      }
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
    if($null -eq $openclawCanary){$openclawCanary=Invoke-OpenClawCanary $remote (OpenClaw-TreeSha)}
    Save-State @{result='UPDATED';installedSha=$remote;gateSha=$gateSha;previousSha=$previousRuntimeSha;runtimeSource=$runtimeRepo;appChromeRecovery=$appChromeRecovery;changedPaths=$changed;impact=$impact;updaterTaskTarget=$updaterTaskTarget;openclawReconcile=$openclawReconcile;openclawCanary=$openclawCanary;corePid=if($newCore){[int]$newCore.pid}else{$null};previousCorePid=$oldPid;coreRestarted=$impact.core;webRestarted=$impact.web;codingRestarted=$impact.coding;openclawRestarted=$impact.openclaw;openclawPortHealthy=if($openclawHealth){[bool]$openclawHealth.healthy}else{$null};webPid=if($webHealth){$webHealth.pid}else{$null};codingPid=if($codingHealth){$codingHealth.pid}else{$null};watchdog=$watchdog}
    if($impact.updater){Restart-UpdaterAfterExit;exit 75}
  }catch{Save-State @{result='FAILED';error=$_.Exception.Message;watchdog=$watchdog}}
  finally{Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue;if($locked){$mutex.ReleaseMutex()|Out-Null}}
  Start-Sleep -Seconds $IntervalSeconds
}
