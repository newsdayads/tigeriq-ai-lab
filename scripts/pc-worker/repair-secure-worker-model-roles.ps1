param(
  [string]$Repo = 'newsdayads/tigeriq-ai-lab',
  [switch]$SkipCanary
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workerDir = 'F:\TigerIQ\Worker'
$workerImpl = Join-Path $workerDir 'worker_impl.py'
$workerTask = 'TigerIQ Worker'
$reviewerModel = 'qwen3:8b'
$judgeModel = 'gemma3:4b'
$executorModel = 'qwen2.5-coder:14b'
$oldReviewer = "REVIEWER_MODEL = os.getenv('TIGERIQ_REVIEWER_MODEL', '').strip()"
$newReviewer = "REVIEWER_MODEL = os.getenv('TIGERIQ_REVIEWER_MODEL', 'qwen3:8b').strip()"
$oldJudge = "JUDGE_MODEL = os.getenv('TIGERIQ_JUDGE_MODEL', '').strip()"
$newJudge = "JUDGE_MODEL = os.getenv('TIGERIQ_JUDGE_MODEL', 'gemma3:4b').strip()"
$backupDir = Join-Path $workerDir ("backup\webcontrol-model-roles-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$backup = Join-Path $backupDir 'worker_impl.py'
$patched = $false
$canaryNumber = $null

function Fail([string]$Code,[string]$Message) { throw "$Code`: $Message" }
function Restart-Worker {
  Stop-ScheduledTask -TaskName $workerTask -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $workerTask -ErrorAction Stop
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Seconds 2
    $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
    if($task.State -eq 'Running'){ return }
  } while((Get-Date) -lt $deadline)
  Fail 'WORKER_RESTART_TIMEOUT' 'TigerIQ Worker did not reach Running state.'
}

try {
  Write-Host '[10%] KIEM TRA RUNTIME' -ForegroundColor Cyan
  if(-not (Test-Path -LiteralPath $workerImpl)){ Fail 'WORKER_IMPL_MISSING' $workerImpl }
  $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
  if(-not $task){ Fail 'WORKER_TASK_MISSING' $workerTask }
  $python = [string]$task.Actions[0].Execute
  if(-not $python -or -not (Test-Path -LiteralPath $python)){ Fail 'PYTHON_FROM_TASK_MISSING' $python }
  $gh = (Get-Command gh -ErrorAction Stop).Source
  & $gh auth status | Out-Null
  if($LASTEXITCODE -ne 0){ Fail 'GH_AUTH_REQUIRED' 'GitHub CLI is not authenticated.' }

  Write-Host '[20%] KIEM TRA 3 MODEL DOC LAP' -ForegroundColor Cyan
  $tags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 15
  $required = @($executorModel,$reviewerModel,$judgeModel)
  $found = @{}
  foreach($row in @($tags.models)){
    $name = [string]$row.name
    if($required -contains $name){ $found[$name] = [string]$row.digest }
  }
  foreach($name in $required){
    if(-not $found.ContainsKey($name) -or [string]::IsNullOrWhiteSpace([string]$found[$name])){ Fail 'MODEL_MISSING' $name }
  }
  $digests = @($required | ForEach-Object { $found[$_] } | Select-Object -Unique)
  if($digests.Count -ne 3){ Fail 'MODEL_DIGESTS_NOT_DISTINCT' ($digests -join ',') }

  Write-Host '[35%] PATCH CO GIOI HAN + BACKUP' -ForegroundColor Cyan
  $text = [IO.File]::ReadAllText($workerImpl)
  if($text -notlike '*TIGERIQ PC01 SECURE WORKER V3 ONLINE*'){ Fail 'UNEXPECTED_WORKER_IMPL' 'Secure Worker V3 marker missing.' }
  $hasOldReviewer = $text.Contains($oldReviewer)
  $hasOldJudge = $text.Contains($oldJudge)
  $hasNewReviewer = $text.Contains($newReviewer)
  $hasNewJudge = $text.Contains($newJudge)
  if((-not $hasOldReviewer -and -not $hasNewReviewer) -or (-not $hasOldJudge -and -not $hasNewJudge)){
    Fail 'WORKER_LAYOUT_CHANGED' 'Model role lines do not match the reviewed Secure Worker V3 layout.'
  }

  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Copy-Item -LiteralPath $workerImpl -Destination $backup -Force
  if($hasOldReviewer){ $text = $text.Replace($oldReviewer,$newReviewer) }
  if($hasOldJudge){ $text = $text.Replace($oldJudge,$newJudge) }
  $tmp = "$workerImpl.new"
  [IO.File]::WriteAllText($tmp,$text,(New-Object Text.UTF8Encoding($false)))
  & $python -m py_compile $tmp
  if($LASTEXITCODE -ne 0){ Fail 'PATCH_PY_COMPILE_FAILED' 'Patched worker did not compile.' }
  Move-Item -Force -LiteralPath $tmp -Destination $workerImpl
  $patched = $hasOldReviewer -or $hasOldJudge

  Write-Host '[50%] KHOI DONG LAI WORKER' -ForegroundColor Cyan
  Restart-Worker

  if($SkipCanary){
    Write-Host '[85%] XAC MINH ROLE + TASK, CANARY DEFERRED' -ForegroundColor Cyan
    $after = [IO.File]::ReadAllText($workerImpl)
    if(-not $after.Contains($newReviewer) -or -not $after.Contains($newJudge)){ Fail 'ROLE_PATCH_NOT_PERSISTED' 'Reviewer/Judge defaults are not present after restart.' }
    $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
    if($task.State -ne 'Running'){ Fail 'WORKER_NOT_RUNNING_AFTER_REPAIR' ([string]$task.State) }
    Write-Host '[100%] WEB CONTROL AI WORKER ROLE REPAIR READY' -ForegroundColor Green
    [ordered]@{
      status='PASS'; workerTask=$task.State.ToString(); executor=$executorModel; reviewer=$reviewerModel; judge=$judgeModel;
      distinctDigests=3; canary='DEFERRED_SEPARATE_QUEUE_VERIFY'; backup=$backup; patched=$patched
    } | ConvertTo-Json -Compress
    exit 0
  }

  Write-Host '[60%] TAO CANARY AI E2E' -ForegroundColor Cyan
  $nonce = [Guid]::NewGuid().ToString('N').Substring(0,12)
  $body = @"
PC01_REQUIRED=true
CLOUD_EXECUTOR_ALLOWED=false

TIGERIQ_JOB_V1

## Work Order
WO-WEB-MODEL-REPAIR-$nonce

## Instruction
Use only Secure Worker V3 typed tools. Run repo_status once, then finish with exact summary WEB_CONTROL_AI_INGRESS_PASS. Do not mutate files, tasks, MAIN, Production, Web, Android, credentials, network, or system configuration.

## Priority
P0
"@
  $created = (& $gh issue create --repo $Repo --title "[PC01][P0] AI ingress verification $nonce" --body $body | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $created -notmatch '/issues/(\d+)$'){ Fail 'CANARY_CREATE_FAILED' $created }
  $canaryNumber = [int]$Matches[1]

  Write-Host '[70%] DOI EXECUTOR + REVIEWER + JUDGE' -ForegroundColor Cyan
  $deadline = (Get-Date).AddMinutes(12)
  $pass = $false
  $lastBodies = ''
  do {
    Start-Sleep -Seconds 10
    $json = (& $gh api "repos/$Repo/issues/$canaryNumber/comments?per_page=100" | Out-String)
    if($LASTEXITCODE -ne 0){ continue }
    $rows = $json | ConvertFrom-Json
    $lastBodies = (@($rows | ForEach-Object { [string]$_.body }) -join "`n")
    if($lastBodies -match '(?m)^TIGERIQ_PC01_DONE\s*$'){ $pass = $true; break }
    if($lastBodies -match '(?m)^TIGERIQ_PC01_NEEDS_EXTERNAL_REVIEW\s*$'){ Fail 'MODEL_ROLE_GATE_STILL_BLOCKED' 'Secure Worker still reports missing independent model roles.' }
    if($lastBodies -match '(?m)^TIGERIQ_PC01_FAILED\s*$'){ Fail 'AI_CANARY_FAILED' 'Executor/reviewer/judge canary returned FAILED.' }
  } while((Get-Date) -lt $deadline)
  if(-not $pass){ Fail 'AI_CANARY_TIMEOUT' "No terminal PASS from issue #$canaryNumber within 12 minutes." }

  Write-Host '[95%] VERIFY WORKER VAN RUNNING' -ForegroundColor Cyan
  $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
  if($task.State -ne 'Running'){ Fail 'WORKER_NOT_RUNNING_AFTER_CANARY' ([string]$task.State) }

  Write-Host '[100%] WEB CONTROL AI WORKER SAN SANG' -ForegroundColor Green
  [ordered]@{
    status='PASS'; workerTask=$task.State.ToString(); executor=$executorModel; reviewer=$reviewerModel; judge=$judgeModel;
    distinctDigests=3; canaryIssue=$canaryNumber; canary='TIGERIQ_PC01_DONE'; backup=$backup; patched=$patched
  } | ConvertTo-Json -Compress
  exit 0
}
catch {
  $message = $_.Exception.Message
  if($patched -and (Test-Path -LiteralPath $backup)){
    try {
      Copy-Item -LiteralPath $backup -Destination $workerImpl -Force
      Restart-Worker
      $message += ' | ROLLBACK_OK'
    } catch {
      $message += ' | ROLLBACK_FAILED=' + $_.Exception.Message
    }
  }
  Write-Host '[KHONG DAT] REPAIR FAILED' -ForegroundColor Red
  [ordered]@{ status='FAIL'; error=$message; canaryIssue=$canaryNumber; backup=$backup } | ConvertTo-Json -Compress
  exit 1
}