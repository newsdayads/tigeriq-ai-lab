$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$taskName='TigerIQ Core Runtime Updater'
$legacyAutonomySupervisorTask='TigerIQ Autonomy Supervisor V2'
$sourceScript='D:\TigerIQ\Workspace\tigeriq-ai-lab\scripts\tigeriq-core\update-core-runtime.ps1'
$legacyTask=Get-ScheduledTask -TaskName $legacyAutonomySupervisorTask -ErrorAction SilentlyContinue
if($legacyTask){
  if([string]$legacyTask.State -eq 'Running'){Stop-ScheduledTask -TaskName $legacyAutonomySupervisorTask -ErrorAction SilentlyContinue}
  Disable-ScheduledTask -TaskName $legacyAutonomySupervisorTask -ErrorAction Stop|Out-Null
}
$runtimeScript='D:\TigerIQ\Runtime\CoreUpdater\update-core-runtime.ps1'
if(-not(Test-Path -LiteralPath $sourceScript)){throw 'UPDATER_SCRIPT_MISSING'}
New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeScript) -Force|Out-Null
$tmp=$runtimeScript+'.tmp'
Copy-Item -LiteralPath $sourceScript -Destination $tmp -Force
Move-Item -LiteralPath $tmp -Destination $runtimeScript -Force
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$ps='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$action=New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runtimeScript`" -IntervalSeconds 120"
$trigger=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
