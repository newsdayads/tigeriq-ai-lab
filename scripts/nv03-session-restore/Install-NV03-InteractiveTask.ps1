param(
  [string]$TaskName='TigerIQ NV03 Interactive Restore',
  [string]$LegacyTaskName='TigerIQ NV03 Sidecar',
  [string]$ScriptPath='D:\TigerIQ\Runtime\NV03SessionRestore\Start-NV03-InteractiveRestore.ps1',
  [string]$BackupRoot='D:\TigerIQ\Backups\NV03SessionRestore',
  [switch]$DisableLegacyTask
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

$session=[int](Get-Process -Id $PID).SessionId
if ($session -le 0) { throw 'NV03_TASK_INSTALL_REQUIRES_INTERACTIVE_SESSION' }
$explorer=@(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { [int]$_.SessionId -eq $session })
if ($explorer.Count -lt 1) { throw 'NV03_TASK_INSTALL_EXPLORER_REQUIRED' }
if (-not (Test-Path -LiteralPath $ScriptPath)) { throw ('NV03_RESTORE_SCRIPT_MISSING:'+$ScriptPath) }

New-Item -ItemType Directory -Force -Path $BackupRoot|Out-Null
$stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$legacy=Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
if ($legacy) {
  Export-ScheduledTask -TaskName $LegacyTaskName | Set-Content -LiteralPath (Join-Path $BackupRoot ($LegacyTaskName.Replace(' ','_')+'-'+$stamp+'.xml')) -Encoding UTF8
  if ($DisableLegacyTask) { Disable-ScheduledTask -TaskName $LegacyTaskName|Out-Null }
}

$user=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $ScriptPath)
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force|Out-Null

[pscustomobject]@{
  ok=$true
  taskName=$TaskName
  user=$user
  logonType='Interactive'
  trigger='AtLogOn'
  legacyTask=$LegacyTaskName
  legacyDisabled=[bool]($legacy -and $DisableLegacyTask)
  backupRoot=$BackupRoot
}|ConvertTo-Json -Compress
