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
$global:brokerLockStream = $null
try {
  $global:brokerLockStream = [System.IO.File]::Open($brokerLock, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
} catch {
  Write-Host "Chrome launch broker already running (lock file present). Exiting."
  exit 0
}
try {
  $sessionId = (Get-Process -Id $PID).SessionId
  $env:TIGERIQ_WINDOWS_SESSION_ID = [string]$sessionId
  Set-Location $root
  & node $broker $Config --workers NV02,NV03,NV04 --profiles Profile_NV02,Profile_NV03,Profile_NV04
} finally {
  if ($global:brokerLockStream) {
    try { $global:brokerLockStream.Close(); $global:brokerLockStream.Dispose() } catch {}
  }
  if (Test-Path $brokerLock) {
    Remove-Item $brokerLock -Force -ErrorAction SilentlyContinue
  }
}
exit $LASTEXITCODE
