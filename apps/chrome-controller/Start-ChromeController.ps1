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
Set-Location $root
& node $server
exit $LASTEXITCODE
