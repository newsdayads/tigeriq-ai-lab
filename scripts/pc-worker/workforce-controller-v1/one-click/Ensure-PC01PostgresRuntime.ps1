param(
  [string]$SecretsRoot = 'F:\TigerIQ\Secrets',
  [string]$EvidenceDir = 'F:\TigerIQ\Evidence\pc01-one-click',
  [string]$DatabaseUrl = $env:TIGERIQ_DATABASE_URL,
  [switch]$AllowInstall
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$DatabaseUrlFile = Join-Path $SecretsRoot 'workforce-controller-v1.database-url'
$PgPassFile = Join-Path $SecretsRoot 'workforce-controller-v1.pgpass'
$AdminSecretFile = Join-Path $SecretsRoot 'postgres-bootstrap-admin.secret'
$InstallOptionFile = Join-Path $SecretsRoot 'postgres-install-options.conf'
$BootstrapSqlFile = Join-Path $SecretsRoot 'postgres-bootstrap-runtime.sql'
$CanonicalService = 'TigerIQPostgreSQL16'
$CanonicalHost = '127.0.0.1'
$CanonicalPort = 5432
$CanonicalDatabase = 'tigeriq'
$CanonicalUser = 'tigeriq_runtime'
$PostgresWingetId = 'PostgreSQL.PostgreSQL.16'
$CanonicalDataDir = 'F:\TigerIQ\PostgreSQL\16\data'

function Fail([string]$Code,[string]$Message) { throw "$Code`: $Message" }
function Resolve-Executable([string]$Name,[string[]]$Candidates) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in $Candidates) { if (Test-Path $candidate) { return $candidate } }
  return $null
}
function Protect-LocalFile([string]$Path) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
  Set-Acl -Path $Path -AclObject $acl
}
function Write-ProtectedText([string]$Path,[string]$Value) {
  $parent = Split-Path $Path -Parent
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  [IO.File]::WriteAllText($Path,$Value,(New-Object Text.UTF8Encoding($false)))
  Protect-LocalFile $Path
}
function New-StrongSecret {
  $bytes = New-Object byte[] 36
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return (([Convert]::ToBase64String($bytes)).TrimEnd('=').Replace('+','X').Replace('/','Y') + '!Aa9')
}
function Resolve-Psql {
  return Resolve-Executable 'psql.exe' @('C:\Program Files\PostgreSQL\17\bin\psql.exe','C:\Program Files\PostgreSQL\16\bin\psql.exe')
}
function Get-PostgresServices {
  return @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)postgres' -or $_.DisplayName -match '(?i)postgres' -or $_.PathName -match '(?i)postgres' })
}
function Get-ConfiguredDatabaseUrl {
  if (-not [string]::IsNullOrWhiteSpace($DatabaseUrl)) { return $DatabaseUrl.Trim() }
  if (Test-Path $DatabaseUrlFile) { return [IO.File]::ReadAllText($DatabaseUrlFile).Trim() }
  return $null
}
function Assert-CanonicalReuseUrl([string]$Url) {
  if ([string]::IsNullOrWhiteSpace($Url)) { Fail 'DATABASE_URL_MISSING' 'Canonical TigerIQ database URL is missing.' }
  if ($Url -match '://[^/@:]+:[^/@]+@' -or $Url -match '(?i)password=') { Fail 'POSTGRES_EXISTING_UNMANAGED' 'Configured PostgreSQL URL contains an inline secret and cannot prove the canonical datastore.' }
  try { $uri = [Uri]$Url } catch { Fail 'POSTGRES_EXISTING_UNMANAGED' 'Configured PostgreSQL URL is ambiguous; refusing to reuse an unmanaged datastore.' }
  $port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
  $database = $uri.AbsolutePath.Trim('/')
  $role = $uri.UserInfo
  if (
    $uri.Scheme -notin @('postgres','postgresql') -or
    $uri.Host -ne $CanonicalHost -or
    $port -ne $CanonicalPort -or
    $database -ne $CanonicalDatabase -or
    $role -ne $CanonicalUser -or
    -not [string]::IsNullOrWhiteSpace($uri.Query) -or
    -not [string]::IsNullOrWhiteSpace($uri.Fragment)
  ) {
    Fail 'POSTGRES_EXISTING_UNMANAGED' 'Configured PostgreSQL is not exactly 127.0.0.1:5432/tigeriq as tigeriq_runtime; refusing to reuse or migrate an unmanaged datastore.'
  }
  return $uri
}
function Ensure-PgPassFromEnvironment([Uri]$Uri) {
  if (Test-Path $PgPassFile) { Protect-LocalFile $PgPassFile; return $true }
  if ([string]::IsNullOrWhiteSpace($env:PGPASSWORD)) { return $false }
  $user = ($Uri.UserInfo -split ':')[0]
  if ([string]::IsNullOrWhiteSpace($user)) { Fail 'DATABASE_USER_MISSING' 'Database URL must name the runtime role.' }
  $port = if ($Uri.Port -gt 0) { $Uri.Port } else { 5432 }
  $database = $Uri.AbsolutePath.TrimStart('/')
  if ([string]::IsNullOrWhiteSpace($database)) { Fail 'DATABASE_NAME_MISSING' 'Database URL must name the runtime database.' }
  Write-ProtectedText $PgPassFile "$($Uri.Host):$port`:$database`:$user`:$($env:PGPASSWORD)`r`n"
  $env:PGPASSWORD = $null
  return $true
}
function Test-RuntimeConnection([string]$Url,[string]$Psql) {
  $env:PGPASSFILE = $PgPassFile
  $probe = (& $Psql $Url -v ON_ERROR_STOP=1 -Atc 'SELECT 1;' 2>$null).Trim()
  return ($LASTEXITCODE -eq 0 -and $probe -eq '1')
}
function Wait-Postgres([string]$Psql,[string]$AdminPassword) {
  $env:PGPASSWORD = $AdminPassword
  try {
    $deadline = (Get-Date).AddSeconds(60)
    do {
      Start-Sleep -Seconds 1
      $probe = (& $Psql -h $CanonicalHost -p $CanonicalPort -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc 'SELECT 1;' 2>$null).Trim()
      if ($LASTEXITCODE -eq 0 -and $probe -eq '1') { return }
    } while ((Get-Date) -lt $deadline)
  } finally { $env:PGPASSWORD = $null }
  Fail 'POSTGRES_START_TIMEOUT' 'Canonical PostgreSQL did not become ready.'
}
function Install-CanonicalPostgres {
  if (-not $AllowInstall) { Fail 'POSTGRES_MISSING' 'PostgreSQL is missing and automatic free installation is disabled.' }
  $services = Get-PostgresServices
  if ($services.Count -gt 0) { Fail 'POSTGRES_EXISTING_UNMANAGED' 'PostgreSQL service already exists but no canonical TigerIQ datastore configuration was found; refusing to create a parallel datastore.' }
  $portUsers = @(Get-NetTCPConnection -LocalPort $CanonicalPort -State Listen -ErrorAction SilentlyContinue)
  if ($portUsers.Count -gt 0) { Fail 'POSTGRES_PORT_IN_USE' 'Port 5432 is already occupied; refusing to install another datastore.' }
  $winget = Resolve-Executable 'winget.exe' @("$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe")
  if (-not $winget) { Fail 'WINGET_MISSING' 'PostgreSQL is missing and WinGet is unavailable.' }

  New-Item -ItemType Directory -Force -Path $SecretsRoot,$CanonicalDataDir | Out-Null
  $adminSecret = New-StrongSecret
  Write-ProtectedText $AdminSecretFile $adminSecret
  $option = @(
    'mode=unattended',
    'unattendedmodeui=none',
    'superaccount=postgres',
    "superpassword=$adminSecret",
    "servicepassword=$adminSecret",
    "servicename=$CanonicalService",
    "serverport=$CanonicalPort",
    "datadir=$CanonicalDataDir"
  ) -join "`r`n"
  Write-ProtectedText $InstallOptionFile ($option + "`r`n")
  try {
    $override = "--mode unattended --unattendedmodeui none --optionfile `"$InstallOptionFile`""
    & $winget install --id $PostgresWingetId --exact --disable-interactivity --accept-package-agreements --accept-source-agreements --override $override | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'POSTGRES_INSTALL_FAILED' 'Free PostgreSQL 16 installation failed.' }
  } finally {
    Remove-Item $InstallOptionFile -Force -ErrorAction SilentlyContinue
  }

  $psql = Resolve-Psql
  if (-not $psql) { Fail 'POSTGRES_INSTALL_INCOMPLETE' 'PostgreSQL installed but psql was not found.' }
  $service = Get-Service -Name $CanonicalService -ErrorAction SilentlyContinue
  if (-not $service) { Fail 'POSTGRES_SERVICE_MISSING' 'Canonical PostgreSQL Windows service was not created.' }
  Set-Service -Name $CanonicalService -StartupType Automatic
  if ($service.Status -ne 'Running') { Start-Service -Name $CanonicalService }
  Wait-Postgres $psql $adminSecret
  return [pscustomobject]@{ psql=$psql; adminPassword=$adminSecret; installed=$true; service=$CanonicalService }
}
function Provision-RuntimeDatabase([string]$Psql,[string]$AdminPassword) {
  $createdb = Join-Path (Split-Path $Psql -Parent) 'createdb.exe'
  if (-not (Test-Path $createdb)) { Fail 'CREATEDB_MISSING' 'createdb.exe is required for canonical database provisioning.' }
  $runtimeSecret = New-StrongSecret
  $sql = @"
DO `$tigeriq`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$CanonicalUser') THEN
    CREATE ROLE $CanonicalUser LOGIN;
  END IF;
END
`$tigeriq`$;
ALTER ROLE $CanonicalUser WITH LOGIN PASSWORD '$runtimeSecret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
"@
  Write-ProtectedText $BootstrapSqlFile $sql
  $env:PGPASSWORD = $AdminPassword
  try {
    & $Psql -h $CanonicalHost -p $CanonicalPort -U postgres -d postgres -v ON_ERROR_STOP=1 -f $BootstrapSqlFile | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'POSTGRES_ROLE_PROVISION_FAILED' 'Could not provision the TigerIQ runtime role.' }
    $exists = (& $Psql -h $CanonicalHost -p $CanonicalPort -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_database WHERE datname='$CanonicalDatabase';" 2>$null).Trim()
    if ($LASTEXITCODE -ne 0) { Fail 'POSTGRES_DATABASE_PROBE_FAILED' 'Could not inspect the TigerIQ database.' }
    if ($exists -eq '0') {
      & $createdb -h $CanonicalHost -p $CanonicalPort -U postgres -O $CanonicalUser $CanonicalDatabase
      if ($LASTEXITCODE -ne 0) { Fail 'POSTGRES_DATABASE_CREATE_FAILED' 'Could not create the TigerIQ operational database.' }
    } elseif ($exists -ne '1') { Fail 'POSTGRES_DATABASE_STATE_INVALID' 'Unexpected TigerIQ database state.' }
  } finally {
    $env:PGPASSWORD = $null
    Remove-Item $BootstrapSqlFile -Force -ErrorAction SilentlyContinue
  }

  $url = "postgresql://$CanonicalUser@$CanonicalHost`:$CanonicalPort/$CanonicalDatabase"
  Write-ProtectedText $PgPassFile "$CanonicalHost`:$CanonicalPort`:$CanonicalDatabase`:$CanonicalUser`:$runtimeSecret`r`n"
  Write-ProtectedText $DatabaseUrlFile $url
  $env:PGPASSFILE = $PgPassFile
  if (-not (Test-RuntimeConnection $url $Psql)) { Fail 'POSTGRES_RUNTIME_AUTH_FAILED' 'Canonical TigerIQ runtime role/database probe failed.' }
  Remove-Item $AdminSecretFile -Force -ErrorAction SilentlyContinue
  return $url
}

New-Item -ItemType Directory -Force -Path $SecretsRoot,$EvidenceDir | Out-Null
$configuredUrl = Get-ConfiguredDatabaseUrl
$psql = Resolve-Psql

if (-not [string]::IsNullOrWhiteSpace($configuredUrl)) {
  $uri = Assert-CanonicalReuseUrl $configuredUrl
  if (-not $psql) { Fail 'PSQL_MISSING_FOR_CONFIGURED_DB' 'Canonical database is configured but psql is unavailable; refusing to install a parallel PostgreSQL instance.' }
  $durableCredential = Ensure-PgPassFromEnvironment $uri
  if (-not $durableCredential) { Fail 'DATABASE_CREDENTIAL_NOT_DURABLE' 'Canonical database URL exists but no SYSTEM-readable protected .pgpass is available.' }
  if (-not (Test-RuntimeConnection $configuredUrl $psql)) { Fail 'POSTGRES_CONNECTION_FAILED' 'Configured canonical TigerIQ PostgreSQL is not reachable.' }
  [pscustomobject]@{
    ok=$true; action='pc01.postgres.ensure'; installedPostgres=$false; reusedConfiguredDatastore=$true;
    databaseUrl=$configuredUrl; pgPassFile=$PgPassFile; serviceNames=@((Get-PostgresServices | ForEach-Object { $_.Name })); secretsPrinted=$false
  }
  exit 0
}

$servicesBefore = Get-PostgresServices
if ($servicesBefore.Count -gt 0 -and -not (Test-Path $AdminSecretFile)) {
  Fail 'POSTGRES_EXISTING_UNMANAGED' 'PostgreSQL exists but no canonical TigerIQ datastore/credential is configured; fail-closed prevents a second datastore.'
}

$installState = $null
if (-not $psql) {
  $installState = Install-CanonicalPostgres
  $psql = $installState.psql
} else {
  $canonicalService = Get-Service -Name $CanonicalService -ErrorAction SilentlyContinue
  if (-not $canonicalService -or -not (Test-Path $AdminSecretFile)) {
    Fail 'POSTGRES_EXISTING_UNMANAGED' 'PostgreSQL binaries exist without canonical TigerIQ bootstrap state; refusing ambiguous provisioning.'
  }
  $adminSecret = [IO.File]::ReadAllText($AdminSecretFile).Trim()
  if ([string]::IsNullOrWhiteSpace($adminSecret)) { Fail 'POSTGRES_ADMIN_SECRET_INVALID' 'Protected PostgreSQL bootstrap state is invalid.' }
  if ($canonicalService.Status -ne 'Running') { Start-Service -Name $CanonicalService }
  Wait-Postgres $psql $adminSecret
  $installState = [pscustomobject]@{ psql=$psql; adminPassword=$adminSecret; installed=$false; service=$CanonicalService }
}

$runtimeUrl = Provision-RuntimeDatabase $psql $installState.adminPassword
[pscustomobject]@{
  ok=$true; action='pc01.postgres.ensure'; installedPostgres=[bool]$installState.installed; reusedConfiguredDatastore=$false;
  databaseUrl=$runtimeUrl; pgPassFile=$PgPassFile; serviceNames=@($CanonicalService); secretsPrinted=$false
}
