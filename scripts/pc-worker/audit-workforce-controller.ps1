param(
  [string]$StatePath = 'F:\TigerIQ\State\workforce.jsonl',
  [string]$ControllerHost = '',
  [int]$ControllerPort = 8790
)

$ErrorActionPreference = 'SilentlyContinue'
$TaskName = 'TigerIQ Workforce Controller'
$FirewallName = 'TigerIQ Workforce Controller (Tailscale)'
$SecretPath = 'F:\TigerIQ\Secrets\workforce-admin.secret'
$RunnerPath = 'F:\TigerIQ\Worker\run-workforce-controller.ps1'

function Test-TailscaleIPv4([string]$Address) {
  if ($Address -notmatch '^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') { return $false }
  $parts = $Address.Split('.') | ForEach-Object { [int]$_ }
  return $parts[1] -ge 64 -and $parts[1] -le 127 -and ($parts | Where-Object { $_ -lt 0 -or $_ -gt 255 }).Count -eq 0
}

function Resolve-ControllerHost([string]$Requested) {
  if ($Requested.Trim()) { return $Requested.Trim() }
  $tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  $tailscalePath = if ($tailscale) { $tailscale.Source } elseif (Test-Path 'C:\Program Files\Tailscale\tailscale.exe') { 'C:\Program Files\Tailscale\tailscale.exe' } else { $null }
  if (-not $tailscalePath) { return '' }
  $rows = @(& $tailscalePath ip -4 2>$null | ForEach-Object { $_.Trim() } | Where-Object { Test-TailscaleIPv4 $_ } | Select-Object -Unique)
  if ($rows.Count -eq 1) { return $rows[0] }
  return ''
}

$ControllerHost = Resolve-ControllerHost $ControllerHost
$task = Get-ScheduledTask -TaskName $TaskName
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName } else { $null }
$ipPresent = if ($ControllerHost) { [bool](Get-NetIPAddress -AddressFamily IPv4 -IPAddress $ControllerHost) } else { $false }
$listener = if ($ControllerHost) { [bool](Get-NetTCPConnection -LocalAddress $ControllerHost -LocalPort $ControllerPort -State Listen) } else { $false }
$wildcardListener = [bool](Get-NetTCPConnection -LocalPort $ControllerPort -State Listen | Where-Object { $_.LocalAddress -in @('0.0.0.0','::') })
$firewall = [bool](Get-NetFirewallRule -DisplayName $FirewallName)
$httpOk = $false
$nodes = $null
$employees = $null
if ($ControllerHost) {
  try {
    $response = Invoke-RestMethod -Uri "http://$ControllerHost`:$ControllerPort/api/workforce/status" -TimeoutSec 4
    $httpOk = [bool]$response.ok
    if ($response.workforce) {
      $nodes = $response.workforce.nodes.total
      $employees = $response.workforce.employees.total
    }
  } catch {}
}

[ordered]@{
  controller = if ($httpOk -and -not $wildcardListener) { 'ONLINE' } elseif ($task) { 'NOT_HEALTHY' } else { 'NOT_INSTALLED' }
  bind = if ($ControllerHost) { "$ControllerHost`:$ControllerPort" } else { $null }
  tailscaleIpResolved = [bool]$ControllerHost
  privateIpPresent = $ipPresent
  listening = $listener
  wildcardListener = $wildcardListener
  http = $httpOk
  scheduledTask = [ordered]@{
    exists = [bool]$task
    state = if ($task) { [string]$task.State } else { $null }
    lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
  }
  firewallRestricted = $firewall
  tailnetSelfPairConfigured = if (Test-Path $RunnerPath) { [bool](Select-String -Path $RunnerPath -Pattern 'TIGERIQ_WORKFORCE_ALLOW_TAILNET_SELF_PAIR' -Quiet) } else { $false }
  journalPresent = Test-Path $StatePath
  secretPresent = Test-Path $SecretPath
  runnerPresent = Test-Path $RunnerPath
  nodes = $nodes
  employees = $employees
} | ConvertTo-Json -Depth 4 -Compress
