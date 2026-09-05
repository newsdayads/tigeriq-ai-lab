param(
  [string]$Repo = 'newsdayads/tigeriq-ai-lab'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workerDir = 'F:\TigerIQ\Worker'
$workerImpl = Join-Path $workerDir 'worker_impl.py'
$workerTask = 'TigerIQ Worker'
$queueMarker = '# TIGERIQ_QUEUE_RESILIENCE_V1'
$backupDir = Join-Path $workerDir ("backup\queue-resilience-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$backup = Join-Path $backupDir 'worker_impl.py'
$patched = $false

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

$oldRoute = @'
    if number in EXCLUDED_ISSUES or _flag(body, 'PC01_REQUIRED') is False: return False
    if any(marker in upper for marker in EXCLUDED_TITLE_MARKERS): return False
'@
$newRoute = @'
    if number in EXCLUDED_ISSUES or _flag(body, 'PC01_REQUIRED') is False: return False
    if COMMAND_MARKER in body and _flag(body, 'PC01_REQUIRED') is True: return True
    if any(marker in upper for marker in EXCLUDED_TITLE_MARKERS): return False
'@
$oldSort = @'
    return sorted(jobs, key=lambda row: (0 if 'P0' in ((row.get('title') or '') + '\n' + (row.get('body') or '')).upper() else 1, int(row.get('number') or 0)))
'@
$newSort = @'
    return sorted(jobs, key=lambda row: (
        0 if COMMAND_MARKER in (row.get('body') or '') else 1,
        0 if 'P0' in ((row.get('title') or '') + '\n' + (row.get('body') or '')).upper() else 1,
        int(row.get('number') or 0),
    ))
'@
$oldLoop = @'
            for job in list_jobs():
                if COMMAND_MARKER in (job.get('body') or ''): execute_command_job(job); continue
                if str(job['number']) in set(state.get('done',[])): continue
                execute_ai_job(job,state)
'@
$newLoop = @'
            for job in list_jobs():
                try:
                    if COMMAND_MARKER in (job.get('body') or ''): execute_command_job(job); continue
                    if str(job['number']) in set(state.get('done',[])): continue
                    execute_ai_job(job,state)
                except Exception as job_exc:
                    number = int(job.get('number') or 0)
                    state['leases'].pop(str(number), None)
                    save_state(state)
                    append_audit({'event':'job_error','issue':number,'error':f'{type(job_exc).__name__}: {job_exc}'})
                    if JOB_MARKER in (job.get('body') or ''):
                        try:
                            comment(number, FAILED+'\n```json\n'+public_json({'timestamp':now(),'worker':'pc01','mode':'secure-v3-typed-tools','error':f'{type(job_exc).__name__}: {job_exc}'})+'\n```')
                        except Exception as comment_exc:
                            append_audit({'event':'job_error_comment_failed','issue':number,'error':f'{type(comment_exc).__name__}: {comment_exc}'})
                    continue
'@

try {
  Write-Host '[10%] KIEM TRA WORKER' -ForegroundColor Cyan
  if(-not (Test-Path -LiteralPath $workerImpl)){ Fail 'WORKER_IMPL_MISSING' $workerImpl }
  $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
  if(-not $task){ Fail 'WORKER_TASK_MISSING' $workerTask }
  $python = [string]$task.Actions[0].Execute
  if(-not $python -or -not (Test-Path -LiteralPath $python)){ Fail 'PYTHON_FROM_TASK_MISSING' $python }

  $text = [IO.File]::ReadAllText($workerImpl).Replace("`r`n","`n")
  if($text -notlike '*TIGERIQ PC01 SECURE WORKER V3 ONLINE*'){ Fail 'UNEXPECTED_WORKER_IMPL' 'Secure Worker V3 marker missing.' }

  if($text.Contains($queueMarker)){
    if($task.State -ne 'Running'){
      Start-ScheduledTask -TaskName $workerTask -ErrorAction Stop
      Start-Sleep -Seconds 2
      $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
    }
    if($task.State -ne 'Running'){ Fail 'WORKER_NOT_RUNNING' ([string]$task.State) }
    [ordered]@{ status='PASS'; queueResilience='READY'; workerTask=$task.State.ToString(); patched=$false; backup=$null } | ConvertTo-Json -Compress
    exit 0
  }

  Write-Host '[25%] XAC MINH LAYOUT REVIEWED' -ForegroundColor Cyan
  $oldRoute = $oldRoute.Replace("`r`n","`n")
  $newRoute = $newRoute.Replace("`r`n","`n")
  $oldSort = $oldSort.Replace("`r`n","`n")
  $newSort = $newSort.Replace("`r`n","`n")
  $oldLoop = $oldLoop.Replace("`r`n","`n")
  $newLoop = $newLoop.Replace("`r`n","`n")
  if(-not $text.Contains($oldRoute)){ Fail 'WORKER_ROUTE_LAYOUT_CHANGED' 'job_is_pc01 routing block does not match reviewed Secure Worker V3.' }
  if(-not $text.Contains($oldSort)){ Fail 'WORKER_SORT_LAYOUT_CHANGED' 'list_jobs sort block does not match reviewed Secure Worker V3.' }
  if(-not $text.Contains($oldLoop)){ Fail 'WORKER_LOOP_LAYOUT_CHANGED' 'main job loop does not match reviewed Secure Worker V3.' }
  if(-not $text.Contains('MAX_OUTPUT = 12000')){ Fail 'WORKER_CONSTANT_LAYOUT_CHANGED' 'MAX_OUTPUT anchor missing.' }

  Write-Host '[40%] BACKUP + PATCH EXACT BLOCKS' -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Copy-Item -LiteralPath $workerImpl -Destination $backup -Force
  $text = $text.Replace($oldRoute,$newRoute)
  $text = $text.Replace($oldSort,$newSort)
  $text = $text.Replace($oldLoop,$newLoop)
  $text = $text.Replace('MAX_OUTPUT = 12000',"MAX_OUTPUT = 12000`n$queueMarker")
  $tmp = "$workerImpl.new"
  [IO.File]::WriteAllText($tmp,$text,(New-Object Text.UTF8Encoding($false)))

  Write-Host '[60%] PY_COMPILE' -ForegroundColor Cyan
  & $python -m py_compile $tmp
  if($LASTEXITCODE -ne 0){ Fail 'PATCH_PY_COMPILE_FAILED' 'Patched worker did not compile.' }
  Move-Item -Force -LiteralPath $tmp -Destination $workerImpl
  $patched = $true

  Write-Host '[75%] RESTART WORKER' -ForegroundColor Cyan
  Restart-Worker

  Write-Host '[90%] VERIFY PATCH + TASK' -ForegroundColor Cyan
  $after = [IO.File]::ReadAllText($workerImpl)
  if(-not $after.Contains($queueMarker)){ Fail 'QUEUE_PATCH_NOT_PERSISTED' 'Queue resilience marker missing after restart.' }
  if(-not $after.Contains("if COMMAND_MARKER in body and _flag(body, 'PC01_REQUIRED') is True: return True")){ Fail 'COMMAND_ROUTE_PATCH_NOT_PERSISTED' 'Deterministic command routing patch missing.' }
  $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
  if($task.State -ne 'Running'){ Fail 'WORKER_NOT_RUNNING_AFTER_REPAIR' ([string]$task.State) }

  Write-Host '[100%] QUEUE RESILIENCE READY' -ForegroundColor Green
  [ordered]@{
    status='PASS'; queueResilience='REPAIRED'; workerTask=$task.State.ToString(); patched=$patched; backup=$backup;
    commandPriority='FIRST'; explicitPc01CommandBypassesTitleExclusion=$true; perJobExceptionIsolation=$true
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
  Write-Host '[KHONG DAT] QUEUE REPAIR FAILED' -ForegroundColor Red
  [ordered]@{ status='FAIL'; error=$message; backup=$backup } | ConvertTo-Json -Compress
  exit 1
}
