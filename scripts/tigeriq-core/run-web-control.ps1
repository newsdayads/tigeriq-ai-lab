$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$app=Join-Path $repo 'apps\tigeriq-core\web-control-server.mjs'
$logDir='D:\TigerIQ\Logs\WebControl24x7'
New-Item -ItemType Directory -Path $logDir -Force|Out-Null
$mutex=New-Object Threading.Mutex($false,'Global\TigerIQWebControlSupervisorV1')
$owns=$false
try{$owns=$mutex.WaitOne(0)}catch{$owns=$false}
if(-not $owns){exit 73}
$tail=(tailscale ip -4 2>$null | Select-Object -First 1)
$hostIp=if($tail){[string]$tail}else{'127.0.0.1'}
$env:TIGERIQ_WEB_CONTROL_HOST=$hostIp
$env:TIGERIQ_WEB_CONTROL_PORT='8796'
$env:TIGERIQ_CORE_URL=('http://'+$hostIp+':8795')
$appMatch=$app.ToLowerInvariant()
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($appMatch)} | ForEach-Object {try{Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop}catch{}}
while($true){
  try{
    $out=Join-Path $logDir ('web-control-'+(Get-Date -Format 'yyyyMMdd')+'.out.log')
    $err=Join-Path $logDir ('web-control-'+(Get-Date -Format 'yyyyMMdd')+'.err.log')
    $p=Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList @($app) -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
    $p.WaitForExit()
  }catch{
    Add-Content -Path (Join-Path $logDir 'supervisor.log') -Value ((Get-Date -Format o)+' '+($_.Exception.Message)) -Encoding UTF8
  }
  Start-Sleep -Seconds 5
}
