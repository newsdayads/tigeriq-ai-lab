# TigerIQ Phone Farm local desktop host. No browser/cloud/license integration.
$ErrorActionPreference = 'Stop'
$home = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = 'C:\Program Files\nodejs\node.exe'
$entry = Join-Path $home 'app.mjs'
$log = Join-Path $home 'server-local.log'
if (!(Test-Path $node) -or !(Test-Path $entry)) { exit 2 }
$existing = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if ($existing) { exit 0 }
Set-Location -LiteralPath $home
try {
  & $node $entry 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
} catch {
  ('START_ERROR ' + $_.Exception.Message) | Add-Content -LiteralPath $log -Encoding utf8
  exit 3
}
