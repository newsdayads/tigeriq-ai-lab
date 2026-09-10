param(
  [string]$RepoPath = 'F:\TigerIQ\Workspace\tigeriq-ai-lab',
  [string]$DatabaseUrl = $env:TIGERIQ_DATABASE_URL,
  [switch]$ExecutePhysical,
  [switch]$AuditOnly,
  [switch]$SkipPrerequisiteInstall
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ManifestPath = Join-Path $PSScriptRoot 'bootstrap-manifest.json'
if (-not (Test-Path $ManifestPath)) { throw 'BOOTSTRAP_MANIFEST_MISSING: bootstrap-manifest.json is required.' }
$Manifest = Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json
$RuntimeBasisSha = [string]$Manifest.controllerBasis.sha
$PostgresBasisSha = [string]$Manifest.postgresBasis.sha
$Expected001Blob = [string]$Manifest.postgresBasis.migration001BlobSha
$Expected002Blob = [string]$Manifest.migration002BlobSha
$ExpectedBranch = [string]$Manifest.bootstrapBranch
$ApprovedRemoteRef = [string]$Manifest.approvedBootstrap.remoteRef
$ApprovalFilePath = [string]$Manifest.approvedBootstrap.externalApprovalFile
$ApprovedBootstrapHead = if (Test-Path -LiteralPath $ApprovalFilePath) { [string](Get-Content -Raw -LiteralPath $ApprovalFilePath | ConvertFrom-Json).head } else { '' }
$ExpectedHost = [string]$Manifest.network.host
$ControllerPort = [int]$Manifest.network.port
$ExpectedRemoteCidr = [string]$Manifest.network.tailscaleRemoteCidr
$TaskName = [string]$Manifest.scheduledTask
$FirewallName = [string]$Manifest.firewallRule
$EvidenceRoot = [string]$Manifest.evidenceRoot
$SecretsRoot = [string]$Manifest.secretsRoot
$ForbiddenMigration = [string]$Manifest.forbiddenMigration
$Timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$EvidenceDir = Join-Path $EvidenceRoot $Timestamp
$AuditPath = Join-Path $EvidenceDir 'audit.json'
$RollbackManifestPath = Join-Path $EvidenceDir 'rollback-manifest.json'
$RollbackPointerPath = Join-Path $EvidenceRoot 'latest-rollback-manifest.txt'
$CanonicalTaskBackupPath = Join-Path $EvidenceDir 'canonical-task-before.xml'
$HealthScript = Join-Path (Split-Path $PSScriptRoot -Parent) 'health-workforce-controller-v1.ps1'
$InstallerScript = Join-Path (Split-Path $PSScriptRoot -Parent) 'install-workforce-controller-v1.ps1'
$RestartVerifier = Join-Path $PSScriptRoot 'verify-controller-restart.ps1'
$RollbackScript = Join-Path $PSScriptRoot 'Invoke-PC01-OneClickRollback.ps1'
$PostgresProvisioner = Join-Path $PSScriptRoot 'Ensure-PC01PostgresRuntime.ps1'
$ApprovedHeadVerifier = Join-Path $PSScriptRoot 'Assert-PC01ApprovedHead.ps1'
$DatabaseUrlFile = Join-Path $SecretsRoot 'workforce-controller-v1.database-url'
$PgPassFile = Join-Path $SecretsRoot 'workforce-controller-v1.pgpass'

$Keep = @()
$Disable = @()
$Installed = @()
$Blocked = @()
$DisabledTasks = @()
$StoppedProcesses = @()
$NewPrerequisites = @()
$CanonicalTaskPriorState = $null
$FirewallBackup = $null
$ChangesStarted = $false
$PostgresRuntime = $null

function Fail([string]$Code,[string]$Message) { throw "$Code`: $Message" }
function Save-Json([object]$Value,[string]$Path) { $Value | ConvertTo-Json -Depth 8 | Set-Content -Path $Path -Encoding UTF8 }
function Resolve-Executable([string]$Name,[string[]]$Candidates) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in $Candidates) { if (Test-Path $candidate) { return $candidate } }
  return $null
}
function Get-SafeVersion([string]$Executable,[string[]]$Args) {
  if (-not $Executable) { return $null }
  try { return ((& $Executable @Args 2>$null | Select-Object -First 1) -join '').Trim() } catch { return $null }
}
function Install-FreePackage([string]$Name,[string]$WingetId) {
  if (-not $ExecutePhysical -or $SkipPrerequisiteInstall) { Fail 'PREREQUISITE_MISSING' "$Name is missing and automatic prerequisite installation is disabled." }
  $winget = Resolve-Executable 'winget.exe' @("$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe")
  if (-not $winget) { Fail 'WINGET_MISSING' "$Name is missing and winget is unavailable." }
  & $winget install --id $WingetId --exact --silent --disable-interactivity --accept-package-agreements --accept-source-agreements | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'PREREQUISITE_INSTALL_FAILED' "Free prerequisite install failed for $Name." }
  $script:NewPrerequisites += $Name
  $script:Installed += "$Name (free prerequisite)"
}
function Get-TaskActionText([object]$Task) { return (@($Task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' ') }
function Get-FirewallBackup {
  $rule = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $rule) { return [ordered]@{ exists = $false } }
  $port = $rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue | Select-Object -First 1
  $address = $rule | Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue | Select-Object -First 1
  return [ordered]@{
    exists=$true; enabled=[string]$rule.Enabled; direction=[string]$rule.Direction; action=[string]$rule.Action; profile=[string]$rule.Profile;
    protocol=if($port){[string]$port.Protocol}else{'TCP'}; localPort=if($port){[string]$port.LocalPort}else{[string]$ControllerPort};
    localAddress=if($address){@($address.LocalAddress)}else{@()}; remoteAddress=if($address){@($address.RemoteAddress)}else{@()}
  }
}
function Write-RollbackManifest {
  $value = [ordered]@{
    schema='tigeriq.pc01.one-click.rollback.v1'; createdAt=(Get-Date).ToUniversalTime().ToString('o'); issue=156; evidenceDir=$EvidenceDir;
    canonicalTaskBackupPath=if(Test-Path $CanonicalTaskBackupPath){$CanonicalTaskBackupPath}else{$null}; canonicalTaskPriorState=$CanonicalTaskPriorState;
    firewallBackup=$FirewallBackup; disabledTasks=@($DisabledTasks); stoppedProcesses=@($StoppedProcesses); newlyInstalledPrerequisites=@($NewPrerequisites);
    postgresRuntime=if($PostgresRuntime){[ordered]@{installedPostgres=[bool]$PostgresRuntime.installedPostgres; reusedConfiguredDatastore=[bool]$PostgresRuntime.reusedConfiguredDatastore; serviceNames=@($PostgresRuntime.serviceNames)}}else{$null};
    migrationsRetainedOnRollback=@('001_operational_state_v1','002_device_proof_replay_v1'); databaseDestructiveRollbackAllowed=$false; secretsIncluded=$false
  }
  Save-Json $value $RollbackManifestPath
  [IO.File]::WriteAllText($RollbackPointerPath,$RollbackManifestPath,(New-Object Text.UTF8Encoding($false)))
}
function Stop-KnownPortConflict([int]$Pid) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$Pid" -ErrorAction SilentlyContinue
  if (-not $proc) { return }
  $name=[string]$proc.Name; $path=[string]$proc.ExecutablePath; $command=[string]$proc.CommandLine
  $known = ($command -match '(?i)tigeriq.*(workforce|controller)') -or ($command -match '(?i)openclaw') -or ($path -match '(?i)tigeriq')
  if (-not $known) { Fail 'PORT_8790_UNKNOWN_OWNER' "Port 8790 is owned by an unknown process PID $Pid; refusing to kill it." }
  Stop-Process -Id $Pid -Force -ErrorAction Stop
  $script:StoppedProcesses += [ordered]@{pid=$Pid;name=$name;executablePath=$path;reason='conflict-port-8790'}
  $script:Disable += "Stopped conflicting process $name PID $Pid on port 8790"
}

if (-not $ExecutePhysical) { $AuditOnly = $true }
New-Item -ItemType Directory -Force -Path $EvidenceDir,$EvidenceRoot,$SecretsRoot | Out-Null
foreach ($requiredScript in @($HealthScript,$InstallerScript,$RestartVerifier,$RollbackScript,$PostgresProvisioner,$ApprovedHeadVerifier)) { if (-not (Test-Path $requiredScript)) { Fail 'PACKAGE_INCOMPLETE' "Missing one-click component: $requiredScript" } }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($ExecutePhysical -and $env:COMPUTERNAME -ne 'PC01') { Fail 'WRONG_HOST' 'Physical execution is pinned to PC01.' }
if ($ExecutePhysical -and -not $isAdmin) { Fail 'ADMIN_REQUIRED' 'Physical execution requires an authorized elevated context.' }

$git = Resolve-Executable 'git.exe' @('C:\Program Files\Git\cmd\git.exe')
if (-not $git -and $ExecutePhysical) { Install-FreePackage 'Git' 'Git.Git'; $git = Resolve-Executable 'git.exe' @('C:\Program Files\Git\cmd\git.exe') }
if (-not $git) { Fail 'GIT_MISSING' 'Git is required to verify branch/SHA.' }
if (-not (Test-Path (Join-Path $RepoPath '.git'))) { Fail 'REPO_MISSING' "TigerIQ repository not found at $RepoPath." }
$approvedHead = & $ApprovedHeadVerifier -RepoPath $RepoPath -GitExecutable $git -ExpectedBranch $ExpectedBranch -ApprovedHeadSha $ApprovedBootstrapHead -ApprovedRemoteRef $ApprovedRemoteRef -ApprovalFilePath $ApprovalFilePath
if ($LASTEXITCODE -ne 0 -or -not $approvedHead) { Fail 'APPROVED_HEAD_VERIFY_FAILED' 'Reviewed bootstrap HEAD verification did not return an approved result.' }
$branch = [string]$approvedHead.branch
$localHead = [string]$approvedHead.head
$dirty = @(& $git -C $RepoPath status --porcelain)
if ($branch -ne $ExpectedBranch) { Fail 'WRONG_BRANCH' "Expected bootstrap branch $ExpectedBranch; current branch is $branch." }
if ($dirty.Count -gt 0) { Fail 'REPO_DIRTY' 'Repository is dirty; physical bootstrap is fail-closed.' }
$remoteHead = [string]$approvedHead.remoteHead
& $git -C $RepoPath merge-base --is-ancestor $RuntimeBasisSha $localHead
if ($LASTEXITCODE -ne 0) { Fail 'RUNTIME_BASIS_MISSING' 'Bootstrap HEAD is not descended from the reviewed Controller basis SHA.' }
$runtimePaths=@('apps/workforce-controller','packages/work-state','db/migrations/001_operational_state_v1.sql','db/migrations/002_device_proof_replay_v1.sql','tests/pc01-android-postgres-integration.test.ts')
& $git -C $RepoPath diff --quiet $RuntimeBasisSha $localHead -- @runtimePaths
if ($LASTEXITCODE -ne 0) { Fail 'RUNTIME_BASIS_DRIFT' 'Controller/PostgreSQL runtime files differ from reviewed PR #116 basis.' }
$blob001=(& $git -C $RepoPath rev-parse "$localHead`:db/migrations/001_operational_state_v1.sql").Trim()
$blob002=(& $git -C $RepoPath rev-parse "$localHead`:db/migrations/002_device_proof_replay_v1.sql").Trim()
if ($blob001 -ne $Expected001Blob) { Fail 'POSTGRES_001_BLOB_MISMATCH' 'Migration 001 does not match PR #141 reviewed blob.' }
if ($blob002 -ne $Expected002Blob) { Fail 'POSTGRES_002_BLOB_MISMATCH' 'Migration 002 does not match the reviewed Controller basis.' }
if (Test-Path (Join-Path $RepoPath 'db\migrations\003_business_state_v2.sql')) { Fail 'MIGRATION_003_FORBIDDEN' '003_business_state_v2.sql must not be physically applied.' }

$node=Resolve-Executable 'node.exe' @('C:\Program Files\nodejs\node.exe')
$npm=Resolve-Executable 'npm.cmd' @('C:\Program Files\nodejs\npm.cmd')
$psql=Resolve-Executable 'psql.exe' @('C:\Program Files\PostgreSQL\17\bin\psql.exe','C:\Program Files\PostgreSQL\16\bin\psql.exe')
$tailscale=Resolve-Executable 'tailscale.exe' @('C:\Program Files\Tailscale\tailscale.exe')
$ollama=Resolve-Executable 'ollama.exe' @("$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",'C:\Program Files\Ollama\ollama.exe')
$openclaw=Resolve-Executable 'openclaw.exe' @('C:\Program Files\OpenClaw\openclaw.exe')
$postgresServices=@(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)postgres' -or $_.DisplayName -match '(?i)postgres' -or $_.PathName -match '(?i)postgres' })

$taskAudit=@(); $allTasks=@(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like '*TigerIQ*' -or $_.TaskName -like '*OpenClaw*' })
foreach($task in $allTasks){
  $actionText=Get-TaskActionText $task; $classification='keep-nonconflicting'
  if($task.TaskName -eq $TaskName){$classification='canonical-replace-idempotently'}
  elseif(($task.TaskName -match '(?i)controller') -or ($actionText -match '(?i)workforce[_-]?controller') -or ($actionText -match '8790')){$classification='disable-if-executing-physical'}
  elseif($task.TaskName -match '(?i)openclaw'){$classification='keep-disconnected-never-enable'}
  $taskAudit += [ordered]@{taskName=$task.TaskName;taskPath=$task.TaskPath;state=[string]$task.State;classification=$classification}
}
$processAudit=@(); $processes=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)node|python|postgres|ollama|openclaw|powershell' -or $_.CommandLine -match '(?i)tigeriq|openclaw|ollama' })
foreach($proc in $processes){
  $classification='observed'; if([string]$proc.Name -match '(?i)ollama'){$classification='keep-local-ai-fallback'} elseif([string]$proc.Name -match '(?i)openclaw' -or [string]$proc.CommandLine -match '(?i)openclaw'){$classification='do-not-reconnect'} elseif([string]$proc.CommandLine -match '(?i)tigeriq'){$classification='audit-tigeriq-runtime'}
  $processAudit += [ordered]@{pid=[int]$proc.ProcessId;name=[string]$proc.Name;executablePath=[string]$proc.ExecutablePath;classification=$classification}
}
$portAudit=@(); foreach($listener in @(Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue)){ $proc=Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue; $portAudit += [ordered]@{localAddress=[string]$listener.LocalAddress;localPort=[int]$listener.LocalPort;pid=[int]$listener.OwningProcess;processName=if($proc){$proc.ProcessName}else{$null}} }

$audit=[ordered]@{
  schema='tigeriq.pc01.one-click.audit.v1'; issue=156; auditedAt=(Get-Date).ToUniversalTime().ToString('o'); physicalExecution=[bool]$ExecutePhysical; host=$env:COMPUTERNAME; admin=$isAdmin;
  repository=[ordered]@{path=$RepoPath;branch=$branch;head=$localHead;remoteHead=$remoteHead;clean=$true;runtimeBasis=$RuntimeBasisSha;postgresBasis=$PostgresBasisSha;runtimeBasisUnchanged=$true};
  prerequisites=[ordered]@{git=[ordered]@{installed=[bool]$git;version=Get-SafeVersion $git @('--version')};node=[ordered]@{installed=[bool]$node;version=Get-SafeVersion $node @('--version')};npm=[ordered]@{installed=[bool]$npm;version=Get-SafeVersion $npm @('--version')};psql=[ordered]@{installed=[bool]$psql;version=Get-SafeVersion $psql @('--version')};tailscale=[ordered]@{installed=[bool]$tailscale;path=$tailscale};ollama=[ordered]@{installed=[bool]$ollama;path=$ollama;policy='KEEP_OPTIONAL_LOCAL_FALLBACK'};openclaw=[ordered]@{installed=[bool]$openclaw;path=$openclaw;policy='DO_NOT_RECONNECT'}};
  postgresServices=@($postgresServices | ForEach-Object {[ordered]@{name=$_.Name;displayName=$_.DisplayName;state=$_.State;startMode=$_.StartMode}}); scheduledTasks=$taskAudit; processes=$processAudit; port8790=$portAudit;
  migrationPolicy=[ordered]@{allowed=@('001_operational_state_v1','002_device_proof_replay_v1');forbidden=$ForbiddenMigration;migration001Blob=$blob001;migration002Blob=$blob002}; secretsCaptured=$false
}
Save-Json $audit $AuditPath
if($AuditOnly -and -not $ExecutePhysical){ [ordered]@{ok=$true;action='pc01.one-click.audit-only';auditEvidence=$AuditPath;runtimeBasis=$RuntimeBasisSha;postgresBasis=$PostgresBasisSha;physicalExecuted=$false;marker='PC01_ONE_CLICK_AUDIT_PACKAGE_OK'} | ConvertTo-Json -Compress; exit 0 }

try {
  if(-not $node){Install-FreePackage 'Node.js LTS' 'OpenJS.NodeJS.LTS';$node=Resolve-Executable 'node.exe' @('C:\Program Files\nodejs\node.exe');$npm=Resolve-Executable 'npm.cmd' @('C:\Program Files\nodejs\npm.cmd')}
  if(-not $tailscale){Install-FreePackage 'Tailscale' 'Tailscale.Tailscale';$tailscale=Resolve-Executable 'tailscale.exe' @('C:\Program Files\Tailscale\tailscale.exe')}
  if(-not $node -or -not $npm -or -not $tailscale){Fail 'PREREQUISITE_UNRESOLVED' 'Required free prerequisites remain unavailable.'}

  $ips=@(& $tailscale ip -4 2>$null | ForEach-Object {$_.Trim()} | Where-Object {$_} | Select-Object -Unique)
  if($LASTEXITCODE -ne 0 -or @($ips).Length -ne 1 -or @($ips)[0] -ne $ExpectedHost){Fail 'TAILSCALE_IP_MISMATCH' "Expected PC01 Tailscale IPv4 $ExpectedHost; bootstrap will not reconfigure identity automatically."}
  $Keep += "Tailscale existing identity $ExpectedHost"; if($ollama){$Keep+='Ollama retained as optional local fallback; not Controller authority'}; $openclawTaskCount = @($taskAudit | Where-Object { $_.classification -eq 'keep-disconnected-never-enable' }).Length; if($openclaw -or $openclawTaskCount -gt 0){$Keep+='OpenClaw observed but not enabled/reconnected'}

  $PostgresRuntime = & $PostgresProvisioner -SecretsRoot $SecretsRoot -EvidenceDir $EvidenceDir -DatabaseUrl $DatabaseUrl -AllowInstall:(-not $SkipPrerequisiteInstall)
  if(-not $PostgresRuntime -or -not $PostgresRuntime.ok){Fail 'POSTGRES_PROVISION_FAILED' 'Canonical TigerIQ PostgreSQL provisioning failed.'}
  $effectiveDatabaseUrl=[string]$PostgresRuntime.databaseUrl; $PgPassFile=[string]$PostgresRuntime.pgPassFile; $env:PGPASSFILE=$PgPassFile
  $psql=Resolve-Executable 'psql.exe' @('C:\Program Files\PostgreSQL\17\bin\psql.exe','C:\Program Files\PostgreSQL\16\bin\psql.exe')
  if(-not $psql){Fail 'PSQL_UNRESOLVED' 'psql is unavailable after PostgreSQL provisioning.'}
  if([bool]$PostgresRuntime.installedPostgres){$NewPrerequisites+='PostgreSQL 16';$Installed+='PostgreSQL 16 local canonical service'}else{$Keep+='Existing canonical TigerIQ PostgreSQL datastore reused'}
  $dbProbe=(& $psql -w -vON_ERROR_STOP=1 -Atc 'SELECT 1;' --dbname=$effectiveDatabaseUrl 2>$null).Trim(); if($LASTEXITCODE -ne 0 -or $dbProbe -ne '1'){Fail 'POSTGRES_CONNECTION_FAILED' 'Canonical TigerIQ PostgreSQL runtime connection failed.'}
  $migrationTable=(& $psql -w -vON_ERROR_STOP=1 -Atc "SELECT to_regclass('public.tigeriq_schema_migrations') IS NOT NULL;" --dbname=$effectiveDatabaseUrl 2>$null).Trim(); if($migrationTable -eq 't'){ $existingVersions=@(& $psql -w -vON_ERROR_STOP=1 -Atc 'SELECT version FROM tigeriq_schema_migrations ORDER BY version;' --dbname=$effectiveDatabaseUrl 2>$null | ForEach-Object {$_.Trim()} | Where-Object {$_}); if($existingVersions -contains $ForbiddenMigration){Fail 'MIGRATION_003_ALREADY_PRESENT' 'Forbidden business-state migration 003 is already present; refusing to proceed.'}; $unexpected=@($existingVersions|Where-Object{$_ -notin @('001_operational_state_v1','002_device_proof_replay_v1')}); if($unexpected.Count -gt 0){Fail 'UNREVIEWED_MIGRATION_PRESENT' 'Unreviewed PostgreSQL migration state exists; refusing runtime drift.'} }

  $canonicalTask=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; if($canonicalTask){$CanonicalTaskPriorState=[string]$canonicalTask.State;Export-ScheduledTask -TaskName $TaskName|Set-Content -Path $CanonicalTaskBackupPath -Encoding Unicode}
  $FirewallBackup=Get-FirewallBackup; Write-RollbackManifest
  foreach($task in $allTasks){ if($task.TaskName -eq $TaskName){continue}; $actionText=Get-TaskActionText $task; $conflict=($task.TaskName -match '(?i)controller') -or ($actionText -match '(?i)workforce[_-]?controller') -or ($actionText -match '8790'); if($conflict -and [string]$task.State -ne 'Disabled'){ $priorState=[string]$task.State; if($priorState -eq 'Running'){Stop-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue}; Disable-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath|Out-Null; $DisabledTasks += [ordered]@{taskName=$task.TaskName;taskPath=$task.TaskPath;priorState=$priorState;reason='controller-or-port-authority-conflict'}; $Disable += "Legacy conflicting task $($task.TaskPath)$($task.TaskName)"; $ChangesStarted=$true } elseif($task.TaskName -match '(?i)worker|watchdog'){$Keep += "Legacy TigerIQ task retained (non-conflicting): $($task.TaskPath)$($task.TaskName)"} }
  Write-RollbackManifest
  if($canonicalTask){Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2;$ChangesStarted=$true}
  foreach($listener in @(Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue)){Stop-KnownPortConflict ([int]$listener.OwningProcess);$ChangesStarted=$true}
  Start-Sleep -Seconds 1; if(@(Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue).Count -gt 0){Fail 'PORT_8790_STILL_BUSY' 'Port 8790 remains occupied after resolving known conflicts.'}; Write-RollbackManifest

  & $InstallerScript -RepoPath $RepoPath -DatabaseUrl $effectiveDatabaseUrl -PgPassFilePath $PgPassFile -ExpectedBranch $ExpectedBranch -ExpectedHeadSha $localHead -HealthScriptPath $HealthScript -StartNow
  if($LASTEXITCODE -ne 0){Fail 'CANONICAL_INSTALL_FAILED' 'Canonical Controller installer failed.'}
  $ChangesStarted=$true; $Installed+='TigerIQ Workforce Controller SYSTEM Scheduled Task';$Installed+="Tailscale-only firewall $ExpectedRemoteCidr -> $ExpectedHost`:$ControllerPort";$Installed+='PostgreSQL migrations 001_operational_state_v1 + 002_device_proof_replay_v1'
  $healthOutput=& $HealthScript -DatabaseUrl $effectiveDatabaseUrl -PgPassFile $PgPassFile; if($LASTEXITCODE -ne 0){Fail 'HEALTH_GATE_FAILED' 'Canonical Controller health gate failed.'}
  $restartOutput=& $RestartVerifier -DatabaseUrl $effectiveDatabaseUrl -PgPassFile $PgPassFile -HealthScript $HealthScript; if($LASTEXITCODE -ne 0){Fail 'RESTART_VERIFICATION_FAILED' 'Controller restart verification failed.'}
  $allVersions=@(& $psql -w -vON_ERROR_STOP=1 -Atc 'SELECT version FROM tigeriq_schema_migrations ORDER BY version;' --dbname=$effectiveDatabaseUrl 2>$null | ForEach-Object {$_.Trim()} | Where-Object {$_}); if($allVersions.Count -ne 2 -or $allVersions[0] -ne '001_operational_state_v1' -or $allVersions[1] -ne '002_device_proof_replay_v1'){Fail 'MIGRATION_EXACT_STATE_BREACH' 'PostgreSQL migration state is not exactly reviewed 001+002.'}

  Write-RollbackManifest
  $summary=[ordered]@{ok=$true;action='pc01.one-click.go-live';issue=156;bootstrapHead=$localHead;controllerBasis=$RuntimeBasisSha;postgresBasis=$PostgresBasisSha;keep=@($Keep|Select-Object -Unique);disable=@($Disable|Select-Object -Unique);installed=@($Installed|Select-Object -Unique);blocked=@();auditEvidence=$AuditPath;rollbackEvidence=$RollbackManifestPath;postgres=[ordered]@{installedPostgres=[bool]$PostgresRuntime.installedPostgres;reusedConfiguredDatastore=[bool]$PostgresRuntime.reusedConfiguredDatastore;serviceNames=@($PostgresRuntime.serviceNames)};healthVerified=$true;restartVerified=$true;migrations=@('001_operational_state_v1','002_device_proof_replay_v1');migration003Applied=$false;openClawReconnected=$false;destructiveUninstall=$false;paidServiceUsed=$false;mainProductionTouched=$false;secretsPrinted=$false;marker='PC01_ONE_CLICK_GO_LIVE_PASS'}
  Save-Json $summary (Join-Path $EvidenceDir 'result.json'); Write-Host ('KEEP: '+(@($summary.keep)-join '; '));Write-Host ('DISABLE: '+(@($summary.disable)-join '; '));Write-Host ('INSTALLED: '+(@($summary.installed)-join '; '));Write-Host 'BLOCKED: none';$summary|ConvertTo-Json -Depth 6 -Compress
} catch {
  $Blocked += $_.Exception.Message; try{Write-RollbackManifest}catch{}; if($ChangesStarted -and (Test-Path $RollbackScript) -and (Test-Path $RollbackManifestPath)){try{& $RollbackScript -ManifestPath $RollbackManifestPath|Out-Null}catch{$Blocked+='AUTOMATIC_ROLLBACK_INCOMPLETE'}}
  $failure=[ordered]@{ok=$false;action='pc01.one-click.go-live';keep=@($Keep|Select-Object -Unique);disable=@($Disable|Select-Object -Unique);installed=@($Installed|Select-Object -Unique);blocked=@($Blocked|Select-Object -Unique);auditEvidence=$AuditPath;rollbackEvidence=if(Test-Path $RollbackManifestPath){$RollbackManifestPath}else{$null};physicalExecutionStopped=$true;secretsPrinted=$false}
  Save-Json $failure (Join-Path $EvidenceDir 'result.json');Write-Host ('KEEP: '+(@($failure.keep)-join '; '));Write-Host ('DISABLE: '+(@($failure.disable)-join '; '));Write-Host ('INSTALLED: '+(@($failure.installed)-join '; '));Write-Host ('BLOCKED: '+(@($failure.blocked)-join '; '));$failure|ConvertTo-Json -Depth 6 -Compress;exit 1
}
