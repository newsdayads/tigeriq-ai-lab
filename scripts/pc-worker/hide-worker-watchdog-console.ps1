param(
  [switch]$Apply,
  [string]$BackupRoot = 'F:\TigerIQ\Worker\backup\watchdog-hidden-console'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$TaskName = 'TigerIQ Worker Watchdog'
$ExpectedScript = 'F:\TigerIQ\Worker\watchdog.ps1'
$LegacyArgs = '-NoProfile -ExecutionPolicy Bypass -File F:\TigerIQ\Worker\watchdog.ps1'
$DesiredArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File F:\TigerIQ\Worker\watchdog.ps1'
$mutationStarted = $false
$backupPath = $null

function Fail([string]$Code, [string]$Message) {
  throw "$Code`: $Message"
}

function Normalize-Arguments([string]$Arguments) {
  if ($null -eq $Arguments) { return '' }
  return (($Arguments -replace '"', '') -replace '\s+', ' ').Trim()
}

function Get-PrincipalSignature($Task) {
  return [ordered]@{
    UserId = [string]$Task.Principal.UserId
    LogonType = [string]$Task.Principal.LogonType
    RunLevel = [string]$Task.Principal.RunLevel
  } | ConvertTo-Json -Compress
}

function Get-TriggerSignature($Task) {
  $rows = @($Task.Triggers | ForEach-Object {
    [ordered]@{
      Type = [string]$_.CimClass.CimClassName
      Enabled = [bool]$_.Enabled
      StartBoundary = [string]$_.StartBoundary
      EndBoundary = [string]$_.EndBoundary
      RepetitionInterval = if ($null -ne $_.Repetition) { [string]$_.Repetition.Interval } else { '' }
      RepetitionDuration = if ($null -ne $_.Repetition) { [string]$_.Repetition.Duration } else { '' }
      StopAtDurationEnd = if ($null -ne $_.Repetition) { [bool]$_.Repetition.StopAtDurationEnd } else { $false }
    }
  })
  return ($rows | ConvertTo-Json -Compress -Depth 5)
}

function Get-ActionContract($Task) {
  $actions = @($Task.Actions)
  if ($actions.Count -ne 1) { Fail 'TASK_ACTION_COUNT' 'Watchdog must have exactly one action.' }
  $action = $actions[0]
  $execute = [string]$action.Execute
  $arguments = Normalize-Arguments ([string]$action.Arguments)
  if (-not [string]::Equals([IO.Path]::GetFileName($execute), 'powershell.exe', [StringComparison]::OrdinalIgnoreCase)) {
    Fail 'WATCHDOG_EXECUTE_UNEXPECTED' $execute
  }
  if (-not (Test-Path -LiteralPath $ExpectedScript)) { Fail 'WATCHDOG_SCRIPT_MISSING' $ExpectedScript }
  return [ordered]@{ Execute = $execute; Arguments = $arguments }
}

function Write-Result($Object) {
  $Object | ConvertTo-Json -Compress -Depth 6
}

try {
  if ($env:COMPUTERNAME -ne 'PC01') { Fail 'WRONG_HOST' 'This repair is restricted to PC01.' }

  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if ([string]$task.State -eq 'Disabled') { Fail 'WATCHDOG_DISABLED' 'Watchdog task is disabled.' }

  $principalBefore = Get-PrincipalSignature $task
  $triggersBefore = Get-TriggerSignature $task
  $actionBefore = Get-ActionContract $task
  $legacy = Normalize-Arguments $LegacyArgs
  $desired = Normalize-Arguments $DesiredArgs

  if ([string]::Equals($actionBefore.Arguments, $desired, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Result ([ordered]@{
      status = 'READY'
      apply = $Apply.IsPresent
      mutated = $false
      task = $TaskName
      action = 'POWERSHELL_HIDDEN_NONINTERACTIVE'
      principalPreserved = $true
      triggerPreserved = $true
      physicalVerified = $false
    })
    exit 0
  }

  if (-not [string]::Equals($actionBefore.Arguments, $legacy, [StringComparison]::OrdinalIgnoreCase)) {
    Fail 'WATCHDOG_ARGUMENTS_UNEXPECTED' $actionBefore.Arguments
  }

  if (-not $Apply) {
    Write-Result ([ordered]@{
      status = 'PLAN'
      apply = $false
      mutated = $false
      task = $TaskName
      currentArguments = $actionBefore.Arguments
      desiredArguments = $desired
      principalMutation = $false
      triggerMutation = $false
      requiredGate = 'LIVE_TASK_ACTION_ONLY_AUTHORIZED'
    })
    exit 0
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupDir = Join-Path $BackupRoot $stamp
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $backupPath = Join-Path $backupDir 'TigerIQ-Worker-Watchdog.xml'
  [IO.File]::WriteAllText($backupPath, (Export-ScheduledTask -TaskName $TaskName), (New-Object Text.UTF8Encoding($false)))

  $mutationStarted = $true
  $newAction = New-ScheduledTaskAction -Execute $actionBefore.Execute -Argument $DesiredArgs
  Set-ScheduledTask -TaskName $TaskName -Action $newAction -ErrorAction Stop | Out-Null

  $after = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $actionAfter = Get-ActionContract $after
  $principalAfter = Get-PrincipalSignature $after
  $triggersAfter = Get-TriggerSignature $after

  if (-not [string]::Equals($actionAfter.Arguments, $desired, [StringComparison]::OrdinalIgnoreCase)) {
    Fail 'HIDDEN_ACTION_VERIFY_FAILED' $actionAfter.Arguments
  }
  if (-not [string]::Equals($principalAfter, $principalBefore, [StringComparison]::Ordinal)) {
    Fail 'PRINCIPAL_DRIFT' 'Task principal changed unexpectedly.'
  }
  if (-not [string]::Equals($triggersAfter, $triggersBefore, [StringComparison]::Ordinal)) {
    Fail 'TRIGGER_DRIFT' 'Task trigger changed unexpectedly.'
  }

  Write-Result ([ordered]@{
    status = 'PASS'
    mutated = $true
    task = $TaskName
    action = 'POWERSHELL_HIDDEN_NONINTERACTIVE'
    principalPreserved = $true
    triggerPreserved = $true
    backup = $backupPath
    physicalVerified = $false
    physicalAcceptance = '3_CONSECUTIVE_1M_CYCLES_NO_POPUP_NO_FOCUS_STEAL_WATCHDOG_HEALTHY'
  })
  exit 0
}
catch {
  $message = $_.Exception.Message
  $rollback = 'NOT_REQUIRED'
  if ($mutationStarted -and $backupPath -and (Test-Path -LiteralPath $backupPath)) {
    try {
      Register-ScheduledTask -TaskName $TaskName -Xml ([IO.File]::ReadAllText($backupPath)) -Force | Out-Null
      $rollback = 'ROLLBACK_OK'
    }
    catch {
      $rollback = 'ROLLBACK_FAILED=' + $_.Exception.Message
    }
  }
  Write-Result ([ordered]@{
    status = 'FAIL'
    error = $message
    rollback = $rollback
    backup = $backupPath
    principalMutationAllowed = $false
    triggerMutationAllowed = $false
  })
  exit 1
}
