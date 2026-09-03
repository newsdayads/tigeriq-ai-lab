param(
  [string]$DatabaseUrl = $env:TIGERIQ_DATABASE_URL
)
$ErrorActionPreference = 'SilentlyContinue'
$ExpectedHost = '100.97.23.87'
$ControllerPort = 8790
$TaskName = 'TigerIQ Workforce Controller'
$RequiredMigrations = @('001_operational_state_v1','002_device_proof_replay_v1')

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
$listeners = @(Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue)
$exact = @($listeners | Where-Object { $_.LocalAddress -eq $ExpectedHost })
$unsafe = @($listeners | Where-Object { $_.LocalAddress -ne $ExpectedHost })
$listenerOk = $exact.Count -eq 1 -and $unsafe.Count -eq 0

$appliedMigrations = @()
if ($psql -and -not [string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  $raw = & $psql $DatabaseUrl -v ON_ERROR_STOP=1 -Atc "SELECT version FROM tigeriq_schema_migrations WHERE version IN ('001_operational_state_v1','002_device_proof_replay_v1') ORDER BY version;" 2>$null
  if ($LASTEXITCODE -eq 0) { $appliedMigrations = @($raw | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
}
$dbOk = @($RequiredMigrations | Where-Object { $_ -notin $appliedMigrations }).Count -eq 0

$httpOk = $false
$protocol = $null
if ($tailscaleOk -and $listenerOk) {
  try {
    $status = Invoke-RestMethod -Uri "http://$ExpectedHost`:$ControllerPort/api/v1/status" -TimeoutSec 5
    $httpOk = [bool]$status.ok -and [bool]$status.postgres -and $status.protocol -eq 'controller-v1'
    $protocol = $status.protocol
  } catch {}
}

$ok = $tailscaleOk -and [bool]$task -and $listenerOk -and $dbOk -and $httpOk
[ordered]@{
  ok = $ok
  action = 'workforce.controller.v1.health'
  expectedBind = "$ExpectedHost`:$ControllerPort"
  tailscale = [ordered]@{ ok = $tailscaleOk; ipv4 = if ($ips.Count -eq 1) { $ips[0] } else { $null } }
  listener = [ordered]@{ ok = $listenerOk; exactCount = $exact.Count; unsafeCount = $unsafe.Count; addresses = @($listeners | ForEach-Object { $_.LocalAddress }) }
  scheduledTask = [ordered]@{ exists = [bool]$task; state = if ($task) { [string]$task.State } else { $null }; lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null } }
  postgres = [ordered]@{ ok = $dbOk; requiredMigrations = $RequiredMigrations; appliedMigrations = $appliedMigrations }
  http = [ordered]@{ ok = $httpOk; protocol = $protocol }
} | ConvertTo-Json -Depth 5 -Compress
if (-not $ok) { exit 2 }
