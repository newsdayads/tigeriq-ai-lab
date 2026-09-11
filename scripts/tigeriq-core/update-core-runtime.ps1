param([int]$IntervalSeconds=120)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$state='D:\TigerIQ\State\core-runtime-updater.json'
$coreTask='TigerIQ Core 24x7'
$webTask='TigerIQ Web Control 24x7'
$codingTask='TigerIQ Coding Lane 24x7'
$tokenPath='D:\TigerIQ\Secrets\github-command-center.token'
$corePath=(Join-Path $repo 'apps\tigeriq-core\core-entry.mjs').ToLowerInvariant()
$mutex=New-Object Threading.Mutex($false,'Global\TigerIQCoreRuntimeUpdaterV2')
function Save-State([hashtable]$d){$d.updatedAt=(Get-Date).ToUniversalTime().ToString('o');$tmp="$state.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $state}
function Head([string]$ref){(& git -C $repo rev-parse $ref 2>$null|Out-String).Trim()}
function HealthInfo([string]$url){try{$r=Invoke-RestMethod -Uri $url -TimeoutSec 5;if($r.ok){return $r}}catch{};return $null}
function Task-Exists([string]$name){return [bool](Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)}
function Stop-CoreProcesses(){
  $procs=Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($corePath)}
  foreach($p in $procs){try{Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop}catch{}}
}
function Restart-Core($oldPid){
  Stop-ScheduledTask -TaskName $coreTask -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2;Stop-CoreProcesses;Start-Sleep -Seconds 1;Start-ScheduledTask -TaskName $coreTask
  $deadline=(Get-Date).AddSeconds(60)
  while((Get-Date)-lt$deadline){$h=HealthInfo 'http://100.97.23.87:8795/health';if($h -and (($null -eq $oldPid)-or([int]$h.pid -ne [int]$oldPid))){return $h};Start-Sleep -Seconds 2}
  return $null
}
function Restart-ServiceTask([string]$name,[string]$healthUrl){
  if(-not(Task-Exists $name)){throw ('TASK_MISSING:'+ $name)}
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2;Start-ScheduledTask -TaskName $name
  $deadline=(Get-Date).AddSeconds(45)
  while((Get-Date)-lt$deadline){$h=HealthInfo $healthUrl;if($h){return $h};Start-Sleep -Seconds 2}
  return $null
}
function Get-Impact([string[]]$paths){
  $web=[bool](@($paths|Where-Object{$_ -match '^apps/tigeriq-core/web-control(?:\.|-)' -or $_ -match '^scripts/tigeriq-core/(?:run|install)-web-control'}).Count)
  $coding=[bool](@($paths|Where-Object{$_ -match '^apps/tigeriq-coding-lane/' -or $_ -match '^scripts/tigeriq-core/(?:run|install)-coding-lane'}).Count)
  $core=[bool](@($paths|Where-Object{($_ -match '^apps/tigeriq-core/' -and $_ -notmatch '^apps/tigeriq-core/web-control(?:\.|-)') -or $_ -match '^scripts/tigeriq-core/(?:run-core|install-core-task)\.ps1$'}).Count)
  $updater=[bool](@($paths|Where-Object{$_ -eq 'scripts/tigeriq-core/update-core-runtime.ps1'}).Count)
  return @{core=$core;web=$web;coding=$coding;updater=$updater}
}
while($true){
  $locked=$false
  try{
    $locked=$mutex.WaitOne(0);if(-not $locked){Start-Sleep -Seconds $IntervalSeconds;continue}
    if(-not(Test-Path -LiteralPath $tokenPath)){throw 'GITHUB_TOKEN_MISSING'}
    $env:GH_TOKEN=[IO.File]::ReadAllText($tokenPath).Trim();if(-not $env:GH_TOKEN){throw 'GITHUB_TOKEN_EMPTY'}
    if((git -C $repo status --porcelain)){Save-State @{result='BLOCKED_DIRTY_WORKTREE'};continue}
    git -C $repo fetch origin main --prune|Out-Null;if($LASTEXITCODE -ne 0){throw 'FETCH_FAILED'}
    $local=Head 'HEAD';$remote=Head 'origin/main';if($local -eq $remote){Save-State @{result='NO_CHANGE';installedSha=$local};continue}
    $runs=gh api "repos/newsdayads/tigeriq-ai-lab/actions/runs?head_sha=$remote&status=completed&per_page=30"|ConvertFrom-Json
    $need=@('CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify');$gatesOk=$true
    foreach($n in $need){if(-not(@($runs.workflow_runs|Where-Object{$_.name -eq $n -and $_.conclusion -eq 'success'}))){$gatesOk=$false;break}}
    if(-not $gatesOk){Save-State @{result='WAIT_GATES';candidateSha=$remote};continue}
    [string[]]$changed=@(git -C $repo diff --name-only $local $remote);$impact=Get-Impact $changed
    $oldCore=HealthInfo 'http://100.97.23.87:8795/health';$oldPid=if($oldCore){[int]$oldCore.pid}else{$null}
    git -C $repo merge --ff-only origin/main|Out-Null;if($LASTEXITCODE -ne 0){throw 'FAST_FORWARD_FAILED'}
    $coreHealth=$oldCore;$webHealth=$null;$codingHealth=$null
    try{
      if($impact.core){$coreHealth=Restart-Core $oldPid;if(-not $coreHealth){throw 'CORE_HEALTH_OR_PID_FAILED'}}
      elseif(-not(HealthInfo 'http://100.97.23.87:8795/health')){throw 'CORE_HEALTH_LOST_WITHOUT_CORE_CHANGE'}
      if($impact.web){$webHealth=Restart-ServiceTask $webTask 'http://100.97.23.87:8796/health';if(-not $webHealth){throw 'WEB_CONTROL_HEALTH_FAILED'}}
      if($impact.coding){$codingHealth=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health';if(-not $codingHealth){throw 'CODING_LANE_HEALTH_FAILED'}}
    }catch{
      git -C $repo reset --hard $local|Out-Null
      if($impact.core){$null=Restart-Core $null}
      if($impact.web -and (Task-Exists $webTask)){$null=Restart-ServiceTask $webTask 'http://100.97.23.87:8796/health'}
      if($impact.coding -and (Task-Exists $codingTask)){$null=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health'}
      throw ('ROLLED_BACK:'+ $_.Exception.Message)
    }
    $newCore=HealthInfo 'http://100.97.23.87:8795/health'
    Save-State @{result='UPDATED';installedSha=$remote;previousSha=$local;changedPaths=$changed;impact=$impact;corePid=if($newCore){[int]$newCore.pid}else{$null};previousCorePid=$oldPid;coreRestarted=$impact.core;webRestarted=$impact.web;codingRestarted=$impact.coding}
    if($impact.updater){exit 75}
  }catch{Save-State @{result='FAILED';error=$_.Exception.Message}}
  finally{Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue;if($locked){$mutex.ReleaseMutex()|Out-Null}}
  Start-Sleep -Seconds $IntervalSeconds
}
