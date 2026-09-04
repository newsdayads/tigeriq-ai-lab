param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workerDir = 'F:\TigerIQ\Worker'
$workerImpl = Join-Path $workerDir 'worker_impl.py'
$workerLauncher = Join-Path $workerDir 'worker.py'
$workerTask = 'TigerIQ Worker'
$marker = '# TIGERIQ_MODEL_TIMEOUT_300_V1'
$legacy = "MODEL_TIMEOUT = int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '90'))"
$desired = "MODEL_TIMEOUT = int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '300'))"
$backupDir = Join-Path $workerDir ("backup\model-timeout-300-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$backup = Join-Path $backupDir 'worker_impl.py'
$patched = $false

function Fail([string]$Code,[string]$Message) { throw "$Code`: $Message" }
function Get-TimeoutOverride([string]$Scope) {
  $raw = [Environment]::GetEnvironmentVariable('TIGERIQ_MODEL_TIMEOUT',$Scope)
  if([string]::IsNullOrWhiteSpace($raw)){ return $null }
  $parsed = 0
  if(-not [int]::TryParse($raw,[ref]$parsed)){ Fail "TIMEOUT_OVERRIDE_INVALID_$($Scope.ToUpperInvariant())" "TIGERIQ_MODEL_TIMEOUT in $Scope scope is not an integer." }
  if($parsed -lt 300){ Fail "TIMEOUT_OVERRIDE_TOO_LOW_$($Scope.ToUpperInvariant())" "TIGERIQ_MODEL_TIMEOUT in $Scope scope is below reviewed minimum 300 seconds." }
  return $parsed
}
function Assert-EffectiveTimeoutContract($Task) {
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

  $principal = [string]$Task.Principal.UserId
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $principalLeaf = ($principal -split '\\')[-1]
  $currentLeaf = ($current -split '\\')[-1]
  if(-not $principalLeaf -or -not [string]::Equals($principalLeaf,$currentLeaf,[StringComparison]::OrdinalIgnoreCase)){
    Fail 'WORKER_PRINCIPAL_CONTEXT_MISMATCH' 'Repair must run under the same Windows user principal as TigerIQ Worker before user-scoped environment can be trusted.'
  }

  $processOverride = Get-TimeoutOverride 'Process'
  $userOverride = Get-TimeoutOverride 'User'
  $machineOverride = Get-TimeoutOverride 'Machine'
  return [ordered]@{
    process = $processOverride
    user = $userOverride
    machine = $machineOverride
  }
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
  $python = [string]$task.Actions[0].Execute
  $effectiveOverrides = Assert-EffectiveTimeoutContract $task

  $text = [IO.File]::ReadAllText($workerImpl).Replace("`r`n","`n")
  if($text -notlike '*TIGERIQ PC01 SECURE WORKER V3 ONLINE*'){ Fail 'UNEXPECTED_WORKER_IMPL' 'Secure Worker V3 marker missing.' }

  if($text.Contains($marker)){
    if(-not $text.Contains($desired)){ Fail 'TIMEOUT_MARKER_INCONSISTENT' 'Timeout marker exists without reviewed 300 second default.' }
    if($text.Contains($legacy)){ Fail 'TIMEOUT_LEGACY_STILL_PRESENT' 'Legacy 90 second default remains beside timeout marker.' }
    if($task.State -ne 'Running'){
      Start-ScheduledTask -TaskName $workerTask -ErrorAction Stop
      Start-Sleep -Seconds 2
      $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
    }
    if($task.State -ne 'Running'){ Fail 'WORKER_NOT_RUNNING' ([string]$task.State) }
    [ordered]@{ status='PASS'; modelTimeout='READY'; seconds=300; effectiveOverrides=$effectiveOverrides; workerTask=$task.State.ToString(); patched=$false; backup=$null } | ConvertTo-Json -Compress -Depth 5
    exit 0
  }

  Write-Host '[30%] XAC MINH LAYOUT' -ForegroundColor Cyan
  $hasLegacy = $text.Contains($legacy)
  $hasDesired = $text.Contains($desired)
  if($hasLegacy -and $hasDesired){ Fail 'AMBIGUOUS_TIMEOUT_LAYOUT' 'Both legacy and desired timeout defaults are present.' }
  if(-not $hasLegacy -and -not $hasDesired){ Fail 'WORKER_TIMEOUT_LAYOUT_CHANGED' 'Reviewed MODEL_TIMEOUT anchor not found.' }

  Write-Host '[45%] BACKUP + PATCH' -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Copy-Item -LiteralPath $workerImpl -Destination $backup -Force
  if($hasLegacy){
    $text = $text.Replace($legacy,"$marker`n$desired")
  } else {
    $text = $text.Replace($desired,"$marker`n$desired")
  }
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
  if(-not $after.Contains($marker)){ Fail 'TIMEOUT_PATCH_NOT_PERSISTED' 'Timeout repair marker missing after restart.' }
  if(-not $after.Contains($desired)){ Fail 'TIMEOUT_300_NOT_PERSISTED' 'Reviewed 300 second default missing after restart.' }
  if($after.Contains($legacy)){ Fail 'TIMEOUT_90_STILL_PRESENT' 'Legacy 90 second default remains after repair.' }
  $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction Stop
  $effectiveOverrides = Assert-EffectiveTimeoutContract $task
  if($task.State -ne 'Running'){ Fail 'WORKER_NOT_RUNNING_AFTER_REPAIR' ([string]$task.State) }

  Write-Host '[100%] MODEL TIMEOUT READY' -ForegroundColor Green
  [ordered]@{ status='PASS'; modelTimeout='REPAIRED'; seconds=300; effectiveOverrides=$effectiveOverrides; workerTask=$task.State.ToString(); patched=$patched; backup=$backup } | ConvertTo-Json -Compress -Depth 5
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