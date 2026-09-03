param(
  [string]$DatabaseUrl = $env:TIGERIQ_DATABASE_URL,
  [string]$Migration = "db/migrations/001_operational_state_v1.sql",
  [string]$ReplayMigration = "db/migrations/002_device_proof_replay_v1.sql"
)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { throw "Set TIGERIQ_DATABASE_URL to the local PC01 PostgreSQL database." }
if ($DatabaseUrl -match '://[^/@:]+:[^/@]+@' -or $DatabaseUrl -match '(?i)password=') { throw "Do not put a database password in TIGERIQ_DATABASE_URL. Use local SSPI/.pgpass/PGPASSWORD according to PC01 security policy." }

$psqlPath = $null
$cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
if ($cmd) {
  if ($cmd.Path) { $psqlPath = $cmd.Path }
  elseif ($cmd.Definition) { $psqlPath = $cmd.Definition }
}
if (-not $psqlPath) {
  foreach ($candidate in @('C:\Program Files\PostgreSQL\17\bin\psql.exe','C:\Program Files\PostgreSQL\16\bin\psql.exe')) {
    if (Test-Path $candidate) { $psqlPath = $candidate; break }
  }
}
if (-not $psqlPath) { throw "psql.exe is not available. Install PostgreSQL locally on PC01 first." }

foreach ($path in @($Migration,$ReplayMigration)) { if (-not (Test-Path $path)) { throw "Migration file not found: $path" } }
Write-Host "Applying TigerIQ operational-state migrations to local PostgreSQL..."
foreach ($path in @($Migration,$ReplayMigration)) {
  & $psqlPath --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -f $path
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL migration failed with exit code $LASTEXITCODE for $path" }
}
$versionCount = (& $psqlPath --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM tigeriq_schema_migrations WHERE version IN ('001_operational_state_v1','002_device_proof_replay_v1');").Trim()
if ($LASTEXITCODE -ne 0 -or $versionCount -ne '2') { throw "PostgreSQL migration verification failed" }
Write-Host "POSTGRES_OPERATIONAL_STATE_V1_REPLAY_READY"
