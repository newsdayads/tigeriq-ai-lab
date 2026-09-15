$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=$PSScriptRoot
$sourceRoot='D:\TigerIQ\Workspace\tigeriq-ai-lab\apps\tigeriq-core'

# Keep the runtime bundle complete and future-proof. The updater fast-forwards the
# canonical repo before restarting this task, then this launcher atomically syncs
# every Web Control asset required by the current server implementation.
if(-not(Test-Path -LiteralPath $sourceRoot)){throw 'WEB_CONTROL_SOURCE_ROOT_MISSING'}
$assets=@(Get-ChildItem -LiteralPath $sourceRoot -File | Where-Object {
  $_.Name -eq 'web-control-server.mjs' -or
  $_.Name -eq 'web-control.html' -or
  $_.Name -like 'web-control-*.js' -or
  $_.Name -like 'web-control-*.css'
})
if(-not $assets.Count){throw 'WEB_CONTROL_ASSETS_MISSING'}
foreach($asset in $assets){
  $target=Join-Path $root $asset.Name
  $tmp=$target+'.tmp'
  Copy-Item -LiteralPath $asset.FullName -Destination $tmp -Force
  Move-Item -LiteralPath $tmp -Destination $target -Force
}

$app=Join-Path $root 'web-control-server.mjs'
if(-not(Test-Path -LiteralPath $app)){throw 'WEB_CONTROL_SERVER_MISSING'}
$tail=(tailscale ip -4 2>$null | Select-Object -First 1)
$hostIp=if($tail){[string]$tail}else{'127.0.0.1'}
$env:TIGERIQ_WEB_CONTROL_HOST=$hostIp
$env:TIGERIQ_WEB_CONTROL_PORT='8796'
$env:TIGERIQ_CORE_URL=('http://'+$hostIp+':8795')
& 'C:\Program Files\nodejs\node.exe' $app
exit $LASTEXITCODE
