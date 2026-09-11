$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$task='TigerIQ Coding Lane 24x7'
$repo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$script=Join-Path $repo 'scripts\tigeriq-core\run-coding-lane.ps1'
if(-not(Test-Path -LiteralPath $script)){throw 'CODING_LANE_LAUNCHER_MISSING'}
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$script+'"')
$trigger=New-ScheduledTaskTrigger -AtStartup
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force|Out-Null
Start-ScheduledTask -TaskName $task
Write-Output ('INSTALLED '+$task)
