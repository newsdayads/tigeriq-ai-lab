param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string]$Code,[string]$Message) {
  Write-Host "$Code`: $Message" -ForegroundColor Red
  exit 1
}

if ($env:COMPUTERNAME -ne 'PC01') { Fail 'WRONG_HOST' 'This recovery script is pinned to PC01.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'ADMIN_REQUIRED' 'Run PowerShell as Administrator.'
}

$logDir = 'F:\TigerIQ\Logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$logPath = Join-Path $logDir "m0-ingress-recovery-$stamp.json"

$targets = @(
  'TigerIQ Worker',
  'TigerIQ Worker Watchdog',
  'TigerIQ-PC01-Worker'
)

$before = @()
foreach ($name in $targets) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($task) {
    $before += [ordered]@{ name=$name; exists=$true; state=[string]$task.State; enabled=([string]$task.State -ne 'Disabled') }
  } else {
    $before += [ordered]@{ name=$name; exists=$false; state=$null; enabled=$false }
  }
}

$actions = @()
foreach ($name in $targets) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if (-not $task) {
    $actions += [ordered]@{ name=$name; action='missing'; ok=$false }
    continue
  }
  try {
    if ([string]$task.State -eq 'Disabled') {
      Enable-ScheduledTask -TaskName $name | Out-Null
    }
    Start-ScheduledTask -TaskName $name
    $actions += [ordered]@{ name=$name; action='enabled_and_started'; ok=$true }
  } catch {
    $actions += [ordered]@{ name=$name; action='start_failed'; ok=$false; errorType=$_.Exception.GetType().Name }
  }
}

Start-Sleep -Seconds 12

$after = @()
foreach ($name in $targets) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  $info = if ($task) { Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue } else { $null }
  $after += [ordered]@{
    name=$name
    exists=[bool]$task
    state=if($task){[string]$task.State}else{$null}
    lastTaskResult=if($info){$info.LastTaskResult}else{$null}
  }
}

$workerTask = $after | Where-Object { $_.name -eq 'TigerIQ Worker' }
$watchdogTask = $after | Where-Object { $_.name -eq 'TigerIQ Worker Watchdog' }
$runnerTask = $after | Where-Object { $_.name -eq 'TigerIQ-PC01-Worker' }

$ok = [bool]$workerTask.exists -and [bool]$watchdogTask.exists -and
      ($workerTask.state -ne 'Disabled') -and ($watchdogTask.state -ne 'Disabled')

$result = [ordered]@{
  action='TIGERIQ_M0_RECOVER_INGRESS_V1'
  timestamp=(Get-Date).ToUniversalTime().ToString('o')
  hostname=$env:COMPUTERNAME
  destructive=$false
  before=$before
  actions=$actions
  after=$after
  workerRecoveryReady=$ok
  selfHostedRunnerTaskPresent=[bool]$runnerTask.exists
  next='Wait for GitHub Issue #170 claim and self-hosted audit pickup.'
}

$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $logPath -Encoding UTF8
$result | ConvertTo-Json -Depth 6

if ($ok) {
  Write-Host 'M0_INGRESS_RECOVERY_REQUESTED' -ForegroundColor Green
  Write-Host "Evidence: $logPath"
  exit 0
}

Write-Host 'M0_INGRESS_RECOVERY_DEGRADED' -ForegroundColor Yellow
Write-Host "Evidence: $logPath"
exit 2
