$ErrorActionPreference='Stop'
$logDir='D:\TigerIQ\Logs\SurfSense'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log=Join-Path $logDir ('runtime-'+(Get-Date -Format 'yyyyMMdd')+'.log')
while($true){
  try {
    Add-Content $log ((Get-Date -Format o)+' start')
    & wsl.exe -d Ubuntu -u root -- bash -lc "systemctl start docker; cd /opt/tigeriq/surfsense; docker compose up -d; exec sleep infinity"
    Add-Content $log ((Get-Date -Format o)+' wsl-exited')
  } catch {
    Add-Content $log ((Get-Date -Format o)+' error '+$_.Exception.Message)
  }
  Start-Sleep -Seconds 10
}
