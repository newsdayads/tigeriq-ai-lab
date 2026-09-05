param(
  [string]$Workspace = 'F:\TigerIQ\Workspace\tigeriq-ai-lab'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$TaskName = 'TigerIQ Workforce Controller'
$ExpectedHost = '100.97.23.87'
$ExpectedPort = 8790
$HealthPath = '/api/workforce/status'
$StatusContractRepair = Join-Path $PSScriptRoot 'repair-control-plane-controller-status-contract.ps1'
$Entry = Join-Path $Workspace 'dist\apps\workforce-controller\src\standalone.js'
$PackageJson = Join-Path $Workspace 'package.json'
$PackageLock = Join-Path $Workspace 'package-lock.json'
$DbUrlFile = 'F:\TigerIQ\Secrets\workforce-controller-v1.database-url'
$PgPassFile = 'F:\TigerIQ\Secrets\workforce-controller-v1.pgpass'
$BackupDir = Join-Path 'F:\TigerIQ\Worker\backup' ("controller-runtime-deps-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$InstallLog = 'F:\TigerIQ\Worker\controller-runtime-deps.log'
$PgInstalled = $false
$TaskRestarted = $false
$StatusContract = 'READY'

function Fail([string]$Code, [string]$Message) {
  throw "$Code`: $Message"
}

function Hash-File([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Test-PgImport([string]$NodePath) {
  Push-Location $Workspace
  try {
    & $NodePath -e "import('pg').then(()=>process.exit(0)).catch(()=>process.exit(2))" *> $null
    return ($LASTEXITCODE -eq 0)
  } finally {
    Pop-Location
  }
}

function Test-ExpectedListener {
  $rows = @(Get-NetTCPConnection -LocalPort $ExpectedPort -State Listen -ErrorAction SilentlyContinue)
  $safe = @($rows | Where-Object { $_.LocalAddress -eq $ExpectedHost })
  $unsafe = @($rows | Where-Object { $_.LocalAddress -in @('0.0.0.0','::') })
  return [ordered]@{
    ready = ($safe.Count -gt 0 -and $unsafe.Count -eq 0)
    expected = $safe.Count
    wildcard = $unsafe.Count
  }
}

$packageHashBefore = $null
$lockHashBefore = $null
$packageBackup = $null
$lockBackup = $null

try {
  if ($env:COMPUTERNAME -ne 'PC01') { Fail 'WRONG_HOST' 'PC01 only.' }
  if (-not (Test-Path -LiteralPath $Workspace)) { Fail 'WORKSPACE_MISSING' $Workspace }
  if (-not (Test-Path -LiteralPath $Entry)) { Fail 'CONTROLLER_ENTRY_MISSING' $Entry }
  if (-not (Test-Path -LiteralPath $PackageJson)) { Fail 'PACKAGE_JSON_MISSING' $PackageJson }
  if (-not (Test-Path -LiteralPath $PackageLock)) { Fail 'PACKAGE_LOCK_MISSING' $PackageLock }
  if (-not (Test-Path -LiteralPath $DbUrlFile)) { Fail 'DATABASE_URL_FILE_MISSING' 'Controller database URL file is missing.' }
  if (-not (Test-Path -LiteralPath $PgPassFile)) { Fail 'PGPASS_FILE_MISSING' 'Controller pgpass file is missing.' }
  if (-not (Test-Path -LiteralPath $StatusContractRepair)) { Fail 'STATUS_CONTRACT_REPAIR_MISSING' $StatusContractRepair }

  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  $powershell = Get-Command powershell.exe -ErrorAction SilentlyContinue
  if (-not $node) { Fail 'NODE_MISSING' 'node.exe was not found.' }
  if (-not $npm) { Fail 'NPM_MISSING' 'npm.cmd was not found.' }
  if (-not $powershell) { Fail 'POWERSHELL_MISSING' 'powershell.exe was not found.' }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop

  $contractOutput = @(& $powershell.Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $StatusContractRepair 2>&1)
  $contractExit = $LASTEXITCODE
  $contractText = ($contractOutput | ForEach-Object { [string]$_ }) -join "`n"
  if ($contractExit -ne 0 -or ($contractText -notmatch '"status"\s*:\s*"PASS"')) {
    Fail 'STATUS_CONTRACT_REPAIR_FAILED' ($contractText.Substring(0,[Math]::Min(800,$contractText.Length)))
  }
  if ($contractText -match '"contract"\s*:\s*"REPAIRED"') { $StatusContract = 'REPAIRED' }

  New-Item -ItemType Directory -Force -Path $BackupDir, (Split-Path $InstallLog -Parent) | Out-Null
  $packageHashBefore = Hash-File $PackageJson
  $lockHashBefore = Hash-File $PackageLock
  $packageBackup = Join-Path $BackupDir 'package.json'
  $lockBackup = Join-Path $BackupDir 'package-lock.json'
  Copy-Item -LiteralPath $PackageJson -Destination $packageBackup -Force
  Copy-Item -LiteralPath $PackageLock -Destination $lockBackup -Force

  if (-not (Test-PgImport $node.Source)) {
    Push-Location $Workspace
    try {
      & $npm.Source install --no-save --package-lock=false --ignore-scripts --no-audit --no-fund 'pg@8' *> $InstallLog
      $npmExit = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    if ($npmExit -ne 0) { Fail 'PG_INSTALL_FAILED' "npm exited with code $npmExit." }
    $PgInstalled = $true
  }

  $packageHashAfter = Hash-File $PackageJson
  $lockHashAfter = Hash-File $PackageLock
  if ($packageHashAfter -ne $packageHashBefore -or $lockHashAfter -ne $lockHashBefore) {
    Copy-Item -LiteralPath $packageBackup -Destination $PackageJson -Force
    Copy-Item -LiteralPath $lockBackup -Destination $PackageLock -Force
    Fail 'TRACKED_PACKAGE_MUTATION' 'package.json or package-lock.json changed and was restored.'
  }
  if (-not (Test-PgImport $node.Source)) { Fail 'PG_IMPORT_FAILED' 'pg is still not importable from the physical workspace.' }

  $listener = Test-ExpectedListener
  if (-not $listener.ready) {
    if ($task.State -eq 'Running') {
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    }
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $TaskRestarted = $true
  }

  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Seconds 2
    $listener = Test-ExpectedListener
    if ($listener.ready) { break }
  } while ((Get-Date) -lt $deadline)

  if (-not $listener.ready) { Fail 'CONTROLLER_LISTENER_NOT_READY' 'Expected Tailscale-only listener did not become ready.' }

  $health = $null
  try {
    $health = Invoke-RestMethod -Uri "http://$ExpectedHost`:$ExpectedPort$HealthPath" -TimeoutSec 5
  } catch {
    Fail 'CONTROLLER_HTTP_UNHEALTHY' "GET $HealthPath failed."
  }
  if (-not [bool]$health.ok) { Fail 'CONTROLLER_STATUS_NOT_OK' 'Controller status did not report ok=true.' }
  if ($null -eq $health.workforce) { Fail 'CONTROLLER_WORKFORCE_STATUS_MISSING' 'Controller status did not include workforce state.' }

  [ordered]@{
    status = 'PASS'
    runtime = if ($PgInstalled -or $TaskRestarted -or $StatusContract -eq 'REPAIRED') { 'REPAIRED' } else { 'READY' }
    statusContract = $StatusContract
    pgImport = $true
    pgInstalled = $PgInstalled
    taskRestarted = $TaskRestarted
    bind = "$ExpectedHost`:$ExpectedPort"
    wildcardListener = [bool]($listener.wildcard -gt 0)
    http = $true
    healthPath = $HealthPath
    workforceStatus = $true
    trackedPackageFilesUnchanged = $true
  } | ConvertTo-Json -Compress
  exit 0
} catch {
  try {
    if ($packageBackup -and (Test-Path -LiteralPath $packageBackup) -and (Hash-File $PackageJson) -ne $packageHashBefore) {
      Copy-Item -LiteralPath $packageBackup -Destination $PackageJson -Force
    }
    if ($lockBackup -and (Test-Path -LiteralPath $lockBackup) -and (Hash-File $PackageLock) -ne $lockHashBefore) {
      Copy-Item -LiteralPath $lockBackup -Destination $PackageLock -Force
    }
  } catch {}
  [ordered]@{
    status = 'FAIL'
    error = $_.Exception.Message
    statusContract = $StatusContract
    pgInstalled = $PgInstalled
    taskRestarted = $TaskRestarted
    trackedPackageFilesRestored = $true
  } | ConvertTo-Json -Compress
  exit 1
}
