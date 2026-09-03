param(
  [string]$RepoPath = 'F:\TigerIQ\Workspace\tigeriq-ai-lab',
  [string]$DatabaseUrl = 'postgresql://tigeriq_runtime@127.0.0.1:5432/tigeriq',
  [string]$PgPassFilePath = 'F:\TigerIQ\Secrets\workforce-controller-v1.pgpass'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ExpectedHost = '100.97.23.87'
$ControllerPort = 8790
$TaskName = 'TigerIQ Workforce Controller'
$FirewallName = 'TigerIQ Workforce Controller V1 (Tailscale only)'
$RuntimeDir = 'F:\TigerIQ\Runtime\workforce-controller-v1'
$DatabaseUrlFile = 'F:\TigerIQ\Secrets\workforce-controller-v1.database-url'
$RunnerPath = Join-Path $RuntimeDir 'run-workforce-controller-v1.ps1'
$LogPath = 'F:\TigerIQ\Logs\workforce-controller-v1.log'
$EntryPath = Join-Path $RepoPath 'dist\apps\workforce-controller\src\standalone.js'
$HealthScript = Join-Path $RepoPath 'scripts\pc-worker\workforce-controller-v1\health-workforce-controller-v1.ps1'
$env:PGCONNECT_TIMEOUT = '5'
$env:PGPASSFILE = $PgPassFilePath

function Resolve-Executable([string]$Name,[string[]]$Candidates) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) {
    if ($cmd.Path) { return [string]$cmd.Path }
    if ($cmd.Definition) { return [string]$cmd.Definition }
    if ($cmd.Source) { return [string]$cmd.Source }
  }
  foreach ($candidate in $Candidates) { if (Test-Path $candidate) { return $candidate } }
  return $null
}
function Protect-LocalFile([string]$Path) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
  Set-Acl -Path $Path -AclObject $acl
}
function Stop-ExistingController {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

if ($env:COMPUTERNAME -ne 'PC01') { throw 'WRONG_HOST: this repair is pinned to PC01.' }
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ADMIN_REQUIRED' }
if (-not (Test-Path (Join-Path $RepoPath '.git'))) { throw 'REPO_MISSING' }
if (-not (Test-Path $EntryPath)) { throw 'BUILD_MISSING: dist Workforce Controller entry is missing; do not rerun migrations, run build only.' }
if (-not (Test-Path $HealthScript)) { throw 'HEALTH_SCRIPT_MISSING' }
if (-not (Test-Path $PgPassFilePath)) { throw 'PGPASS_MISSING' }

$node = Resolve-Executable 'node.exe' @('C:\Program Files\nodejs\node.exe')
$psql = Resolve-Executable 'psql.exe' @('C:\Program Files\PostgreSQL\17\bin\psql.exe','C:\Program Files\PostgreSQL\16\bin\psql.exe')
$tailscale = Resolve-Executable 'tailscale.exe' @('C:\Program Files\Tailscale\tailscale.exe')
$powershell = Resolve-Executable 'powershell.exe' @('C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe')
if (-not $node) { throw 'NODE_MISSING' }
if (-not $psql) { throw 'PSQL_MISSING' }
if (-not $tailscale) { throw 'TAILSCALE_MISSING' }
if (-not $powershell) { throw 'POWERSHELL_MISSING' }

$ips=@(& $tailscale ip -4 2>$null | ForEach-Object {$_.Trim()} | Where-Object {$_} | Select-Object -Unique)
if ($ips.Count -ne 1 -or $ips[0] -ne $ExpectedHost) { throw "TAILSCALE_IP_MISMATCH: expected $ExpectedHost; got $($ips -join ',')" }

$versions=@(& $psql -w --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -Atc "SELECT version FROM tigeriq_schema_migrations ORDER BY version;" 2>$null | ForEach-Object {$_.Trim()} | Where-Object {$_})
if ($LASTEXITCODE -ne 0 -or $versions.Count -ne 2 -or $versions[0] -ne '001_operational_state_v1' -or $versions[1] -ne '002_device_proof_replay_v1') { throw "MIGRATION_VERIFY_FAILED: $($versions -join ',')" }
$replay=@(& $psql -w --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -Atc "SELECT to_regclass('public.device_proof_replay_state') IS NOT NULL;" 2>$null)
if ($LASTEXITCODE -ne 0 -or $replay.Count -eq 0 -or ([string]$replay[0]).Trim() -ne 't') { throw 'REPLAY_TABLE_VERIFY_FAILED' }

Stop-ExistingController
$conflicts=@(Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue)
if ($conflicts.Count -gt 0) { throw "PORT_8790_IN_USE: $(@($conflicts|ForEach-Object{$_.OwningProcess}) -join ',')" }

New-Item -ItemType Directory -Force -Path $RuntimeDir,'F:\TigerIQ\Secrets','F:\TigerIQ\Logs' | Out-Null
[IO.File]::WriteAllText($DatabaseUrlFile,$DatabaseUrl.Trim(),(New-Object Text.UTF8Encoding($false)))
Protect-LocalFile $DatabaseUrlFile
Protect-LocalFile $PgPassFilePath

$nodeEsc=$node.Replace("'","''")
$repoEsc=$RepoPath.Replace("'","''")
$urlEsc=$DatabaseUrlFile.Replace("'","''")
$pgEsc=$PgPassFilePath.Replace("'","''")
$logEsc=$LogPath.Replace("'","''")
$entryEsc=$EntryPath.Replace("'","''")
$runner=@"
`$ErrorActionPreference='Stop'
`$env:TIGERIQ_DATABASE_URL=[IO.File]::ReadAllText('$urlEsc').Trim()
`$env:PGPASSFILE='$pgEsc'
`$env:PGCONNECT_TIMEOUT='5'
`$env:TIGERIQ_WORKFORCE_HOST='$ExpectedHost'
`$env:TIGERIQ_WORKFORCE_PORT='$ControllerPort'
Set-Location '$repoEsc'
& '$nodeEsc' '$entryEsc' *>> '$logEsc'
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($RunnerPath,$runner,(New-Object Text.UTF8Encoding($false)))
Protect-LocalFile $RunnerPath

$existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
$action=New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunnerPath`""
$startup=New-ScheduledTaskTrigger -AtStartup
$recovery=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew
$system=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($startup,$recovery) -Settings $settings -Principal $system | Out-Null

$existingFw=Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
if ($existingFw) { Remove-NetFirewallRule -DisplayName $FirewallName }
New-NetFirewallRule -DisplayName $FirewallName -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $ExpectedHost -LocalPort $ControllerPort -RemoteAddress '100.64.0.0/10' -Profile Any | Out-Null

Start-ScheduledTask -TaskName $TaskName
$deadline=(Get-Date).AddSeconds(20)
$listener=$null
while ((Get-Date) -lt $deadline) {
  $listener=Get-NetTCPConnection -LocalAddress $ExpectedHost -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { break }
  Start-Sleep -Milliseconds 500
}

$task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskInfo=Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
$http=$null
if ($listener) {
  try { $http=Invoke-RestMethod -Uri "http://$ExpectedHost`:$ControllerPort/api/v1/status" -TimeoutSec 5 } catch {}
}
$ok=[bool]$listener -and [bool]$http -and [bool]$http.ok -and ([string]$http.protocol -eq 'controller-v1') -and [bool]$http.postgres
$logTail=@()
if (-not $ok -and (Test-Path $LogPath)) { $logTail=@(Get-Content $LogPath -Tail 25 -ErrorAction SilentlyContinue) }

[ordered]@{
  ok=$ok
  action='workforce.controller.v1.repair-finalize'
  task=[ordered]@{name=$TaskName;exists=[bool]$task;state=if($task){[string]$task.State}else{$null};lastTaskResult=if($taskInfo){$taskInfo.LastTaskResult}else{$null};principal=if($task){[string]$task.Principal.UserId}else{$null}}
  listener=[ordered]@{ok=[bool]$listener;bind="$ExpectedHost`:$ControllerPort"}
  postgres=[ordered]@{ok=$true;migrations=$versions;replayTable=$true}
  http=[ordered]@{ok=if($http){[bool]$http.ok}else{$false};protocol=if($http){[string]$http.protocol}else{$null};postgres=if($http){[bool]$http.postgres}else{$false}}
  firewall=$FirewallName
  logTail=$logTail
} | ConvertTo-Json -Depth 6 -Compress
if (-not $ok) { exit 2 }
