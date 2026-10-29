param(
  [ValidateSet('install','start','stop','restart','status','uninstall')]
  [string]$Action = 'status',
  [int]$Port = 8866
)

$ErrorActionPreference = 'Stop'
$TaskName = 'TigerIQ-Animal-City'
$ServerPath = (Resolve-Path (Join-Path $PSScriptRoot 'server.mjs')).Path
$RootPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$NodePath = (Get-Command node.exe -ErrorAction Stop).Source
$LogRoot = if (Test-Path 'D:\TigerIQ') { 'D:\TigerIQ\Logs' } else { Join-Path $env:LOCALAPPDATA 'TigerIQ\Logs' }
$LogPath = Join-Path $LogRoot 'animal-city.log'
$HealthUrl = "http://127.0.0.1:$Port/health"
$ReadyUrl = "http://127.0.0.1:$Port/ready"

if ($Port -lt 1024 -or $Port -gt 65535) { throw 'INVALID_LISTEN_PORT' }
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

function Get-AnimalProcess {
  $needle = $ServerPath.ToLowerInvariant()
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -ieq 'node.exe' -and
    [string]$_.CommandLine -and
    $_.CommandLine.ToLowerInvariant().Contains($needle)
  })
}

function Stop-AnimalProcess {
  foreach ($process in Get-AnimalProcess) {
    Invoke-CimMethod -InputObject $process -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null
  }
}

function Invoke-Probe([string]$Url) {
  try {
    $response = Invoke-RestMethod -Uri $Url -TimeoutSec 5
    return [ordered]@{ ok = [bool]$response.ok; response = $response }
  } catch {
    return [ordered]@{ ok = $false; error = $_.Exception.Message }
  }
}

function Get-Status {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue } else { $null }
  $processes = @(Get-AnimalProcess)
  return [ordered]@{
    taskName = $TaskName
    taskInstalled = [bool]$task
    taskState = if ($task) { [string]$task.State } else { 'NOT_INSTALLED' }
    lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
    processCount = $processes.Count
    processIds = @($processes | ForEach-Object { $_.ProcessId })
    health = Invoke-Probe $HealthUrl
    readiness = Invoke-Probe $ReadyUrl
    serverPath = $ServerPath
    logPath = $LogPath
    loopbackUrl = "http://127.0.0.1:$Port/"
  }
}

switch ($Action) {
  'install' {
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $command = '"' + $NodePath + '" "' + $ServerPath + '" >> "' + $LogPath + '" 2>&1'
    $taskAction = New-ScheduledTaskAction -Execute $env:ComSpec -Argument ('/d /c ' + $command) -WorkingDirectory $RootPath
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Stop-AnimalProcess
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
    Get-Status | ConvertTo-Json -Depth 8 -Compress
  }
  'start' {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $TaskName }
    Start-Sleep -Seconds 2
    Get-Status | ConvertTo-Json -Depth 8 -Compress
  }
  'stop' {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Stop-AnimalProcess
    Get-Status | ConvertTo-Json -Depth 8 -Compress
  }
  'restart' {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Stop-AnimalProcess
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    Start-Sleep -Seconds 2
    Get-Status | ConvertTo-Json -Depth 8 -Compress
  }
  'uninstall' {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Stop-AnimalProcess
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Get-Status | ConvertTo-Json -Depth 8 -Compress
  }
  default {
    Get-Status | ConvertTo-Json -Depth 8 -Compress
  }
}
