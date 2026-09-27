$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=$PSScriptRoot
$defaultRepo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$runtimeSourceState='D:\TigerIQ\State\core-runtime-source.json'
$repo=$defaultRepo
if(Test-Path -LiteralPath $runtimeSourceState){
  try{$meta=Get-Content -Raw -LiteralPath $runtimeSourceState|ConvertFrom-Json;if($meta.sourcePath -and (Test-Path -LiteralPath ([string]$meta.sourcePath))){$repo=[string]$meta.sourcePath}}catch{}
}
$sourceRoot=Join-Path $repo 'apps\tigeriq-core'

# Keep the runtime bundle complete and future-proof. The updater fast-forwards the
# canonical repo before restarting this task, then this launcher atomically syncs
# every Web Control asset required by the current server implementation.
if(-not(Test-Path -LiteralPath $sourceRoot)){throw 'WEB_CONTROL_SOURCE_ROOT_MISSING'}
$assets=@(Get-ChildItem -LiteralPath $sourceRoot -File | Where-Object {
  $_.Name -eq 'web-control-server.mjs' -or
  $_.Name -eq 'web-control.html' -or
  $_.Name -eq 'workforce-registry.mjs' -or
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

function Wait-TailscaleIPv4([int]$TimeoutSeconds=90){
  $tailscale=(Get-Command tailscale.exe -ErrorAction SilentlyContinue)
  if(-not $tailscale){$tailscale=(Get-Command tailscale -ErrorAction SilentlyContinue)}
  if(-not $tailscale){throw 'TAILSCALE_CLI_MISSING'}
  $deadline=(Get-Date).AddSeconds($TimeoutSeconds)
  do{
    $candidate=(& $tailscale.Source ip -4 2>$null | Select-Object -First 1)
    if($candidate){
      $candidate=[string]$candidate
      $assigned=Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {$_.IPAddress -eq $candidate -and [string]$_.AddressState -ne 'Invalid'} |
        Select-Object -First 1
      if($assigned){return $candidate}
    }
    Start-Sleep -Milliseconds 500
  }while((Get-Date)-lt $deadline)
  throw 'TAILSCALE_IPV4_NOT_READY'
}

$app=Join-Path $root 'web-control-server.mjs'
if(-not(Test-Path -LiteralPath $app)){throw 'WEB_CONTROL_SERVER_MISSING'}
$hostIp=Wait-TailscaleIPv4 90
$env:TIGERIQ_WEB_CONTROL_HOST=$hostIp
$env:TIGERIQ_WEB_CONTROL_PORT='8796'
$env:TIGERIQ_CORE_URL='http://127.0.0.1:8795'
$env:TIGERIQ_CODING_LANE_URL='http://127.0.0.1:8797'
& 'C:\Program Files\nodejs\node.exe' $app
exit $LASTEXITCODE
