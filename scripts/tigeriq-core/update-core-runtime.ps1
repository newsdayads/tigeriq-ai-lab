param([int]$IntervalSeconds=120)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$state='D:\TigerIQ\State\core-runtime-updater.json'
$task='TigerIQ Core 24x7'
$tokenPath='D:\TigerIQ\Secrets\github-command-center.token'
$corePath=(Join-Path $repo 'apps\tigeriq-core\core-entry.mjs').ToLowerInvariant()
$mutex=New-Object Threading.Mutex($false,'Global\TigerIQCoreRuntimeUpdaterV1')
function Save-State([hashtable]$d){$d.updatedAt=(Get-Date).ToUniversalTime().ToString('o');$tmp="$state.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $state}
function Head([string]$ref){(& git -C $repo rev-parse $ref 2>$null|Out-String).Trim()}
function HealthInfo(){try{$r=Invoke-RestMethod -Uri 'http://100.97.23.87:8795/health' -TimeoutSec 5;if($r.ok){return $r}}catch{};return $null}
function Stop-CoreProcesses(){
  $procs=Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($corePath)}
  foreach($p in $procs){try{Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop}catch{}}
}
function Restart-Core([Nullable[int]]$oldPid){
  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Stop-CoreProcesses
  Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName $task
  $deadline=(Get-Date).AddSeconds(60)
  while((Get-Date)-lt$deadline){
    $h=HealthInfo
    if($h -and $h.ok -and ((-not $oldPid.HasValue) -or ([int]$h.pid -ne $oldPid.Value))){return $h}
    Start-Sleep -Seconds 2
  }
  return $null
}
while($true){
  $locked=$false
  try{
    $locked=$mutex.WaitOne(0);if(-not $locked){Start-Sleep -Seconds $IntervalSeconds;continue}
    if(-not(Test-Path -LiteralPath $tokenPath)){throw 'GITHUB_TOKEN_MISSING'}
    $env:GH_TOKEN=[IO.File]::ReadAllText($tokenPath).Trim();if(-not $env:GH_TOKEN){throw 'GITHUB_TOKEN_EMPTY'}
    if((git -C $repo status --porcelain)){Save-State @{result='BLOCKED_DIRTY_WORKTREE'};continue}
    git -C $repo fetch origin main --prune | Out-Null;if($LASTEXITCODE -ne 0){throw 'FETCH_FAILED'}
    $local=Head 'HEAD';$remote=Head 'origin/main';if($local -eq $remote){Save-State @{result='NO_CHANGE';installedSha=$local};continue}
    $runs=gh api "repos/newsdayads/tigeriq-ai-lab/actions/runs?head_sha=$remote&status=completed&per_page=30"|ConvertFrom-Json
    $need=@('CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify');$gatesOk=$true
    foreach($n in $need){if(-not(@($runs.workflow_runs|Where-Object{$_.name -eq $n -and $_.conclusion -eq 'success'}))){$gatesOk=$false;break}}
    if(-not $gatesOk){Save-State @{result='WAIT_GATES';candidateSha=$remote};continue}
    $old=HealthInfo;$oldPid=if($old){[Nullable[int]]([int]$old.pid)}else{[Nullable[int]]$null}
    $selfChanged=((git -C $repo diff --name-only $local $remote) -contains 'scripts/tigeriq-core/update-core-runtime.ps1')
    git -C $repo merge --ff-only origin/main | Out-Null;if($LASTEXITCODE -ne 0){throw 'FAST_FORWARD_FAILED'}
    $newHealth=Restart-Core $oldPid
    if(-not $newHealth){
      git -C $repo reset --hard $local|Out-Null
      $null=Restart-Core ([Nullable[int]]$null)
      throw 'HEALTH_OR_PID_FAILED_ROLLED_BACK'
    }
    Save-State @{result='UPDATED';installedSha=$remote;previousSha=$local;corePid=[int]$newHealth.pid;previousCorePid=if($oldPid.HasValue){$oldPid.Value}else{$null};selfChanged=$selfChanged}
    if($selfChanged){exit 75}
  }catch{Save-State @{result='FAILED';error=$_.Exception.Message}}
  finally{Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue;if($locked){$mutex.ReleaseMutex()|Out-Null}}
  Start-Sleep -Seconds $IntervalSeconds
}
