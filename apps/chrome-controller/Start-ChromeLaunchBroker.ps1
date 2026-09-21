param(
  [string]$Config = "D:\TigerIQ\Config\chrome-controller.json"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$broker = Join-Path $root "dist\apps\chrome-controller\src\chrome-launch-broker.js"
if (-not (Test-Path $Config)) { throw "Config not found: $Config" }
if (-not (Test-Path $broker)) { throw "Chrome launch broker runtime not found: $broker" }
$env:TIGERIQ_CHROME_CONFIG = $Config
# Block legacy config locations robustly
$resolvedConfigPath = [System.IO.Path]::GetFullPath($Config)
if ($resolvedConfigPath -match "[\\/](legacy|old|deprecated)[\\/]") {
  throw "Legacy config paths are blocked: $Config"
}
# Prevent duplicate broker launch via atomic lock file (idempotent)
$brokerLock = Join-Path $root "dist\apps\chrome-controller\broker.lock"
$brokerLockDir = Split-Path $brokerLock -Parent
if (-not (Test-Path $brokerLockDir)) {
  New-Item -ItemType Directory -Path $brokerLockDir -Force | Out-Null
}
try {
  $fs = [System.IO.File]::Open($brokerLock, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $fs.Close()
  $fs.Dispose()
} catch {
  Write-Host "Chrome launch broker already running (lock file present). Exiting."
  exit 0
}
try {
  # Scheduled interactive tasks can have SESSIONNAME unset even though they run in
  # the signed-in user's desktop session. Pass the actual Windows SessionId to
  # the broker; model.ts still fails closed for Session 0 / Services.
  $sessionId = (Get-Process -Id $PID).SessionId
  $env:TIGERIQ_WINDOWS_SESSION_ID = [string]$sessionId
  Set-Location $root
  & node $broker $Config
} finally {
  if (Test-Path $brokerLock) {
    Remove-Item $brokerLock -Force -ErrorAction SilentlyContinue
  }
}
exit $LASTEXITCODE
