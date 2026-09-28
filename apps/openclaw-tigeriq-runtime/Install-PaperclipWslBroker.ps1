$ErrorActionPreference='Stop'

$TaskName='TigerIQ Paperclip WSL Broker'
$LabRoot='D:\TigerIQ-Paperclip-Lab'
$BrokerRoot=Join-Path $LabRoot 'broker'
$Broker=Join-Path $BrokerRoot 'paperclip-wsl-broker.ps1'
$Heartbeat=Join-Path $BrokerRoot 'heartbeat.json'

if(-not (Test-Path -LiteralPath $Broker -PathType Leaf)){ throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_SCRIPT_MISSING' }
$user=(Get-CimInstance Win32_ComputerSystem).UserName
if([string]::IsNullOrWhiteSpace($user)){ throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_INTERACTIVE_USER_NOT_FOUND' }

$action=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Broker`""
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$ready=$false
for($i=0;$i -lt 40;$i++){
  Start-Sleep -Milliseconds 500
  if(Test-Path -LiteralPath $Heartbeat -PathType Leaf){
    try {
      $h=Get-Content -Raw -LiteralPath $Heartbeat | ConvertFrom-Json
      if([string]$h.schema -eq 'TIGERIQ_PAPERCLIP_WSL_HEARTBEAT_V1' -and [string]$h.user){ $ready=$true; break }
    } catch {}
  }
}
if(-not $ready){ throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_HEARTBEAT_TIMEOUT' }
Write-Output ('TASK='+$TaskName)
Write-Output ('USER='+$user)
Write-Output ('BROKER='+$Broker)
