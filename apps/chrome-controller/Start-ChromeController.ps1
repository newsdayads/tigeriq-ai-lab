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
# Prevent launching if a lock file exists (idempotent start)
$lockFile = Join-Path $root "dist\apps\chrome-controller\controller.lock"
if (Test-Path $lockFile) {
  Write-Host "Chrome controller already running (lock file present). Exiting."
  exit 0
}
# Block legacy config locations (e.g., paths containing 'legacy')
if ($Config -match "legacy") {
  throw "Legacy config paths are blocked: $Config"
}
# Create lock file to indicate running instance
New-Item -ItemType File -Path $lockFile -Force | Out-Null
try {
  Set-Location $root
  & node $server
} finally {
  if (Test-Path $lockFile) {
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
  }
}
exit $LASTEXITCODE
