param(
  [string]$RepoPath = 'F:\TigerIQ\Workspace\tigeriq-ai-lab',
  [string]$DatabaseUrl = $env:TIGERIQ_DATABASE_URL,
  [string]$ExpectedBranch = 'wo045/pc01-autonomy-hardening',
  [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ExpectedHost = '100.97.23.87'
$ControllerPort = 8790
$TaskName = 'TigerIQ Workforce Controller'
$FirewallName = 'TigerIQ Workforce Controller V1 (Tailscale only)'
$RuntimeDir = 'F:\TigerIQ\Runtime\workforce-controller-v1'
$ConfigDir = 'F:\TigerIQ\Secrets'
$DatabaseUrlFile = Join-Path $ConfigDir 'workforce-controller-v1.database-url'
$RunnerPath = Join-Path $RuntimeDir 'run-workforce-controller-v1.ps1'
$LogPath = 'F:\TigerIQ\Logs\workforce-controller-v1.log'
$HealthScript = Join-Path $RepoPath 'scripts\pc-worker\workforce-controller-v1\health-workforce-controller-v1.ps1'

function Fail([string]$Code, [string]$Message) { Write-Error "$Code`: $Message"; exit 1 }
function Resolve-Executable([string]$Name, [string[]]$Candidates) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in $Candidates) { if (Test-Path $candidate) { return $candidate } }
  return $null
}
function Protect-LocalFile([string]$Path) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
  Set-Acl -Path $Path -AclObject $acl
}

if ($env:COMPUTERNAME -ne 'PC01') { Fail 'WRONG_HOST' 'This installer is pinned to PC01.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Fail 'ADMIN_REQUIRED' 'An authorized elevated install context is required.' }
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { Fail 'DATABASE_URL_MISSING' 'TIGERIQ_DATABASE_URL or -DatabaseUrl is required.' }
if ($DatabaseUrl -match '://[^/@:]+:[^/@]+@' -or $DatabaseUrl -match '(?i)password=') { Fail 'DATABASE_URL_SECRET' 'Database URL must not contain a password; use local SSPI/.pgpass/PGPASSWORD according to PC01 policy.' }
if (-not (Test-Path (Join-Path $RepoPath '.git'))) { Fail 'REPO_MISSING' "TigerIQ repository not found at $RepoPath." }

$git = Resolve-Executable 'git.exe' @('C:\Program Files\Git\cmd\git.exe')
$node = Resolve-Executable 'node.exe' @('C:\Program Files\nodejs\node.exe')
$npm = Resolve-Executable 'npm.cmd' @('C:\Program Files\nodejs\npm.cmd')
$psql = Resolve-Executable 'psql.exe' @('C:\Program Files\PostgreSQL\17\bin\psql.exe','C:\Program Files\PostgreSQL\16\bin\psql.exe')
$tailscale = Resolve-Executable 'tailscale.exe' @('C:\Program Files\Tailscale\tailscale.exe')
if (-not $git) { Fail 'GIT_MISSING' 'git.exe not found.' }
if (-not $node) { Fail 'NODE_MISSING' 'node.exe not found.' }
if (-not $npm) { Fail 'NPM_MISSING' 'npm.cmd not found.' }
if (-not $psql) { Fail 'POSTGRES_MISSING' 'psql.exe not found; install local PostgreSQL first.' }
if (-not $tailscale) { Fail 'TAILSCALE_MISSING' 'tailscale.exe not found.' }

$branch = (& $git -C $RepoPath branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne $ExpectedBranch) { Fail 'WRONG_BRANCH' "Expected reviewed branch $ExpectedBranch; current branch is $branch." }
$dirty = & $git -C $RepoPath status --porcelain
if ($LASTEXITCODE -ne 0) { Fail 'GIT_STATUS_FAILED' 'Could not inspect repository state.' }
if ($dirty) { Fail 'REPO_DIRTY' 'Refusing install from a dirty workspace.' }

$ips = @(& $tailscale ip -4 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
if ($LASTEXITCODE -ne 0 -or $ips.Count -ne 1 -or $ips[0] -ne $ExpectedHost) { Fail 'TAILSCALE_IP_MISMATCH' "Expected live PC01 Tailscale IPv4 $ExpectedHost." }
if (-not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $ExpectedHost -ErrorAction SilentlyContinue)) { Fail 'TAILSCALE_IP_NOT_PRESENT' "$ExpectedHost is not assigned locally." }
$existing = Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue
if ($existing) { Fail 'PORT_IN_USE' 'Port 8790 already has a listener; installer will not replace an unknown process.' }

Push-Location $RepoPath
try {
  & $npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail 'NPM_CI_FAILED' 'npm ci failed.' }
  & $npm install --no-save --ignore-scripts pg@8.16.3
  if ($LASTEXITCODE -ne 0) { Fail 'PG_ADAPTER_FAILED' 'Free pg@8 runtime adapter install failed.' }
  & $npm run build
  if ($LASTEXITCODE -ne 0) { Fail 'BUILD_FAILED' 'TigerIQ build failed.' }
  $env:TIGERIQ_DATABASE_URL = $DatabaseUrl
  & (Join-Path $RepoPath 'scripts\install-work-state-postgres.ps1') -DatabaseUrl $DatabaseUrl -Migration (Join-Path $RepoPath 'db\migrations\001_operational_state_v1.sql')
  if ($LASTEXITCODE -ne 0) { Fail 'POSTGRES_MIGRATION_FAILED' 'Operational-state migration failed.' }
} finally {
  Pop-Location
}

$entry = Join-Path $RepoPath 'dist\apps\workforce-controller\src\standalone.js'
if (-not (Test-Path $entry)) { Fail 'CONTROLLER_BUILD_MISSING' 'Built Controller entry is missing.' }
if (-not (Test-Path $HealthScript)) { Fail 'HEALTH_SCRIPT_MISSING' 'Controller health script is missing.' }
New-Item -ItemType Directory -Force -Path $RuntimeDir,$ConfigDir,(Split-Path $LogPath -Parent) | Out-Null
[IO.File]::WriteAllText($DatabaseUrlFile,$DatabaseUrl.Trim(),(New-Object Text.UTF8Encoding($false)))
Protect-LocalFile $DatabaseUrlFile

$nodeEscaped = $node.Replace("'", "''")
$repoEscaped = $RepoPath.Replace("'", "''")
$urlFileEscaped = $DatabaseUrlFile.Replace("'", "''")
$logEscaped = $LogPath.Replace("'", "''")
$entryEscaped = $entry.Replace("'", "''")
$runner = @"
`$ErrorActionPreference = 'Stop'
`$env:TIGERIQ_DATABASE_URL = [IO.File]::ReadAllText('$urlFileEscaped').Trim()
`$env:TIGERIQ_WORKFORCE_HOST = '$ExpectedHost'
`$env:TIGERIQ_WORKFORCE_PORT = '$ControllerPort'
Set-Location '$repoEscaped'
& '$nodeEscaped' '$entryEscaped' *>> '$logEscaped'
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($RunnerPath,$runner,(New-Object Text.UTF8Encoding($false)))
Protect-LocalFile $RunnerPath

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
$powershell = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$RunnerPath`""
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($startupTrigger,$recoveryTrigger) -Settings $settings -Principal $taskPrincipal | Out-Null

$existingFirewall = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
if ($existingFirewall) { Remove-NetFirewallRule -DisplayName $FirewallName }
New-NetFirewallRule -DisplayName $FirewallName -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $ExpectedHost -LocalPort $ControllerPort -RemoteAddress '100.64.0.0/10' -Profile Any | Out-Null

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 4
  & $HealthScript -DatabaseUrl $DatabaseUrl
  exit $LASTEXITCODE
}

[ordered]@{
  ok = $true
  status = 'INSTALLED_NOT_STARTED'
  branch = $branch
  task = $TaskName
  bind = "$ExpectedHost`:$ControllerPort"
  datastore = 'PostgreSQL operational-state-v1'
  migration = '001_operational_state_v1'
  firewall = 'TAILSCALE_ONLY'
  autostart = $true
  recoveryProbeMinutes = 5
  startNow = $false
  mainProductionTouched = $false
} | ConvertTo-Json -Compress
