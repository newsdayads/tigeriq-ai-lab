param(
  [string]$DatabaseUrl = $env:TIGERIQ_DATABASE_URL,
  [string]$PgPassFile = $env:PGPASSFILE,
  [string]$HealthScript = (Join-Path (Split-Path $PSScriptRoot -Parent) 'health-workforce-controller-v1.ps1')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$TaskName = 'TigerIQ Workforce Controller'
$ExpectedHost = '100.97.23.87'
$ControllerPort = 8790
if ([string]::IsNullOrWhiteSpace($PgPassFile)) { $PgPassFile = 'F:\TigerIQ\Secrets\workforce-controller-v1.pgpass' }

function Fail([string]$Code,[string]$Message) { throw "$Code`: $Message" }
function Resolve-Psql {
  $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in @('C:\Program Files\PostgreSQL\17\bin\psql.exe','C:\Program Files\PostgreSQL\16\bin\psql.exe')) { if (Test-Path $candidate) { return $candidate } }
  return $null
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { Fail 'DATABASE_URL_MISSING' 'Database configuration is required.' }
if ($DatabaseUrl -match '://[^/@:]+:[^/@]+@' -or $DatabaseUrl -match '(?i)password=') { Fail 'DATABASE_URL_SECRET' 'Database URL must not contain an inline password.' }
if (-not (Test-Path $PgPassFile)) { Fail 'PGPASS_MISSING' 'Protected PostgreSQL credential file is required.' }
$env:PGPASSFILE = $PgPassFile
if (-not (Test-Path $HealthScript)) { Fail 'HEALTH_SCRIPT_MISSING' 'Health script is missing.' }
$psql = Resolve-Psql
if (-not $psql) { Fail 'PSQL_MISSING' 'psql is unavailable.' }
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { Fail 'TASK_MISSING' 'Canonical Controller task is missing.' }
if ([string]$task.Principal.UserId -ne 'SYSTEM') { Fail 'TASK_PRINCIPAL_INVALID' 'Canonical Controller task must run as SYSTEM.' }

$beforeReplay = (& $psql -w $DatabaseUrl -vON_ERROR_STOP=1 -Atc "SELECT count(*) FROM device_proof_replay_state;" 2>$null).Trim()
if ($LASTEXITCODE -ne 0) { Fail 'REPLAY_STATE_QUERY_FAILED' 'Could not query durable replay state before restart.' }
$beforeMigrations = @(& $psql -w $DatabaseUrl -vON_ERROR_STOP=1 -Atc "SELECT version FROM tigeriq_schema_migrations ORDER BY version;" 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($beforeMigrations.Count -ne 2 -or $beforeMigrations[0] -ne '001_operational_state_v1' -or $beforeMigrations[1] -ne '002_device_proof_replay_v1') { Fail 'MIGRATION_STATE_INVALID' 'Required migration state must be exactly reviewed 001+002 before restart.' }

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$deadline = (Get-Date).AddSeconds(20)
do { Start-Sleep -Milliseconds 500; $listeners = @(Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue) } while ($listeners.Count -gt 0 -and (Get-Date) -lt $deadline)
if ($listeners.Count -gt 0) { Fail 'LISTENER_DID_NOT_STOP' 'Controller listener did not stop cleanly.' }

Start-ScheduledTask -TaskName $TaskName
$healthy = $false; $deadline = (Get-Date).AddSeconds(40)
do {
  Start-Sleep -Seconds 1
  & $HealthScript -DatabaseUrl $DatabaseUrl -PgPassFile $PgPassFile 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $healthy = $true; break }
} while ((Get-Date) -lt $deadline)
if (-not $healthy) { Fail 'RESTART_HEALTH_FAILED' 'Controller did not return healthy after task restart.' }

$afterReplay = (& $psql -w $DatabaseUrl -vON_ERROR_STOP=1 -Atc "SELECT count(*) FROM device_proof_replay_state;" 2>$null).Trim()
if ($LASTEXITCODE -ne 0) { Fail 'REPLAY_STATE_QUERY_FAILED' 'Could not query durable replay state after restart.' }
$afterMigrations = @(& $psql -w $DatabaseUrl -vON_ERROR_STOP=1 -Atc "SELECT version FROM tigeriq_schema_migrations ORDER BY version;" 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($afterMigrations.Count -ne 2 -or $afterMigrations[0] -ne '001_operational_state_v1' -or $afterMigrations[1] -ne '002_device_proof_replay_v1') { Fail 'MIGRATION_STATE_LOST' 'Required exact migration state changed across restart.' }
if ($afterReplay -ne $beforeReplay) { Fail 'REPLAY_STATE_CHANGED' 'Durable replay state row count changed during Controller-only restart.' }

[ordered]@{ok=$true;action='workforce.controller.v1.restart.verify';bind="$ExpectedHost`:$ControllerPort";migrations=$afterMigrations;replayStateRowsBefore=[int64]$beforeReplay;replayStateRowsAfter=[int64]$afterReplay;durableReplayStatePreserved=$true;systemTaskVerified=$true;marker='PC01_CONTROLLER_RESTART_VERIFICATION_PASS'} | ConvertTo-Json -Compress
