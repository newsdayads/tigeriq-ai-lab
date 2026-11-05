# Register a PUBLIC, already-running PC01 web app under the pre-provisioned wildcard DNS.
# No Cloudflare API token or per-app DNS mutation is needed. Fail closed on any failed gate.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')][string]$Name,
  [Parameter(Mandatory=$true)][ValidateRange(1024,65535)][int]$Port,
  [ValidatePattern('^/[a-zA-Z0-9/_-]*$')][string]$HealthPath='/',
  [switch]$Public
)
$ErrorActionPreference='Stop'
if(-not $Public){throw 'PUBLIC_OPT_IN_REQUIRED'}
$root='D:\TigerIQ\CloudflareRuntime'
$registry=Join-Path $root 'subdomains.json'
$lockFile=Join-Path $root 'subdomains.lock'
$tunnelConfig=Join-Path $root 'config.yml'
$hostName="$Name.tigeriq.io.vn"
if($Name -in @('www','admin','api','core','driver','ai','city','3d','mail','smtp','ftp','ssh','vpn','localhost','router','cloudflare','autodiscover')){
  throw "RESERVED_SUBDOMAIN: $Name"
}
if($Port -eq 8891){throw 'ROUTER_PORT_RESERVED'}
if(-not (Test-Path $tunnelConfig)){throw 'TUNNEL_CONFIG_MISSING'}
$cfg=Get-Content $tunnelConfig -Raw
if($cfg -notmatch 'hostname:\s*["'']?\*\.tigeriq\.io\.vn'){
  throw 'WILDCARD_INGRESS_NOT_ACTIVE_IN_CONFIG'
}
if($cfg -match [regex]::Escape("hostname: $hostName")){throw "STATIC_ROUTE_COLLISION: $hostName"}
if($cfg -match "127\.0\.0\.1:$Port(?:\s|$)"){throw "STATIC_PORT_COLLISION: $Port"}
$dns=Resolve-DnsName 'wildcard-route-probe-5648.tigeriq.io.vn' -Type A -Server 1.1.1.1 -ErrorAction Stop
if(-not @($dns | Where-Object { $_.Type -eq 'A' }).Count){throw 'WILDCARD_DNS_NOT_RESOLVING'}
$routerHealth=Invoke-WebRequest 'http://127.0.0.1:8891/__router/healthz' -UseBasicParsing -Headers @{Host='localhost'} -TimeoutSec 5
if($routerHealth.StatusCode -ne 200){throw 'ROUTER_NOT_HEALTHY'}
$originHealth=Invoke-WebRequest "http://127.0.0.1:$Port$HealthPath" -UseBasicParsing -TimeoutSec 5
if($originHealth.StatusCode -ne 200){throw 'ORIGIN_HEALTH_NOT_200'}

$lock=[System.IO.File]::Open($lockFile,[System.IO.FileMode]::OpenOrCreate,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)
try{
  $hadRegistry=Test-Path $registry
  $old=if($hadRegistry){[System.IO.File]::ReadAllText($registry)}else{'{"version":1,"routes":{}}'}
  $state=ConvertFrom-Json $old
  if($state.version -ne 1 -or -not $state.routes){throw 'INVALID_REGISTRY'}
  $existing=$state.routes.PSObject.Properties[$hostName]
  if($existing){
    if([int]$existing.Value.port -eq $Port){
      [pscustomobject]@{state='ALREADY_REGISTERED';hostname=$hostName;port=$Port} | ConvertTo-Json -Compress
      return
    }
    throw "HOST_COLLISION: $hostName"
  }
  foreach($prop in $state.routes.PSObject.Properties){
    if([int]$prop.Value.port -eq $Port){throw "PORT_COLLISION: $Port"}
  }
  $state.routes | Add-Member -MemberType NoteProperty -Name $hostName -Value ([pscustomobject]@{port=$Port;registeredAt=(Get-Date).ToUniversalTime().ToString('o')})
  $new=$state | ConvertTo-Json -Depth 9 -Compress
  $temp="$registry.$PID.tmp"
  $backup="$registry.$PID.bak"
  try{
    [System.IO.File]::WriteAllText($temp,$new,(New-Object System.Text.UTF8Encoding($false)))
    if($hadRegistry){[System.IO.File]::Replace($temp,$registry,$backup)}else{[System.IO.File]::Move($temp,$registry)}
    # Verify local virtual-host route and actual public TLS before accepting.
    $local=Invoke-WebRequest "http://127.0.0.1:8891$HealthPath" -UseBasicParsing -Headers @{Host=$hostName} -TimeoutSec 8
    if($local.StatusCode -ne 200){throw 'VHOST_ROUTE_NOT_200'}
    $publicCheck=Invoke-WebRequest "https://$hostName$HealthPath" -UseBasicParsing -TimeoutSec 15 -Headers @{'Cache-Control'='no-cache'}
    if($publicCheck.StatusCode -ne 200){throw 'PUBLIC_HTTPS_NOT_200'}
    [pscustomobject]@{state='ACCEPTED';hostname=$hostName;port=$Port;https=200;dns='WILDCARD'} | ConvertTo-Json -Compress
  }catch{
    # Restore only this script's registry change, never modify tunnel/DNS/other applications.
    $restore="$registry.$PID.restore"
    [System.IO.File]::WriteAllText($restore,$old,(New-Object System.Text.UTF8Encoding($false)))
    if(Test-Path $registry){[System.IO.File]::Replace($restore,$registry,$null)}
    else{[System.IO.File]::Move($restore,$registry)}
    throw
  }finally{
    foreach($file in @($temp,$backup,"$registry.$PID.restore")){
      if(Test-Path $file){Remove-Item $file -Force -ErrorAction SilentlyContinue}
    }
  }
}finally{$lock.Dispose()}
