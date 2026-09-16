param(
  [string]$Config = "D:\TigerIQ\Config\chrome-controller.json"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$broker = Join-Path $root "dist\apps\chrome-controller\src\chrome-launch-broker.js"
if (-not (Test-Path $Config)) { throw "Config not found: $Config" }
if (-not (Test-Path $broker)) { throw "Chrome launch broker runtime not found: $broker" }
$env:TIGERIQ_CHROME_CONFIG = $Config
Set-Location $root
& node $broker $Config
exit $LASTEXITCODE
