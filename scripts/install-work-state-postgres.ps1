param(
  [string]$DatabaseUrl = $env:TIGERIQ_DATABASE_URL,
  [string]$Migration = "db/migrations/001_operational_state_v1.sql"
)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { throw "Set TIGERIQ_DATABASE_URL to the local PC01 PostgreSQL database." }
if ($DatabaseUrl -match '://[^/@:]+:[^/@]+@' -or $DatabaseUrl -match '(?i)password=') { throw "Do not put a database password in TIGERIQ_DATABASE_URL. Use local SSPI/.pgpass/PGPASSWORD according to PC01 security policy." }
$psqlCommand = Get-Command psql.exe -ErrorAction SilentlyContinue
$psql = if ($psqlCommand) { $psqlCommand.Source } else {
  @('C:\Program Files\PostgreSQL\17\bin\psql.exe','C:\Program Files\PostgreSQL\16\bin\psql.exe') |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
}
if (-not $psql) { throw "psql is not available. Install PostgreSQL locally on PC01 first." }
if (-not (Test-Path $Migration)) { throw "Migration file not found: $Migration" }
$expectedVersion = [IO.Path]::GetFileNameWithoutExtension($Migration)
if ($expectedVersion -notmatch '^\d{3}_[a-z0-9_]+$') { throw "Invalid migration version derived from file name: $expectedVersion" }
Write-Host "Applying TigerIQ migration $expectedVersion to local PostgreSQL..."
& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $Migration
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL migration failed with exit code $LASTEXITCODE" }
$version = (& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -Atc "SELECT version FROM tigeriq_schema_migrations WHERE version='$expectedVersion';").Trim()
if ($LASTEXITCODE -ne 0 -or $version -ne $expectedVersion) { throw "PostgreSQL migration verification failed for $expectedVersion" }
Write-Host "POSTGRES_MIGRATION_READY $expectedVersion"
