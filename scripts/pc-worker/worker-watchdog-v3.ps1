$ErrorActionPreference = 'Stop'

$workerDir = 'F:\TigerIQ\Worker'
$workerPath = Join-Path $workerDir 'worker.py'
$logPath = Join-Path $workerDir 'watchdog-v3.jsonl'
$workerTask = 'TigerIQ Worker'
$mutexName = 'Global\TigerIQWorkerWatchdogV3'

New-Item -ItemType Directory -Force -Path $workerDir | Out-Null
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$locked = $false

function Write-Audit([string]$eventName, [hashtable]$data = @{}) {
  $row = [ordered]@{
    timestamp = (Get-Date).ToUniversalTime().ToString('o')
    event = $eventName
  }
  foreach ($key in $data.Keys) { $row[$key] = $data[$key] }
  ($row | ConvertTo-Json -Compress -Depth 6) | Add-Content -LiteralPath $logPath -Encoding UTF8
}

function Get-WorkerProcesses {
  if (-not (Test-Path -LiteralPath $workerPath)) { return @() }
  $escaped = [regex]::Escape($workerPath)
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match '^python(w)?\.exe$' -and
      $_.CommandLine -and
      $_.CommandLine -match $escaped
    } |
    Sort-Object CreationDate, ProcessId)
}

try {
  $locked = $mutex.WaitOne(0)
  if (-not $locked) { exit 0 }

  if (-not (Test-Path -LiteralPath $workerPath)) {
    Write-Audit 'worker_missing' @{ path = $workerPath }
    exit 2
  }

  $processes = @(Get-WorkerProcesses)
  if ($processes.Count -gt 1) {
    $keeper = $processes[0]
    $extras = @($processes | Select-Object -Skip 1)
    foreach ($proc in $extras) {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Audit 'duplicates_removed' @{
      keptPid = [int]$keeper.ProcessId
      removedPids = @($extras | ForEach-Object { [int]$_.ProcessId })
    }
    Start-Sleep -Seconds 2
    $processes = @(Get-WorkerProcesses)
  }

  if ($processes.Count -eq 0) {
    $task = Get-ScheduledTask -TaskName $workerTask -ErrorAction SilentlyContinue
    if (-not $task) {
      Write-Audit 'worker_task_missing' @{ task = $workerTask }
      exit 3
    }

    Start-ScheduledTask -TaskName $workerTask
    Write-Audit 'worker_restart_requested' @{ task = $workerTask }
    Start-Sleep -Seconds 5
    $processes = @(Get-WorkerProcesses)

    if ($processes.Count -ne 1) {
      Write-Audit 'worker_restart_failed' @{ processCount = $processes.Count }
      exit 4
    }

    Write-Audit 'worker_recovered' @{ pid = [int]$processes[0].ProcessId }
    exit 0
  }

  Write-Audit 'healthy' @{ pid = [int]$processes[0].ProcessId; processCount = $processes.Count }
  exit 0
}
catch {
  Write-Audit 'watchdog_error' @{ errorType = $_.Exception.GetType().Name; message = $_.Exception.Message }
  exit 5
}
finally {
  if ($locked) { $mutex.ReleaseMutex() | Out-Null }
  $mutex.Dispose()
}
