param([string]$Branch='wo008/command-ingress-github-queue')
$ErrorActionPreference='Stop'
$workerDir='F:\TigerIQ\Worker'
$worker=Join-Path $workerDir 'worker.py'
$backup=Join-Path $workerDir ("worker.py.bak-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$url="https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/$Branch/scripts/pc-worker/worker-github-queue.py"
Write-Host '[10%] PRECHECK' -ForegroundColor Cyan
if(-not (Get-Command gh -ErrorAction SilentlyContinue)){throw 'gh CLI missing'}
if(-not (Get-Command python -ErrorAction SilentlyContinue)){throw 'python missing'}
gh auth status | Out-Null
try{Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5 | Out-Null}catch{throw 'Ollama API unavailable'}
Write-Host '[30%] INSTALL QUEUE WORKER' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $workerDir | Out-Null
if(Test-Path $worker){Copy-Item $worker $backup -Force}
$tmp=Join-Path $workerDir 'worker.py.download'
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp
if((Get-Item $tmp).Length -lt 1000){throw 'Downloaded worker is unexpectedly small'}
Move-Item $tmp $worker -Force
Write-Host '[55%] RESTART WORKER' -ForegroundColor Cyan
Stop-ScheduledTask -TaskName 'TigerIQ Worker' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like '*F:\TigerIQ\Worker\worker.py*'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force}
Start-ScheduledTask -TaskName 'TigerIQ Worker'
Start-Sleep 8
$workers=@(Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like '*F:\TigerIQ\Worker\worker.py*'})
if($workers.Count -ne 1){throw "Expected exactly one queue worker; found $($workers.Count)"}
Write-Host '[75%] CREATE CANARY JOB' -ForegroundColor Cyan
$body=@"
TIGERIQ_JOB_V1

## Instruction
Reply exactly with TIGERIQ_COMMAND_INGRESS_PASS. Do not perform any external mutation.
"@
$created=gh issue create --repo newsdayads/tigeriq-ai-lab --title '[PC01] WO-008 command ingress canary' --body $body
if($LASTEXITCODE -ne 0){throw 'Cannot create canary issue'}
Write-Host "Canary: $created"
Write-Host '[85%] WAIT FOR PC01 AUTO PICKUP' -ForegroundColor Cyan
$deadline=(Get-Date).AddMinutes(5)
$pass=$false
while((Get-Date) -lt $deadline){
  Start-Sleep 10
  $n=(($created -split '/')[-1]).Trim()
  $owner='newsdayads';$repo='tigeriq-ai-lab'
  $comments=gh api "repos/$owner/$repo/issues/$n/comments" --paginate | ConvertFrom-Json
  if(($comments.body -join "`n") -match 'TIGERIQ_PC01_DONE'){$pass=$true;break}
}
if(-not $pass){throw 'Canary was not completed within 5 minutes'}
Write-Host '[100%] TIGERIQ COMMAND INGRESS READY' -ForegroundColor Green
Write-Host "Backup worker: $backup"
