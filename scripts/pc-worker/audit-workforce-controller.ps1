param(
  [string]$StatePath = 'F:\TigerIQ\State\workforce.jsonl',
  [string]$ControllerHost = '',
  [int]$ControllerPort = 8790,
  [ValidateSet('auto','generic','v1')]
  [string]$ControllerContract = 'auto'
)

$ErrorActionPreference = 'SilentlyContinue'
$TaskName = 'TigerIQ Workforce Controller'
$FirewallName = 'TigerIQ Workforce Controller (Tailscale)'
$SecretPath = 'F:\TigerIQ\Secrets\workforce-admin.secret'
$RunnerPath = 'F:\TigerIQ\Worker\run-workforce-controller.ps1'

. (Join-Path $PSScriptRoot 'controller-health-probe.ps1')

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
$health = $null
$httpOk = $false
$nodes = $null
$employees = $null
if ($ControllerHost) {
  $health = Invoke-TigerIQControllerHealthProbe -BaseUri "http://$ControllerHost`:$ControllerPort" -ExpectedContract $ControllerContract -TimeoutSec 4
  $httpOk = [bool]$health.health_ok
  $response = $health.response
  if ($response -and $response.workforce) {
    $nodes = $response.workforce.nodes.total
    $employees = $response.workforce.employees.total
  }
}
$controllerProjection = Get-TigerIQControllerProjection -Health $health -WildcardListener $wildcardListener -TaskExists ([bool]$task)

[ordered]@{
  controller = $controllerProjection
  bind = if ($ControllerHost) { "$ControllerHost`:$ControllerPort" } else { $null }
  tailscaleIpResolved = [bool]$ControllerHost
  privateIpPresent = $ipPresent
  listening = $listener
  wildcardListener = $wildcardListener
  controller_contract = if ($health) { $health.controller_contract } else { $null }
  health_path = if ($health) { $health.health_path } else { $null }
  health_ok = $httpOk
  health_error = if ($health) { $health.health_error } else { $null }
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
