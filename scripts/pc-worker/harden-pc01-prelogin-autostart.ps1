param(
  [switch]$Apply,
  [string]$BackupRoot = 'F:\TigerIQ\Worker\backup\prelogin-autostart'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$WorkerTaskName = 'TigerIQ Worker'
$WatchdogTaskName = 'TigerIQ Worker Watchdog'
$ExpectedWorkerPython = 'C:\Users\wdragons12x\AppData\Local\Programs\Python\Python312\python.exe'
$ExpectedWorkerLauncher = 'F:\TigerIQ\Worker\worker.py'
$ExpectedWatchdogScript = 'F:\TigerIQ\Worker\watchdog.ps1'
$ExpectedWatchdogArgs = '-NoProfile -ExecutionPolicy Bypass -File F:\TigerIQ\Worker\watchdog.ps1'
$mutationStarted = $false
$workerBackup = $null
$watchdogBackup = $null
$workerWasRunning = $false
$watchdogWasRunning = $false

function Fail([string]$Code, [string]$Message) {
  throw "$Code`: $Message"
}

function Normalize-Arguments([string]$Arguments) {
  if ($null -eq $Arguments) { return '' }
  return (($Arguments -replace '"', '') -replace '\s+', ' ').Trim()
}

function Assert-ActionContract($Task, [ValidateSet('Worker','Watchdog')][string]$Kind) {
  $actions = @($Task.Actions)
  if ($actions.Count -ne 1) { Fail 'TASK_ACTION_COUNT' "$Kind must have exactly one action." }
  $action = $actions[0]
  $execute = [string]$action.Execute
  $arguments = Normalize-Arguments ([string]$action.Arguments)

  if ($Kind -eq 'Worker') {
    if (-not [string]::Equals($execute, $ExpectedWorkerPython, [StringComparison]::OrdinalIgnoreCase)) {
      Fail 'WORKER_PYTHON_UNEXPECTED' $execute
    }
    if (-not [string]::Equals($arguments, $ExpectedWorkerLauncher, [StringComparison]::OrdinalIgnoreCase)) {
      Fail 'WORKER_LAUNCHER_UNEXPECTED' $arguments
    }
  }
  else {
    if (-not [string]::Equals([IO.Path]::GetFileName($execute), 'powershell.exe', [StringComparison]::OrdinalIgnoreCase)) {
      Fail 'WATCHDOG_EXECUTE_UNEXPECTED' $execute
    }
    if (-not [string]::Equals($arguments, $ExpectedWatchdogArgs, [StringComparison]::OrdinalIgnoreCase)) {
      Fail 'WATCHDOG_ARGUMENTS_UNEXPECTED' $arguments
    }
  }
  return $action
}

function Test-DesiredTaskContract($Task, [switch]$Watchdog) {
  $principal = $Task.Principal
  $userId = ([string]$principal.UserId).Trim()
  $isSystem = $userId -ieq 'SYSTEM' -or $userId -eq 'S-1-5-18'
  $isServiceAccount = ([string]$principal.LogonType) -eq 'ServiceAccount'
  $isHighest = ([string]$principal.RunLevel) -eq 'Highest'
  $triggers = @($Task.Triggers)
  $hasStartup = @($triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' }).Count -ge 1
  $hasMinuteRepeat = $true
  if ($Watchdog) {
    $hasMinuteRepeat = @($triggers | Where-Object {
      $_.CimClass.CimClassName -eq 'MSFT_TaskTimeTrigger' -and
      $null -ne $_.Repetition -and
      ([string]$_.Repetition.Interval) -eq 'PT1M'
    }).Count -ge 1
  }
  return $isSystem -and $isServiceAccount -and $isHighest -and $hasStartup -and $hasMinuteRepeat
}

function Write-Result($Object) {
  $Object | ConvertTo-Json -Compress
}

try {
  if ($env:COMPUTERNAME -ne 'PC01') { Fail 'WRONG_HOST' 'This package is restricted to PC01.' }

  $worker = Get-ScheduledTask -TaskName $WorkerTaskName -ErrorAction Stop
  $watchdog = Get-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $ExpectedWorkerPython)) { Fail 'WORKER_PYTHON_MISSING' $ExpectedWorkerPython }
  if (-not (Test-Path -LiteralPath $ExpectedWorkerLauncher)) { Fail 'WORKER_LAUNCHER_MISSING' $ExpectedWorkerLauncher }
  if (-not (Test-Path -LiteralPath $ExpectedWatchdogScript)) { Fail 'WATCHDOG_SCRIPT_MISSING' $ExpectedWatchdogScript }

  $workerAction = Assert-ActionContract $worker 'Worker'
  $watchdogAction = Assert-ActionContract $watchdog 'Watchdog'
  $workerReady = Test-DesiredTaskContract $worker
  $watchdogReady = Test-DesiredTaskContract $watchdog -Watchdog

  if ($workerReady -and $watchdogReady) {
    Write-Result ([ordered]@{ status='READY'; apply=$Apply.IsPresent; mutated=$false; worker='SYSTEM_AT_STARTUP'; watchdog='SYSTEM_AT_STARTUP_REPEAT_1M' })
    exit 0
  }

  if (-not $Apply) {
    Write-Result ([ordered]@{ status='PLAN'; apply=$false; mutated=$false; workerNeedsChange=(-not $workerReady); watchdogNeedsChange=(-not $watchdogReady); requiredGate='LIVE_TASK_PRINCIPAL_TRIGGER_CHANGE' })
    exit 0
  }

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $currentPrincipal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail 'ADMIN_REQUIRED' 'Applying the scheduled-task hardening requires an elevated session.'
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupDir = Join-Path $BackupRoot $stamp
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $workerBackup = Join-Path $backupDir 'TigerIQ-Worker.xml'
  $watchdogBackup = Join-Path $backupDir 'TigerIQ-Worker-Watchdog.xml'
  [IO.File]::WriteAllText($workerBackup, (Export-ScheduledTask -TaskName $WorkerTaskName), (New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($watchdogBackup, (Export-ScheduledTask -TaskName $WatchdogTaskName), (New-Object Text.UTF8Encoding($false)))

  $workerWasRunning = $worker.State -eq 'Running'
  $watchdogWasRunning = $watchdog.State -eq 'Running'
  $workerSettings = $worker.Settings
  $watchdogSettings = $watchdog.Settings
  $systemPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $workerStartup = New-ScheduledTaskTrigger -AtStartup
  $watchdogStartup = New-ScheduledTaskTrigger -AtStartup
  $watchdogRepeat = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)

  $mutationStarted = $true
  Stop-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName $WorkerTaskName -ErrorAction SilentlyContinue

  Register-ScheduledTask -TaskName $WorkerTaskName -Action $workerAction -Trigger $workerStartup -Settings $workerSettings -Principal $systemPrincipal -Force | Out-Null
  Register-ScheduledTask -TaskName $WatchdogTaskName -Action $watchdogAction -Trigger @($watchdogStartup, $watchdogRepeat) -Settings $watchdogSettings -Principal $systemPrincipal -Force | Out-Null

  Start-ScheduledTask -TaskName $WorkerTaskName -ErrorAction Stop
  Start-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction Stop
  Start-Sleep -Seconds 2

  $workerAfter = Get-ScheduledTask -TaskName $WorkerTaskName -ErrorAction Stop
  $watchdogAfter = Get-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction Stop
  [void](Assert-ActionContract $workerAfter 'Worker')
  [void](Assert-ActionContract $watchdogAfter 'Watchdog')
  if (-not (Test-DesiredTaskContract $workerAfter)) { Fail 'WORKER_VERIFY_FAILED' 'Worker is not SYSTEM + AtStartup after apply.' }
  if (-not (Test-DesiredTaskContract $watchdogAfter -Watchdog)) { Fail 'WATCHDOG_VERIFY_FAILED' 'Watchdog is not SYSTEM + AtStartup + repeat 1m after apply.' }

  Write-Result ([ordered]@{ status='PASS'; mutated=$true; worker='SYSTEM_AT_STARTUP'; watchdog='SYSTEM_AT_STARTUP_REPEAT_1M'; backupDir=$backupDir; rebootVerified=$false })
  exit 0
}
catch {
  $message = $_.Exception.Message
  $rollback = 'NOT_REQUIRED'
  if ($mutationStarted -and $workerBackup -and $watchdogBackup -and (Test-Path -LiteralPath $workerBackup) -and (Test-Path -LiteralPath $watchdogBackup)) {
    try {
      Stop-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue
      Stop-ScheduledTask -TaskName $WorkerTaskName -ErrorAction SilentlyContinue
      Register-ScheduledTask -TaskName $WorkerTaskName -Xml ([IO.File]::ReadAllText($workerBackup)) -Force | Out-Null
      Register-ScheduledTask -TaskName $WatchdogTaskName -Xml ([IO.File]::ReadAllText($watchdogBackup)) -Force | Out-Null
      if ($workerWasRunning) { Start-ScheduledTask -TaskName $WorkerTaskName -ErrorAction Stop }
      if ($watchdogWasRunning) { Start-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction Stop }
      $rollback = 'ROLLBACK_OK'
    }
    catch {
      $rollback = 'ROLLBACK_FAILED=' + $_.Exception.Message
    }
  }
  Write-Result ([ordered]@{ status='FAIL'; error=$message; rollback=$rollback; workerBackup=$workerBackup; watchdogBackup=$watchdogBackup })
  exit 1
}
