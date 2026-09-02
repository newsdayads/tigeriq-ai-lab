param(
  [string]$DatabaseUrl = $env:TIGERIQ_DATABASE_URL,
  [string]$Migration = "db/migrations/001_operational_state_v1.sql"
)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { throw "Set TIGERIQ_DATABASE_URL to the local PC01 PostgreSQL database." }
if ($DatabaseUrl -match '://[^/@:]+:[^/@]+@' -or $DatabaseUrl -match '(?i)password=') { throw "Do not put a database password in TIGERIQ_DATABASE_URL. Use local SSPI/.pgpass/PGPASSWORD according to PC01 security policy." }
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw "psql is not available in PATH. Install PostgreSQL locally on PC01 first." }
if (-not (Test-Path $Migration)) { throw "Migration file not found: $Migration" }
Write-Host "Applying TigerIQ operational-state migration to local PostgreSQL..."
& psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $Migration
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL migration failed with exit code $LASTEXITCODE" }
$version = & psql $DatabaseUrl -v ON_ERROR_STOP=1 -Atc "SELECT version FROM tigeriq_schema_migrations WHERE version='001_operational_state_v1';"
if ($LASTEXITCODE -ne 0 -or $version -ne '001_operational_state_v1') { throw "PostgreSQL migration verification failed" }
Write-Host "POSTGRES_OPERATIONAL_STATE_V1_READY"
