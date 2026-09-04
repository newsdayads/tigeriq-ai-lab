param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workerDir = 'F:\TigerIQ\Worker'
$workerImpl = Join-Path $workerDir 'worker_impl.py'
$workerLauncher = Join-Path $workerDir 'worker.py'
$workerTask = 'TigerIQ Worker'
$marker = '# TIGERIQ_MODEL_TIMEOUT_MIN300_V2'
$oldMarker = '# TIGERIQ_MODEL_TIMEOUT_300_V1'
$legacy90 = "MODEL_TIMEOUT = int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '90'))"
$plain300 = "MODEL_TIMEOUT = int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '300'))"
$desired = "MODEL_TIMEOUT = max(300, int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '300')))"
$backupDir = Join-Path $workerDir ("backup\model-timeout-min300-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$backup = Join-Path $backupDir 'worker_impl.py'
$patched = $false

function Fail([string]$Code,[string]$Message) { throw "$Code`: $Message" }
function Assert-WorkerTaskContract($Task) {
  if(-not $Task.Actions -or $Task.Actions.Count -ne 1){ Fail 'WORKER_TASK_ACTION_COUNT' 'TigerIQ Worker must have exactly one reviewed action.' }
  $action = $Task.Actions[0]
  $python = [string]$action.Execute
  $arguments = [string]$action.Arguments
  if(-not $python -or -not (Test-Path -LiteralPath $python)){ Fail 'PYTHON_FROM_TASK_MISSING' $python }
  if($arguments -match '(?i)TIGERIQ_MODEL_TIMEOUT'){ Fail 'WORKER_TASK_TIMEOUT_WRAPPER_UNREVIEWED' 'Task action must not inject TIGERIQ_MODEL_TIMEOUT.' }
  $normalizedArgs = $arguments.Trim().Trim('"')
  if(-not [string]::Equals($normalizedArgs,$workerLauncher,[StringComparison]::OrdinalIgnoreCase)){
    Fail 'WORKER_TASK_LAUNCHER_UNEXPECTED' 'Task must execute the reviewed F:\TigerIQ\Worker\worker.py launcher directly.'
  }
  return $python
}
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
  Write-Host '[10%] KIEM TRA WORKER' -ForegroundColor Cyan
  if($env:COMPUTERNAME -ne 'PC01'){ Fail 'WRONG_HOST' 'PC01 only.' }
  if(-not (Test-Path -LiteralPath $workerImpl)){ Fail 'WORKER_IMPL_MISSING' $workerImpl }
  if(-not (Test-Path -LiteralPath $workerLauncher)){ Fail 'WORKER_LAUNCHER_MISSING' $workerLauncher }
  $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
  $python = Assert-WorkerTaskContract $task

  $text = [IO.File]::ReadAllText($workerImpl).Replace("`r`n","`n")
  if($text -notlike '*TIGERIQ PC01 SECURE WORKER V3 ONLINE*'){ Fail 'UNEXPECTED_WORKER_IMPL' 'Secure Worker V3 marker missing.' }

  if($text.Contains($marker)){
    if(-not $text.Contains($desired)){ Fail 'TIMEOUT_MARKER_INCONSISTENT' 'Minimum-timeout marker exists without reviewed clamp.' }
    if($text.Contains($legacy90) -or $text.Contains($plain300)){ Fail 'TIMEOUT_LEGACY_STILL_PRESENT' 'Legacy unclamped timeout assignment remains beside minimum-timeout marker.' }
    if($task.State -ne 'Running'){
      Start-ScheduledTask -TaskName $workerTask -ErrorAction Stop
      Start-Sleep -Seconds 2
      $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
    }
    if($task.State -ne 'Running'){ Fail 'WORKER_NOT_RUNNING' ([string]$task.State) }
    [ordered]@{ status='PASS'; modelTimeout='READY'; secondsMin=300; policy='MIN_300_CLAMP'; workerTask=$task.State.ToString(); patched=$false; backup=$null } | ConvertTo-Json -Compress
    exit 0
  }

  Write-Host '[30%] XAC MINH LAYOUT' -ForegroundColor Cyan
  $has90 = $text.Contains($legacy90)
  $hasPlain300 = $text.Contains($plain300)
  $hasDesired = $text.Contains($desired)
  $anchorCount = 0
  if($has90){ $anchorCount += 1 }
  if($hasPlain300){ $anchorCount += 1 }
  if($hasDesired){ $anchorCount += 1 }
  if($anchorCount -ne 1){ Fail 'WORKER_TIMEOUT_LAYOUT_CHANGED' 'Expected exactly one reviewed MODEL_TIMEOUT anchor.' }

  Write-Host '[45%] BACKUP + PATCH' -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Copy-Item -LiteralPath $workerImpl -Destination $backup -Force
  $text = $text.Replace("$oldMarker`n",'').Replace("$oldMarker`r`n",'')
  if($has90){ $text = $text.Replace($legacy90,"$marker`n$desired") }
  elseif($hasPlain300){ $text = $text.Replace($plain300,"$marker`n$desired") }
  else { $text = $text.Replace($desired,"$marker`n$desired") }
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
  if(-not $after.Contains($marker)){ Fail 'TIMEOUT_PATCH_NOT_PERSISTED' 'Minimum-timeout repair marker missing after restart.' }
  if(-not $after.Contains($desired)){ Fail 'TIMEOUT_MIN300_NOT_PERSISTED' 'Reviewed minimum-300 clamp missing after restart.' }
  if($after.Contains($legacy90) -or $after.Contains($plain300)){ Fail 'TIMEOUT_UNCLAMPED_STILL_PRESENT' 'Unclamped timeout assignment remains after repair.' }
  $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
  [void](Assert-WorkerTaskContract $task)
  if($task.State -ne 'Running'){ Fail 'WORKER_NOT_RUNNING_AFTER_REPAIR' ([string]$task.State) }

  Write-Host '[100%] MODEL TIMEOUT READY' -ForegroundColor Green
  [ordered]@{ status='PASS'; modelTimeout='REPAIRED'; secondsMin=300; policy='MIN_300_CLAMP'; workerTask=$task.State.ToString(); patched=$patched; backup=$backup } | ConvertTo-Json -Compress
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
  Write-Host '[KHONG DAT] MODEL TIMEOUT REPAIR FAILED' -ForegroundColor Red
  [ordered]@{ status='FAIL'; error=$message; backup=$backup } | ConvertTo-Json -Compress
  exit 1
}