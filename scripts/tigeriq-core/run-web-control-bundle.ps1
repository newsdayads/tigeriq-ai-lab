$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=$PSScriptRoot
$logDir='D:\TigerIQ\Logs\WebControl24x7'
New-Item -ItemType Directory -Path $logDir -Force|Out-Null
$launcherLog=Join-Path $logDir 'launcher.log'
function Log([string]$message){Add-Content -LiteralPath $launcherLog -Value ((Get-Date).ToUniversalTime().ToString('o')+' '+$message) -Encoding UTF8}

$defaultRepo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$runtimeSourceState='D:\TigerIQ\State\core-runtime-source.json'
$repo=$defaultRepo
if(Test-Path -LiteralPath $runtimeSourceState){
  try{$meta=Get-Content -Raw -LiteralPath $runtimeSourceState|ConvertFrom-Json;if($meta.sourcePath -and (Test-Path -LiteralPath ([string]$meta.sourcePath))){$repo=[string]$meta.sourcePath}}catch{}
}
$sourceRoot=Join-Path $repo 'apps\tigeriq-core'

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
  $deadline=(Get-Date).AddSeconds($TimeoutSeconds)
  do{
    $assigned=Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        [string]$_.InterfaceAlias -match '(?i)tailscale' -and
        [string]$_.AddressState -notin @('Invalid','Duplicate','Tentative')
      } | Select-Object -First 1
    if($assigned -and $assigned.IPAddress){return [string]$assigned.IPAddress}

    $tailscale=(Get-Command tailscale.exe -ErrorAction SilentlyContinue)
    if(-not $tailscale){
      $known='C:\Program Files\Tailscale\tailscale.exe'
      if(Test-Path -LiteralPath $known){$tailscale=Get-Item -LiteralPath $known}
    }
    if($tailscale){
      $candidate=(& $tailscale.FullName ip -4 2>$null | Select-Object -First 1)
      if($candidate){
        $candidate=[string]$candidate
        $confirmed=Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
          Where-Object {$_.IPAddress -eq $candidate -and [string]$_.AddressState -notin @('Invalid','Duplicate','Tentative')} |
          Select-Object -First 1
        if($confirmed){return $candidate}
      }
    }
    Start-Sleep -Milliseconds 500
  }while((Get-Date)-lt $deadline)
  throw 'TAILSCALE_IPV4_NOT_READY'
}

try{
  $app=Join-Path $root 'web-control-server.mjs'
  if(-not(Test-Path -LiteralPath $app)){throw 'WEB_CONTROL_SERVER_MISSING'}
  $hostIp=Wait-TailscaleIPv4 90
  $env:TIGERIQ_WEB_CONTROL_HOST=$hostIp
  $env:TIGERIQ_WEB_CONTROL_PORT='8796'
  $env:TIGERIQ_CORE_URL=('http://'+$hostIp+':8795')
  $env:TIGERIQ_CODING_LANE_URL=('http://'+$hostIp+':8797')
  Log ('START host='+$hostIp+' core='+$env:TIGERIQ_CORE_URL+' coding='+$env:TIGERIQ_CODING_LANE_URL)
  & 'C:\Program Files\nodejs\node.exe' $app
  $code=$LASTEXITCODE
  Log ('EXIT code='+$code)
  exit $code
}catch{
  Log ('ERROR '+$_.Exception.Message)
  throw
}
