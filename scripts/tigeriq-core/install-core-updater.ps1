$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$taskName='TigerIQ Core Runtime Updater'
$script='D:\TigerIQ\Workspace\tigeriq-ai-lab\scripts\tigeriq-core\update-core-runtime.ps1'
if(-not(Test-Path -LiteralPath $script)){throw 'UPDATER_SCRIPT_MISSING'}
$ps='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$action=New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`" -IntervalSeconds 120"
$trigger=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
