param(
  [string]$Config = "D:\TigerIQ\Config\chrome-controller.json"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$broker = Join-Path $root "dist\apps\chrome-controller\src\chrome-launch-broker.js"
if (-not (Test-Path $Config)) { throw "Config not found: $Config" }
if (-not (Test-Path $broker)) { throw "Chrome launch broker runtime not found: $broker" }
$env:TIGERIQ_CHROME_CONFIG = $Config
# Scheduled interactive tasks can have SESSIONNAME unset even though they run in
# the signed-in user's desktop session. Pass the actual Windows SessionId to
# the broker; model.ts still fails closed for Session 0 / Services.
$sessionId = (Get-Process -Id $PID).SessionId
$env:TIGERIQ_WINDOWS_SESSION_ID = [string]$sessionId
Set-Location $root
& node $broker $Config
exit $LASTEXITCODE
