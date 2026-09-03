param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoPath = 'F:\TigerIQ\Workspace\tigeriq-ai-lab'
$ExpectedBranch = 'wo056/pc01-one-click-bootstrap'
$ExpectedHead = '30073cfc53e108a843f39fd82fec2777a433f212'
$ExpectedRemoteRef = 'refs/heads/wo056/pc01-one-click-bootstrap'
$ExpectedHost = '100.97.23.87'
$ControllerPort = 8790
$TaskName = 'TigerIQ Workforce Controller'
$FirewallName = 'TigerIQ Workforce Controller V1 (Tailscale only)'
$LocalServiceSid = '*S-1-5-19'
$LocalServicePrincipal = 'NT AUTHORITY\LOCAL SERVICE'
$RuntimeDir = 'F:\TigerIQ\Runtime\workforce-controller-v1'
$SecretsDir = 'F:\TigerIQ\Secrets'
$LogsDir = 'F:\TigerIQ\Logs'
$EvidenceRoot = 'F:\TigerIQ\Evidence\m0-canonical-runtime'
$Stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$EvidenceDir = Join-Path $EvidenceRoot $Stamp
$DatabaseUrlFile = Join-Path $SecretsDir 'workforce-controller-v1.database-url'
$PgPassFile = Join-Path $SecretsDir 'workforce-controller-v1.pgpass'
$RunnerPath = Join-Path $RuntimeDir 'run-workforce-controller-v1.ps1'
$LogPath = Join-Path $LogsDir 'workforce-controller-v1.log'
$PostgresEnsure = Join-Path $RepoPath 'scripts\pc-worker\workforce-controller-v1\one-click\Ensure-PC01PostgresRuntime.ps1'
$Migration001 = Join-Path $RepoPath 'db\migrations\001_operational_state_v1.sql'
$Migration002 = Join-Path $RepoPath 'db\migrations\002_device_proof_replay_v1.sql'
$MigrationInstaller = Join-Path $RepoPath 'scripts\install-work-state-postgres.ps1'
$Entry = Join-Path $RepoPath 'dist\apps\workforce-controller\src\standalone.js'
$LegacyTasks = @('TigerIQ Worker','TigerIQ Worker Watchdog','TigerIQ-PC01-Worker','TigerIQ Command Center')

function Fail([string]$Code,[string]$Message) { throw "$Code`: $Message" }
function Resolve-Exe([string]$Name,[string[]]$Candidates) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in $Candidates) { if (Test-Path $candidate) { return $candidate } }
  return $null
}
function Invoke-Icacls([string[]]$Args) {
  & icacls.exe @Args | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'ACL_FAILED' "icacls failed for $($Args -join ' ')" }
}
function Grant-LocalServiceReadFile([string]$Path) {
  if (-not (Test-Path $Path)) { Fail 'ACL_TARGET_MISSING' "Missing file: $Path" }
  Invoke-Icacls @($Path,'/inheritance:r','/grant:r','*S-1-5-18:F','*S-1-5-32-544:F',"$LocalServiceSid`:R")
}
function Grant-LocalServiceReadTree([string]$Path) {
  if (-not (Test-Path $Path)) { Fail 'ACL_TARGET_MISSING' "Missing path: $Path" }
  Invoke-Icacls @($Path,'/grant',"$LocalServiceSid`:(OI)(CI)RX",'/T','/C')
}
function Grant-LocalServiceModifyTree([string]$Path) {
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  Invoke-Icacls @($Path,'/grant',"$LocalServiceSid`:(OI)(CI)M",'/T','/C')
}
function Save-Json([object]$Value,[string]$Name) {
  $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $EvidenceDir $Name) -Encoding UTF8
}
function Get-Psql {
  return Resolve-Exe 'psql.exe' @('C:\Program Files\PostgreSQL\17\bin\psql.exe','C:\Program Files\PostgreSQL\16\bin\psql.exe')
}
function Test-Health([string]$DatabaseUrl,[string]$Psql) {
  $env:PGPASSFILE = $PgPassFile
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $principal = if ($task) { [string]$task.Principal.UserId } else { '' }
  $principalOk = $principal -in @('NT AUTHORITY\LOCAL SERVICE','LOCAL SERVICE','S-1-5-19')
  $taskOk = [bool]$task -and $principalOk -and ([string]$task.State -in @('Running','Ready'))
  $listeners = @(Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue)
  $exact = @($listeners | Where-Object { $_.LocalAddress -eq $ExpectedHost })
  $unsafe = @($listeners | Where-Object { $_.LocalAddress -ne $ExpectedHost })
  $listenerOk = $exact.Count -eq 1 -and $unsafe.Count -eq 0
  $versions = @(& $Psql -w $DatabaseUrl -vON_ERROR_STOP=1 -Atc "SELECT version FROM tigeriq_schema_migrations ORDER BY version;" 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $dbOk = $LASTEXITCODE -eq 0 -and $versions.Count -eq 2 -and $versions[0] -eq '001_operational_state_v1' -and $versions[1] -eq '002_device_proof_replay_v1'
  $httpOk = $false; $protocol = $null; $postgres = $false
  if ($listenerOk) {
    try {
      $status = Invoke-RestMethod -Uri "http://$ExpectedHost`:$ControllerPort/api/v1/status" -TimeoutSec 5
      $protocol = [string]$status.protocol
      $postgres = [bool]$status.postgres
      $httpOk = [bool]$status.ok -and $postgres -and $protocol -eq 'controller-v1'
    } catch {}
  }
  $firewall = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue | Select-Object -First 1
  $portFilter = if ($firewall) { $firewall | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue | Select-Object -First 1 } else { $null }
  $addressFilter = if ($firewall) { $firewall | Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue | Select-Object -First 1 } else { $null }
  $remote = if ($addressFilter) { @($addressFilter.RemoteAddress) } else { @() }
  $local = if ($addressFilter) { @($addressFilter.LocalAddress) } else { @() }
  $firewallOk = [bool]$firewall -and [string]$firewall.Enabled -eq 'True' -and [string]$firewall.Direction -eq 'Inbound' -and [string]$firewall.Action -eq 'Allow' -and [string]$portFilter.LocalPort -eq '8790' -and ($remote -contains '100.64.0.0/10') -and ($local -contains $ExpectedHost)
  return [ordered]@{
    ok = $taskOk -and $listenerOk -and $dbOk -and $httpOk -and $firewallOk
    task = [ordered]@{ok=$taskOk;principal=$principal;leastPrivilege=$principalOk;state=if($task){[string]$task.State}else{$null}}
    listener = [ordered]@{ok=$listenerOk;exact=$exact.Count;unsafe=$unsafe.Count;addresses=@($listeners|ForEach-Object{$_.LocalAddress})}
    postgres = [ordered]@{ok=$dbOk;migrations=$versions}
    http = [ordered]@{ok=$httpOk;protocol=$protocol;postgres=$postgres}
    firewall = [ordered]@{ok=$firewallOk;remote=$remote;local=$local}
  }
}

New-Item -ItemType Directory -Force -Path $EvidenceDir,$RuntimeDir,$SecretsDir,$LogsDir | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if ($env:COMPUTERNAME -ne 'PC01') { Fail 'WRONG_HOST' 'This M0 installer is pinned to PC01.' }
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Fail 'ADMIN_REQUIRED' 'Run the one-line M0 command from PowerShell as Administrator.' }
if (-not (Test-Path (Join-Path $RepoPath '.git'))) { Fail 'REPO_MISSING' 'TigerIQ workspace is missing.' }

$git = Resolve-Exe 'git.exe' @('C:\Program Files\Git\cmd\git.exe')
$node = Resolve-Exe 'node.exe' @('C:\Program Files\nodejs\node.exe')
$npm = Resolve-Exe 'npm.cmd' @('C:\Program Files\nodejs\npm.cmd')
$tailscale = Resolve-Exe 'tailscale.exe' @('C:\Program Files\Tailscale\tailscale.exe')
if (-not $git -or -not $node -or -not $npm -or -not $tailscale) { Fail 'PREREQUISITE_MISSING' 'Git, Node/npm and Tailscale must be present.' }

$branch = (& $git -C $RepoPath branch --show-current).Trim()
$head = (& $git -C $RepoPath rev-parse HEAD).Trim()
$dirty = @(& $git -C $RepoPath status --porcelain)
$remoteLine = (& $git -C $RepoPath ls-remote --exit-code origin $ExpectedRemoteRef | Out-String).Trim()
$remoteHead = if ($remoteLine) { ($remoteLine -split "`t")[0] } else { '' }
if ($branch -ne $ExpectedBranch) { Fail 'WRONG_BRANCH' "Expected $ExpectedBranch, got $branch." }
if ($dirty.Count -gt 0) { Fail 'REPO_DIRTY' 'Workspace must be clean.' }
if ($head -ne $ExpectedHead -or $remoteHead -ne $ExpectedHead) { Fail 'HEAD_NOT_APPROVED' 'Local/remote bootstrap head moved; refusing physical execution.' }

$ips = @(& $tailscale ip -4 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
if ($LASTEXITCODE -ne 0 -or $ips.Count -ne 1 -or $ips[0] -ne $ExpectedHost) { Fail 'TAILSCALE_IDENTITY_MISMATCH' 'PC01 Tailscale identity does not match the reviewed host.' }
$existingListeners = @(Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue)
if ($existingListeners.Count -gt 0) { Fail 'PORT_8790_BUSY' 'Port 8790 is already occupied; no process will be killed blindly.' }

Save-Json ([ordered]@{timestamp=(Get-Date).ToUniversalTime().ToString('o');host=$env:COMPUTERNAME;branch=$branch;head=$head;remoteHead=$remoteHead;tailscale=$ips[0];port8790Free=$true;mode='M0_LOCAL_SERVICE'}) 'preflight.json'

if (-not (Test-Path $PostgresEnsure)) { Fail 'POSTGRES_ENSURE_MISSING' 'Reviewed PostgreSQL ensure script is missing.' }
$pgState = & $PostgresEnsure -SecretsRoot $SecretsDir -EvidenceDir $EvidenceDir -AllowInstall
if ($LASTEXITCODE -ne 0 -or -not $pgState -or -not [bool]$pgState.ok) { Fail 'POSTGRES_ENSURE_FAILED' 'Canonical PostgreSQL provisioning/reuse failed.' }
$DatabaseUrl = [string]$pgState.databaseUrl
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { Fail 'DATABASE_URL_MISSING' 'Canonical PostgreSQL URL was not returned.' }
$psql = Get-Psql
if (-not $psql) { Fail 'PSQL_MISSING' 'psql unavailable after PostgreSQL ensure.' }
$env:Path = (Split-Path $psql -Parent) + ';' + $env:Path
$env:TIGERIQ_DATABASE_URL = $DatabaseUrl
$env:PGPASSFILE = $PgPassFile

Push-Location $RepoPath
try {
  & $npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail 'NPM_CI_FAILED' 'npm ci failed.' }
  & $npm install --no-save --ignore-scripts --package-lock=false pg@8.16.3
  if ($LASTEXITCODE -ne 0) { Fail 'PG_ADAPTER_FAILED' 'pg runtime adapter install failed.' }
  & $npm run build
  if ($LASTEXITCODE -ne 0) { Fail 'BUILD_FAILED' 'TigerIQ build failed.' }
  & $MigrationInstaller -DatabaseUrl $DatabaseUrl -Migration $Migration001 -ReplayMigration $Migration002
  if ($LASTEXITCODE -ne 0) { Fail 'MIGRATION_FAILED' 'Reviewed migrations 001+002 failed.' }
} finally { Pop-Location }
if (-not (Test-Path $Entry)) { Fail 'CONTROLLER_BUILD_MISSING' 'Compiled controller entry is missing.' }

Grant-LocalServiceReadFile $DatabaseUrlFile
Grant-LocalServiceReadFile $PgPassFile
Grant-LocalServiceReadTree (Join-Path $RepoPath 'dist')
Grant-LocalServiceReadTree (Join-Path $RepoPath 'node_modules')
Grant-LocalServiceModifyTree $LogsDir
Grant-LocalServiceModifyTree $RuntimeDir

$nodeEscaped=$node.Replace("'","''"); $repoEscaped=$RepoPath.Replace("'","''"); $urlEscaped=$DatabaseUrlFile.Replace("'","''"); $pgEscaped=$PgPassFile.Replace("'","''"); $logEscaped=$LogPath.Replace("'","''"); $entryEscaped=$Entry.Replace("'","''")
$runner = @"
`$ErrorActionPreference = 'Stop'
`$env:TIGERIQ_DATABASE_URL = [IO.File]::ReadAllText('$urlEscaped').Trim()
`$env:PGPASSFILE = '$pgEscaped'
`$env:TIGERIQ_WORKFORCE_HOST = '$ExpectedHost'
`$env:TIGERIQ_WORKFORCE_PORT = '$ControllerPort'
Set-Location '$repoEscaped'
& '$nodeEscaped' '$entryEscaped' *>> '$logEscaped'
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($RunnerPath,$runner,(New-Object Text.UTF8Encoding($false)))
Grant-LocalServiceReadFile $RunnerPath

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
  $actionText = (@($existingTask.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' ')
  if ($actionText -notmatch [regex]::Escape($RunnerPath)) { Fail 'UNKNOWN_CANONICAL_TASK' 'Existing Workforce Controller task is not the M0 canonical runner.' }
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
$existingFirewall = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
if ($existingFirewall) { Remove-NetFirewallRule -DisplayName $FirewallName }

$powershell = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$RunnerPath`""
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $LocalServicePrincipal -LogonType ServiceAccount -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($startupTrigger,$recoveryTrigger) -Settings $settings -Principal $taskPrincipal | Out-Null
New-NetFirewallRule -DisplayName $FirewallName -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $ExpectedHost -LocalPort $ControllerPort -RemoteAddress '100.64.0.0/10' -Profile Any | Out-Null

try {
  Start-ScheduledTask -TaskName $TaskName
  $health = $null
  $deadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Seconds 1
    $health = Test-Health $DatabaseUrl $psql
    if ([bool]$health.ok) { break }
  } while ((Get-Date) -lt $deadline)
  if (-not $health -or -not [bool]$health.ok) { Save-Json $health 'health-failed.json'; Fail 'HEALTH_FAILED' 'Canonical LOCAL SERVICE controller failed health gate.' }
  Save-Json $health 'health-initial.json'

  Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $stopDeadline = (Get-Date).AddSeconds(20)
  do { Start-Sleep -Milliseconds 500; $left = @(Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue) } while ($left.Count -gt 0 -and (Get-Date) -lt $stopDeadline)
  if ($left.Count -gt 0) { Fail 'RESTART_STOP_FAILED' 'Controller listener did not stop.' }
  Start-ScheduledTask -TaskName $TaskName
  $restartHealth = $null
  $deadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Seconds 1
    $restartHealth = Test-Health $DatabaseUrl $psql
    if ([bool]$restartHealth.ok) { break }
  } while ((Get-Date) -lt $deadline)
  if (-not $restartHealth -or -not [bool]$restartHealth.ok) { Save-Json $restartHealth 'health-restart-failed.json'; Fail 'RESTART_HEALTH_FAILED' 'Controller failed restart recovery gate.' }
  Save-Json $restartHealth 'health-restart.json'

  $disabled = @()
  foreach ($legacy in $LegacyTasks) {
    $task = Get-ScheduledTask -TaskName $legacy -ErrorAction SilentlyContinue
    if ($task) {
      Stop-ScheduledTask -TaskName $legacy -ErrorAction SilentlyContinue
      Disable-ScheduledTask -TaskName $legacy -ErrorAction Stop | Out-Null
      $disabled += $legacy
    }
  }
  $result = [ordered]@{
    ok=$true; marker='M0_CANONICAL_RUNTIME_INSTALLED_LOCAL_SERVICE'; controller=$TaskName; principal=$LocalServicePrincipal;
    postgres='127.0.0.1:5432/tigeriq'; migrations=@('001_operational_state_v1','002_device_proof_replay_v1'); bind="$ExpectedHost`:$ControllerPort";
    restartGate='PASS'; legacyTasksDisabled=$disabled; evidence=$EvidenceDir; mainProductionTouched=$false; rebootRequired=$true
  }
  Save-Json $result 'result.json'
  $result | ConvertTo-Json -Depth 6
  Write-Host 'M0_CANONICAL_RUNTIME_INSTALLED_LOCAL_SERVICE'
  Write-Host 'M0_REBOOT_REQUIRED'
} catch {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
  Remove-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
  Save-Json ([ordered]@{ok=$false;error=$_.Exception.Message;timestamp=(Get-Date).ToUniversalTime().ToString('o');legacyIngressPreserved=$true}) 'failure.json'
  throw
}
