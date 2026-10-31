param(
  [ValidateSet('install','start','stop','restart','status','uninstall')]
  [string]$Action = 'status',
  [int]$Port = 8866,
  [string]$UserId = ''
)

$ErrorActionPreference = 'Stop'
$TaskName = 'TigerIQ-Animal-City'
$ServerPath = (Resolve-Path (Join-Path $PSScriptRoot 'server.mjs')).Path
$RootPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$NodePath = (Get-Command node.exe -ErrorAction Stop).Source
$HealthUrl = "http://127.0.0.1:$Port/health"
$ReadyUrl = "http://127.0.0.1:$Port/ready"

if ($Port -lt 1024 -or $Port -gt 65535) { throw 'INVALID_LISTEN_PORT' }
if ($Port -ne 8866) { throw 'MANAGED_RUNTIME_FIXED_PORT_8866' }

function Get-InteractiveUser {
  if ($UserId) {
    if ($UserId -notmatch '^[^\\]+\\[^\\]+$') { throw 'INTERACTIVE_USER_ID_INVALID' }
    return $UserId
  }
  $desktop = @(Get-Process explorer -IncludeUserName -ErrorAction SilentlyContinue |
    Where-Object { $_.SessionId -gt 0 -and $_.UserName -and $_.UserName -notmatch '^NT AUTHORITY\\' } |
    Sort-Object SessionId |
    Select-Object -First 1)
  if ($desktop.Count -ne 1) { throw 'INTERACTIVE_USER_NOT_FOUND' }
  return [string]$desktop[0].UserName
}

function Get-SourceSha {
  try {
    $sha = (& git -C $RootPath rev-parse HEAD 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $sha -match '^[0-9a-f]{40}$') { return $sha }
  } catch {}
  return $null
}

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
    $response = Invoke-RestMethod -Uri $Url -TimeoutSec 12
    return [ordered]@{ ok = [bool]$response.ok; response = $response }
  } catch {
    return [ordered]@{ ok = $false; error = $_.Exception.Message }
  }
}

function Get-Status {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue } else { $null }
  $processes = @(Get-AnimalProcess)
  $principal = if ($task) { $task.Principal } else { $null }
  $action = if ($task) { @($task.Actions | Select-Object -First 1) } else { @() }
  return [ordered]@{
    taskName = $TaskName
    taskInstalled = [bool]$task
    taskState = if ($task) { [string]$task.State } else { 'NOT_INSTALLED' }
    taskUser = if ($principal) { [string]$principal.UserId } else { $null }
    taskRunLevel = if ($principal) { [string]$principal.RunLevel } else { $null }
    taskExecute = if ($action.Count) { [string]$action[0].Execute } else { $null }
    taskArguments = if ($action.Count) { [string]$action[0].Arguments } else { $null }
    lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
    processCount = $processes.Count
    processIds = @($processes | ForEach-Object { $_.ProcessId })
    processSessions = @($processes | ForEach-Object { $_.SessionId })
    health = Invoke-Probe $HealthUrl
    readiness = Invoke-Probe $ReadyUrl
    serverPath = $ServerPath
    sourceSha = Get-SourceSha
    loopbackUrl = "http://127.0.0.1:$Port/"
  }
}

switch ($Action) {
  'install' {
    $user = Get-InteractiveUser
    $taskAction = New-ScheduledTaskAction -Execute $NodePath -Argument ('"' + $ServerPath + '"') -WorkingDirectory $RootPath
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
