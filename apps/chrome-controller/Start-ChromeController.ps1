param(
  [string]$Config = "D:\TigerIQ\Config\chrome-controller.json"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$server = Join-Path $root "dist\apps\chrome-controller\src\server.js"

if (-not (Test-Path $Config)) {
  throw "Config not found: $Config"
}
if (-not (Test-Path $server)) {
  throw "Controller runtime not found: $server"
}

$env:TIGERIQ_CHROME_CONFIG = $Config
# Block legacy config locations robustly
$resolvedConfigPath = [System.IO.Path]::GetFullPath($Config)
if ($resolvedConfigPath -match "[\\/](legacy|old|deprecated)[\\/]") {
  throw "Legacy config paths are blocked: $Config"
}
# Prevent launching if a lock file exists atomically (idempotent start)
$lockFile = Join-Path $root "dist\apps\chrome-controller\controller.lock"
$lockDir = Split-Path $lockFile -Parent
if (-not (Test-Path $lockDir)) {
  New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
}
$global:controllerLockStream = $null
try {
  $global:controllerLockStream = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
} catch {
  Write-Host "Chrome controller already running (lock file present). Exiting."
  exit 0
}
try {
  Set-Location $root
  & node $server
} finally {
  if ($global:controllerLockStream) {
    try { $global:controllerLockStream.Close(); $global:controllerLockStream.Dispose() } catch {}
  }
  if (Test-Path $lockFile) {
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
  }
}
exit $LASTEXITCODE
