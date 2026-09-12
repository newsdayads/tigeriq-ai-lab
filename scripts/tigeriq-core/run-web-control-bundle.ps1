$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=$PSScriptRoot
$app=Join-Path $root 'web-control-server.mjs'
if(-not(Test-Path -LiteralPath $app)){throw 'WEB_CONTROL_SERVER_MISSING'}
$tail=(tailscale ip -4 2>$null | Select-Object -First 1)
$hostIp=if($tail){[string]$tail}else{'127.0.0.1'}
$env:TIGERIQ_WEB_CONTROL_HOST=$hostIp
$env:TIGERIQ_WEB_CONTROL_PORT='8796'
$env:TIGERIQ_CORE_URL=('http://'+$hostIp+':8795')
& 'C:\Program Files\nodejs\node.exe' $app
exit $LASTEXITCODE
