param([string]$TaskName = 'TigerIQ PAD UI Broker')
$ErrorActionPreference = 'SilentlyContinue'
Stop-ScheduledTask -TaskName $TaskName
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Output "REMOVED=$TaskName"
