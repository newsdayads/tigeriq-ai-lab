param(
  [string]$StatePath = 'F:\TigerIQ\State\workforce.jsonl',
  [string]$ControllerHost = '100.97.23.87',
  [int]$ControllerPort = 8790
)

$ErrorActionPreference = 'SilentlyContinue'
$TaskName = 'TigerIQ Workforce Controller'
$FirewallName = 'TigerIQ Workforce Controller (Tailscale)'
$SecretPath = 'F:\TigerIQ\Secrets\workforce-admin.secret'
$RunnerPath = 'F:\TigerIQ\Worker\run-workforce-controller.ps1'

$task = Get-ScheduledTask -TaskName $TaskName
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName } else { $null }
$ipPresent = [bool](Get-NetIPAddress -IPAddress $ControllerHost)
$listener = [bool](Get-NetTCPConnection -LocalAddress $ControllerHost -LocalPort $ControllerPort -State Listen)
$firewall = [bool](Get-NetFirewallRule -DisplayName $FirewallName)
$httpOk = $false
$nodes = $null
$employees = $null
try {
  $response = Invoke-RestMethod -Uri "http://$ControllerHost`:$ControllerPort/api/workforce/status" -TimeoutSec 4
  $httpOk = [bool]$response.ok
  if ($response.workforce) {
    $nodes = $response.workforce.nodes.total
    $employees = $response.workforce.employees.total
  }
} catch {}

[ordered]@{
  controller = if ($httpOk) { 'ONLINE' } elseif ($task) { 'NOT_HEALTHY' } else { 'NOT_INSTALLED' }
  bind = "$ControllerHost`:$ControllerPort"
  privateIpPresent = $ipPresent
  listening = $listener
  http = $httpOk
  scheduledTask = [ordered]@{
    exists = [bool]$task
    state = if ($task) { [string]$task.State } else { $null }
    lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
  }
  firewallRestricted = $firewall
  journalPresent = Test-Path $StatePath
  secretPresent = Test-Path $SecretPath
  runnerPresent = Test-Path $RunnerPath
  nodes = $nodes
  employees = $employees
} | ConvertTo-Json -Depth 4 -Compress
