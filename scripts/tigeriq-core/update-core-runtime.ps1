param([int]$IntervalSeconds=120)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$state='D:\TigerIQ\State\core-runtime-updater.json'
$task='TigerIQ Core 24x7'
$mutex=New-Object Threading.Mutex($false,'Global\TigerIQCoreRuntimeUpdaterV1')
function Save-State([hashtable]$d){$d.updatedAt=(Get-Date).ToUniversalTime().ToString('o');$tmp="$state.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $state}
function Head([string]$ref){(& git -C $repo rev-parse $ref 2>$null|Out-String).Trim()}
function Health(){try{$r=Invoke-WebRequest -UseBasicParsing -Uri 'http://100.97.23.87:8795/health' -TimeoutSec 5;return $r.StatusCode -eq 200}catch{return $false}}
while($true){
  $locked=$false
  try{
    $locked=$mutex.WaitOne(0);if(-not $locked){Start-Sleep -Seconds $IntervalSeconds;continue}
    if((git -C $repo status --porcelain)){Save-State @{result='BLOCKED_DIRTY_WORKTREE'};Start-Sleep -Seconds $IntervalSeconds;continue}
    git -C $repo fetch origin main --prune | Out-Null;if($LASTEXITCODE-ne 0){throw 'FETCH_FAILED'}
    $local=Head 'HEAD';$remote=Head 'origin/main';if($local-eq$remote){Save-State @{result='NO_CHANGE';installedSha=$local};Start-Sleep -Seconds $IntervalSeconds;continue}
    $runs=gh api "repos/newsdayads/tigeriq-ai-lab/actions/runs?head_sha=$remote&status=completed&per_page=30"|ConvertFrom-Json
    $need=@('CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify');foreach($n in $need){if(-not(@($runs.workflow_runs|Where-Object{$_.name-eq$n-and$_.conclusion-eq'success'}))){Save-State @{result='WAIT_GATES';candidateSha=$remote};Start-Sleep -Seconds $IntervalSeconds;continue 2}}
    git -C $repo merge --ff-only origin/main | Out-Null;if($LASTEXITCODE-ne 0){throw 'FAST_FORWARD_FAILED'}
    Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2;Start-ScheduledTask -TaskName $task
    $deadline=(Get-Date).AddSeconds(60);while((Get-Date)-lt$deadline){if(Health){Save-State @{result='UPDATED';installedSha=$remote;previousSha=$local};break};Start-Sleep -Seconds 2}
    if(-not(Health)){git -C $repo reset --hard $local|Out-Null;Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2;Start-ScheduledTask -TaskName $task;throw 'HEALTH_FAILED_ROLLED_BACK'}
  }catch{Save-State @{result='FAILED';error=$_.Exception.Message}}
  finally{if($locked){$mutex.ReleaseMutex()|Out-Null}}
  Start-Sleep -Seconds $IntervalSeconds
}
