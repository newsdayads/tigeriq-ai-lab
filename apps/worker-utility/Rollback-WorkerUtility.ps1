param([string]$InstallRoot = 'D:\TigerIQ\Apps\WorkerUtility')
$ErrorActionPreference='Stop'
Get-Process 'TigerIQ.WorkerUtility' -ErrorAction SilentlyContinue | Stop-Process
Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'TigerIQ Worker Utility' -ErrorAction SilentlyContinue
$dirs=Get-ChildItem $InstallRoot -Directory -Filter 'Current-v1-*' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending
if($dirs.Count -gt 1){
  $previous=$dirs[1].FullName
  $exe=Join-Path $previous 'TigerIQ.WorkerUtility.exe'
  if(Test-Path $exe){ Start-Process $exe; Write-Output ("ROLLED_BACK|$previous"); exit 0 }
}
Write-Output 'ROLLED_BACK|UTILITY_STOPPED_ONLY'