param(
  [string]$ManifestPath = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$TaskName = 'TigerIQ Workforce Controller'
$FirewallName = 'TigerIQ Workforce Controller V1 (Tailscale only)'
$EvidenceRoot = 'F:\TigerIQ\Evidence\pc01-one-click'

function Fail([string]$Code,[string]$Message) { throw "$Code`: $Message" }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Fail 'ADMIN_REQUIRED' 'Rollback requires an authorized elevated context.' }

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $pointer = Join-Path $EvidenceRoot 'latest-rollback-manifest.txt'
  if (-not (Test-Path $pointer)) { Fail 'ROLLBACK_MANIFEST_MISSING' 'No rollback manifest pointer exists.' }
  $ManifestPath = [IO.File]::ReadAllText($pointer).Trim()
}
if (-not (Test-Path $ManifestPath)) { Fail 'ROLLBACK_MANIFEST_MISSING' 'Rollback manifest file does not exist.' }
$manifest = Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json

$currentTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($currentTask) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
$currentFirewall = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
if ($currentFirewall) { Remove-NetFirewallRule -DisplayName $FirewallName }

$restoredCanonicalTask = $false
if ($manifest.canonicalTaskBackupPath -and (Test-Path ([string]$manifest.canonicalTaskBackupPath))) {
  $xml = Get-Content -Raw -Path ([string]$manifest.canonicalTaskBackupPath)
  Register-ScheduledTask -TaskName $TaskName -Xml $xml | Out-Null
  $restoredCanonicalTask = $true
  if ([string]$manifest.canonicalTaskPriorState -eq 'Running') { Start-ScheduledTask -TaskName $TaskName }
}

$restoredFirewall = $false
if ($manifest.firewallBackup) {
  $fw = $manifest.firewallBackup
  if ($fw.exists -and $fw.localPort -and $fw.remoteAddress) {
    $params = @{
      DisplayName = $FirewallName
      Direction = [string]$fw.direction
      Action = [string]$fw.action
      Protocol = [string]$fw.protocol
      LocalPort = [string]$fw.localPort
      Profile = [string]$fw.profile
    }
    if ($fw.localAddress) { $params['LocalAddress'] = @($fw.localAddress) }
    if ($fw.remoteAddress) { $params['RemoteAddress'] = @($fw.remoteAddress) }
    New-NetFirewallRule @params | Out-Null
    if ([string]$fw.enabled -eq 'False') { Disable-NetFirewallRule -DisplayName $FirewallName | Out-Null }
    $restoredFirewall = $true
  }
}

$reenabled = @()
foreach ($item in @($manifest.disabledTasks)) {
  $name = [string]$item.taskName
  $path = [string]$item.taskPath
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $task = Get-ScheduledTask -TaskName $name -TaskPath $path -ErrorAction SilentlyContinue
  if ($task) {
    Enable-ScheduledTask -TaskName $name -TaskPath $path | Out-Null
    if ([string]$item.priorState -eq 'Running') { Start-ScheduledTask -TaskName $name -TaskPath $path -ErrorAction SilentlyContinue }
    $reenabled += "$path$name"
  }
}

[ordered]@{
  ok = $true
  action = 'pc01.one-click.rollback'
  manifest = $ManifestPath
  canonicalTaskRestored = $restoredCanonicalTask
  firewallRestored = $restoredFirewall
  legacyTasksReenabled = $reenabled
  stoppedProcessesNotBlindlyRestarted = @($manifest.stoppedProcesses | ForEach-Object { $_.pid })
  databaseRollback = 'NOT_PERFORMED_NON_DESTRUCTIVE'
  retainedMigrations = @('001_operational_state_v1','002_device_proof_replay_v1')
  prerequisitesUninstalled = $false
  secretsPrinted = $false
  marker = 'PC01_ONE_CLICK_ROLLBACK_COMPLETE'
} | ConvertTo-Json -Depth 5 -Compress
