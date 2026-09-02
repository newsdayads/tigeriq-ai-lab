param(
  [string]$DatabaseUrl = $env:TIGERIQ_DATABASE_URL
)
$ErrorActionPreference = 'SilentlyContinue'
$ExpectedHost = '100.97.23.87'
$ControllerPort = 8790
$TaskName = 'TigerIQ Workforce Controller'
$FirewallName = 'TigerIQ Workforce Controller V1 (Tailscale only)'
$ExpectedRemoteCidr = '100.64.0.0/10'
$ExpectedMigrations = @('001_operational_state_v1','002_device_proof_replay_v1')
$ForbiddenMigration = '003_business_state_v2'

function Resolve-Executable([string]$Name,[string[]]$Candidates) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in $Candidates) { if (Test-Path $candidate) { return $candidate } }
  return $null
}

$tailscale = Resolve-Executable 'tailscale.exe' @('C:\Program Files\Tailscale\tailscale.exe')
$psql = Resolve-Executable 'psql.exe' @('C:\Program Files\PostgreSQL\17\bin\psql.exe','C:\Program Files\PostgreSQL\16\bin\psql.exe')
$ips = if ($tailscale) { @(& $tailscale ip -4 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique) } else { @() }
$tailscaleOk = $ips.Count -eq 1 -and $ips[0] -eq $ExpectedHost

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue } else { $null }
$taskPrincipalOk = [bool]$task -and ([string]$task.Principal.UserId -eq 'SYSTEM')
$taskOk = [bool]$task -and $taskPrincipalOk -and ([string]$task.State -in @('Running','Ready'))

$listeners = @(Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue)
$exact = @($listeners | Where-Object { $_.LocalAddress -eq $ExpectedHost })
$unsafe = @($listeners | Where-Object { $_.LocalAddress -ne $ExpectedHost })
$listenerOk = $exact.Count -eq 1 -and $unsafe.Count -eq 0

$firewall = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue | Select-Object -First 1
$portFilter = if ($firewall) { $firewall | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue | Select-Object -First 1 } else { $null }
$addressFilter = if ($firewall) { $firewall | Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue | Select-Object -First 1 } else { $null }
$remoteAddresses = if ($addressFilter) { @($addressFilter.RemoteAddress) } else { @() }
$localAddresses = if ($addressFilter) { @($addressFilter.LocalAddress) } else { @() }
$firewallOk = [bool]$firewall -and ([string]$firewall.Enabled -eq 'True') -and ([string]$firewall.Direction -eq 'Inbound') -and ([string]$firewall.Action -eq 'Allow') -and ([string]$portFilter.Protocol -eq 'TCP') -and ([string]$portFilter.LocalPort -eq [string]$ControllerPort) -and ($remoteAddresses -contains $ExpectedRemoteCidr) -and ($localAddresses -contains $ExpectedHost)

$dbVersions = @()
$forbiddenApplied = $false
$replayTablePresent = $false
$dbOk = $false
if ($psql -and -not [string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  $dbVersions = @(& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -Atc "SELECT version FROM tigeriq_schema_migrations WHERE version IN ('001_operational_state_v1','002_device_proof_replay_v1') ORDER BY version;" 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $forbidden = (& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM tigeriq_schema_migrations WHERE version='003_business_state_v2';" 2>$null).Trim()
  $replayTable = (& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -Atc "SELECT to_regclass('public.device_proof_replay_state') IS NOT NULL;" 2>$null).Trim()
  $forbiddenApplied = $forbidden -eq '1'
  $replayTablePresent = $replayTable -eq 't'
  $dbOk = $dbVersions.Count -eq 2 -and ($dbVersions -contains '001_operational_state_v1') -and ($dbVersions -contains '002_device_proof_replay_v1') -and -not $forbiddenApplied -and $replayTablePresent
}

$httpOk = $false
$protocol = $null
$controllerMigration = $null
if ($tailscaleOk -and $listenerOk) {
  try {
    $status = Invoke-RestMethod -Uri "http://$ExpectedHost`:$ControllerPort/api/v1/status" -TimeoutSec 5
    $httpOk = [bool]$status.ok -and [bool]$status.postgres -and $status.protocol -eq 'controller-v1'
    $protocol = $status.protocol
    $controllerMigration = $status.migration
  } catch {}
}

$ok = $tailscaleOk -and $taskOk -and $listenerOk -and $firewallOk -and $dbOk -and $httpOk
[ordered]@{
  ok = $ok
  action = 'workforce.controller.v1.health'
  expectedBind = "$ExpectedHost`:$ControllerPort"
  tailscale = [ordered]@{ ok = $tailscaleOk; ipv4 = if ($ips.Count -eq 1) { $ips[0] } else { $null } }
  listener = [ordered]@{ ok = $listenerOk; exactCount = $exact.Count; unsafeCount = $unsafe.Count; addresses = @($listeners | ForEach-Object { $_.LocalAddress }) }
  scheduledTask = [ordered]@{ ok = $taskOk; exists = [bool]$task; principalSystem = $taskPrincipalOk; state = if ($task) { [string]$task.State } else { $null }; lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null } }
  firewall = [ordered]@{ ok = $firewallOk; rule = $FirewallName; localAddress = $localAddresses; localPort = if ($portFilter) { [string]$portFilter.LocalPort } else { $null }; remoteAddress = $remoteAddresses }
  postgres = [ordered]@{ ok = $dbOk; migrations = $dbVersions; replayTable = $replayTablePresent; forbidden003Applied = $forbiddenApplied }
  http = [ordered]@{ ok = $httpOk; protocol = $protocol; postgres = $httpOk; controllerMigrationField = $controllerMigration }
} | ConvertTo-Json -Depth 6 -Compress
if (-not $ok) { exit 2 }
