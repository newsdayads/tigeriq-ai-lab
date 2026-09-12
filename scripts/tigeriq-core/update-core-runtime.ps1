param([int]$IntervalSeconds=120)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$state='D:\TigerIQ\State\core-runtime-updater.json'
$coreTask='TigerIQ Core 24x7'
$webTask='TigerIQ Web Control 24x7'
$codingTask='TigerIQ Coding Lane 24x7'
$updaterTask='TigerIQ Core Runtime Updater'
$webRuntime='D:\TigerIQ\Runtime\WebControl24x7'
$tokenPath='D:\TigerIQ\Secrets\github-command-center.token'
$corePath=(Join-Path $repo 'apps\tigeriq-core\core-entry.mjs').ToLowerInvariant()
$codingPath=(Join-Path $repo 'apps\tigeriq-coding-lane\coding-entry.mjs').ToLowerInvariant()
$webPath=(Join-Path $webRuntime 'web-control-server.mjs').ToLowerInvariant()
$mutex=New-Object Threading.Mutex($false,'Global\TigerIQCoreRuntimeUpdaterV2')
$healthFailures=@{core=0;web=0;coding=0}
$lastHeal=@{core=[DateTime]::MinValue;web=[DateTime]::MinValue;coding=[DateTime]::MinValue}
$healCooldownSec=300
$watchdog=$null
function Save-State([hashtable]$d){$d.updatedAt=(Get-Date).ToUniversalTime().ToString('o');$tmp="$state.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $state}
function Head([string]$ref){(& git -C $repo rev-parse $ref 2>$null|Out-String).Trim()}
function HealthInfo([string]$url){try{$r=Invoke-RestMethod -Uri $url -TimeoutSec 5;if($r.ok){return $r}}catch{};return $null}
function Task-Exists([string]$name){return [bool](Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)}
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
function Stop-CoreProcesses(){Stop-NodeProcessesByMatch $corePath}
function Restart-Core($oldPid){
  Stop-ScheduledTask -TaskName $coreTask -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2;Stop-CoreProcesses;Start-Sleep -Seconds 1;Start-ScheduledTask -TaskName $coreTask
  $deadline=(Get-Date).AddSeconds(60)
  while((Get-Date)-lt$deadline){$h=HealthInfo 'http://100.97.23.87:8795/health';if($h -and (($null -eq $oldPid)-or([int]$h.pid -ne [int]$oldPid))){return $h};Start-Sleep -Seconds 2}
  return $null
}
function Restart-ServiceTask([string]$name,[string]$healthUrl,[string]$processMatch){
  if(-not(Task-Exists $name)){throw ('TASK_MISSING:'+ $name)}
  $oldPid=Get-NodePidByMatch $processMatch
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2
  Stop-NodeProcessesByMatch $processMatch;Start-Sleep -Seconds 1
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
  foreach($f in $files){$source=Join-Path $repo $f.src;if(-not(Test-Path -LiteralPath $source)){throw ('WEB_RUNTIME_SOURCE_MISSING:'+ $f.src)};$target=Join-Path $webRuntime $f.dst;$tmp=$target+'.tmp';Copy-Item -LiteralPath $source -Destination $tmp -Force;Move-Item -LiteralPath $tmp -Destination $target -Force}
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
    elseif($key-eq'coding'){$after=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health' $codingPath}
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
  $updater=[bool](@($paths|Where-Object{$_ -eq 'scripts/tigeriq-core/update-core-runtime.ps1'}).Count)
  return @{core=$core;web=$web;coding=$coding;updater=$updater}
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
    if((git -C $repo status --porcelain)){Save-State @{result='BLOCKED_DIRTY_WORKTREE';watchdog=$watchdog};continue}
    git -C $repo fetch origin main --prune|Out-Null;if($LASTEXITCODE -ne 0){throw 'FETCH_FAILED'}
    $local=Head 'HEAD';$remote=Head 'origin/main';if($local -eq $remote){Save-State @{result='NO_CHANGE';installedSha=$local;watchdog=$watchdog};continue}
    $gateSha=Resolve-GateSha $remote
    if(-not $gateSha){Save-State @{result='WAIT_GATES';candidateSha=$remote;watchdog=$watchdog};continue}
    [string[]]$changed=@(git -C $repo diff --name-only $local $remote);$impact=Get-Impact $changed
    $oldCore=HealthInfo 'http://100.97.23.87:8795/health';$oldPid=if($oldCore){[int]$oldCore.pid}else{$null}
    git -C $repo merge --ff-only origin/main|Out-Null;if($LASTEXITCODE -ne 0){throw 'FAST_FORWARD_FAILED'}
    $coreHealth=$oldCore;$webHealth=$null;$codingHealth=$null
    try{
      if($impact.core){$coreHealth=Restart-Core $oldPid;if(-not $coreHealth){throw 'CORE_HEALTH_OR_PID_FAILED'}}
      elseif(-not(HealthInfo 'http://100.97.23.87:8795/health')){throw 'CORE_HEALTH_LOST_WITHOUT_CORE_CHANGE'}
      if($impact.web){Sync-WebRuntime;$webHealth=Restart-ServiceTask $webTask 'http://100.97.23.87:8796/health' $webPath;if(-not $webHealth){throw 'WEB_CONTROL_HEALTH_OR_PID_FAILED'}}
      if($impact.coding){$codingHealth=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health' $codingPath;if(-not $codingHealth){throw 'CODING_LANE_HEALTH_OR_PID_FAILED'}}
    }catch{
      git -C $repo reset --hard $local|Out-Null
      if($impact.core){$null=Restart-Core $null}
      if($impact.web -and (Task-Exists $webTask)){Sync-WebRuntime;$null=Restart-ServiceTask $webTask 'http://100.97.23.87:8796/health' $webPath}
      if($impact.coding -and (Task-Exists $codingTask)){$null=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health' $codingPath}
      throw ('ROLLED_BACK:'+ $_.Exception.Message)
    }
    $newCore=HealthInfo 'http://100.97.23.87:8795/health'
    Save-State @{result='UPDATED';installedSha=$remote;gateSha=$gateSha;previousSha=$local;changedPaths=$changed;impact=$impact;corePid=if($newCore){[int]$newCore.pid}else{$null};previousCorePid=$oldPid;coreRestarted=$impact.core;webRestarted=$impact.web;codingRestarted=$impact.coding;webPid=if($webHealth){$webHealth.pid}else{$null};codingPid=if($codingHealth){$codingHealth.pid}else{$null};watchdog=$watchdog}
    if($impact.updater){Restart-UpdaterAfterExit;exit 75}
  }catch{Save-State @{result='FAILED';error=$_.Exception.Message;watchdog=$watchdog}}
  finally{Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue;if($locked){$mutex.ReleaseMutex()|Out-Null}}
  Start-Sleep -Seconds $IntervalSeconds
}
