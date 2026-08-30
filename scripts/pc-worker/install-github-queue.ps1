param([string]$Branch='wo011/pc01-remote-exec')
$ErrorActionPreference='Stop'
$workerDir='F:\TigerIQ\Worker'
$worker=Join-Path $workerDir 'worker.py'
$control=Join-Path $workerDir 'control_plane_v2.py'
$test=Join-Path $workerDir 'test_control_plane_v2.py'
$log=Join-Path $workerDir 'worker-start.log'
$backup=Join-Path $workerDir ("worker.py.bak-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$base="https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/$Branch/scripts/pc-worker"
Write-Host '[10%] PRECHECK' -ForegroundColor Cyan
if(-not (Get-Command gh -ErrorAction SilentlyContinue)){throw 'gh CLI missing'}
$py=(Get-Command python -ErrorAction SilentlyContinue)
if(-not $py){throw 'python missing'}
gh auth status | Out-Null
Write-Host '[20%] DOWNLOAD WORKER V2' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $workerDir | Out-Null
if(Test-Path $worker){Copy-Item $worker $backup -Force}
$downloads=@{
  $worker="$base/worker-github-queue.py";
  $control="$base/control_plane_v2.py";
  $test="$base/test_control_plane_v2.py"
}
foreach($dest in $downloads.Keys){
  $tmp=$dest+'.download'
  Invoke-WebRequest -UseBasicParsing -Uri $downloads[$dest] -OutFile $tmp
  if((Get-Item $tmp).Length -lt 300){throw "Downloaded file unexpectedly small: $dest"}
  Move-Item $tmp $dest -Force
}
Write-Host '[35%] SYNTAX + REGRESSION' -ForegroundColor Cyan
& $py.Source -m py_compile $worker $control $test
if($LASTEXITCODE -ne 0){throw 'Python syntax check failed'}
Push-Location $workerDir
try{& $py.Source $test;if($LASTEXITCODE -ne 0){throw 'control-plane regression failed'}}finally{Pop-Location}
Write-Host '[55%] RESTART WORKER' -ForegroundColor Cyan
Stop-ScheduledTask -TaskName 'TigerIQ Worker' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like '*TigerIQ*Worker*worker.py*'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
$task=Get-ScheduledTask -TaskName 'TigerIQ Worker' -ErrorAction SilentlyContinue
if($task){Start-ScheduledTask -TaskName 'TigerIQ Worker';Start-Sleep 5}
$workers=@(Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like '*TigerIQ*Worker*worker.py*'})
if($workers.Count -eq 0){
  Write-Host '[60%] TASK FALLBACK' -ForegroundColor Yellow
  Start-Process -FilePath $py.Source -ArgumentList @($worker) -WorkingDirectory $workerDir -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError ($log+'.err')
  Start-Sleep 5
  $workers=@(Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like '*TigerIQ*Worker*worker.py*'})
}
if($workers.Count -ne 1){
  $taskInfo=if($task){Get-ScheduledTaskInfo -TaskName 'TigerIQ Worker' | Out-String}else{'Scheduled task missing'}
  $err='';if(Test-Path ($log+'.err')){$err=(Get-Content ($log+'.err') -Tail 40 | Out-String)}
  throw "Expected exactly one queue worker; found $($workers.Count). TASK=$taskInfo ERROR=$err"
}
Write-Host '[75%] DETERMINISTIC CANARY' -ForegroundColor Cyan
$id="install-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$body="TIGERIQ_COMMAND_V1`n``````json`n{`"idempotency_key`":`"$id`",`"action`":`"system.status`",`"args`":{}}`n``````"
$created=gh issue create --repo newsdayads/tigeriq-ai-lab --title '[PC01 P0] deterministic system.status canary' --body $body
if($LASTEXITCODE -ne 0){throw 'Cannot create deterministic canary'}
$n=(($created -split '/')[-1]).Trim()
$deadline=(Get-Date).AddMinutes(2)
$pass=$false
while((Get-Date) -lt $deadline){
  Start-Sleep 5
  $comments=gh api "repos/newsdayads/tigeriq-ai-lab/issues/$n/comments" --paginate | ConvertFrom-Json
  $joined=($comments.body -join "`n")
  if($joined -match 'TIGERIQ_PC01_DONE' -and $joined -match 'deterministic-command'){$pass=$true;break}
  if($joined -match 'TIGERIQ_PC01_FAILED'){throw 'Deterministic canary failed'}
}
if(-not $pass){throw 'Deterministic canary timeout'}
Write-Host '[100%] PC01 CONTROL PLANE V2 READY' -ForegroundColor Green
Write-Host "Worker PID: $($workers[0].ProcessId)"
Write-Host "Backup worker: $backup"
