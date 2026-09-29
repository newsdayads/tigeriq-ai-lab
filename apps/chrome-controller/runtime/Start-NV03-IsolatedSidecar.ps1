param(
  [string]$InstallRoot='D:\TigerIQ\Apps\NV03Sidecar',
  [int]$HealthPort=8823
)

$ErrorActionPreference='Stop'
$runtime=Join-Path $InstallRoot 'Runtime'
$current=Join-Path $InstallRoot 'Current'
$entry=Join-Path $current 'nv03-isolated-sidecar.mjs'
New-Item -ItemType Directory -Path $runtime -Force|Out-Null
if(-not(Test-Path -LiteralPath $entry)){throw "NV03_SIDECAR_ENTRY_MISSING:$entry"}

try{
  $health=Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $HealthPort) -TimeoutSec 2
  if($health.ok -eq $true -and [string]$health.workerId -eq 'NV03'){
    $health|ConvertTo-Json -Compress -Depth 6
    exit 0
  }
}catch{}

$out=Join-Path $runtime 'sidecar.out.log'
$err=Join-Path $runtime 'sidecar.err.log'
Start-Process node.exe -ArgumentList @($entry) -WorkingDirectory $current -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
$deadline=(Get-Date).AddSeconds(15)
do{
  Start-Sleep -Milliseconds 500
  try{
    $health=Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $HealthPort) -TimeoutSec 2
    if($health.ok -eq $true -and [string]$health.workerId -eq 'NV03'){
      $health|ConvertTo-Json -Compress -Depth 6
      exit 0
    }
  }catch{}
}while((Get-Date)-lt$deadline)
throw 'NV03_SIDECAR_HEALTH_TIMEOUT'
