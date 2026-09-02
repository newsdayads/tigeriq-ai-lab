param(
  [string]$SourceDir = 'F:\TigerIQ\Workspace\tigeriq-ai-lab\scripts\pc-worker\workforce-controller-v1',
  [string]$RuntimeDir = 'F:\TigerIQ\Runtime\workforce-controller-v1',
  [string]$DsnFile = 'F:\TigerIQ\Secrets\postgres-workforce.dsn',
  [string]$AdminSecretFile = 'F:\TigerIQ\Secrets\workforce-controller-v1-admin.secret',
  [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ExpectedHost = '100.97.23.87'
$ControllerPort = 8790
$TaskName = 'TigerIQ Workforce Controller'
$FirewallName = 'TigerIQ Workforce Controller V1 (Tailscale only)'
$PythonDir = Join-Path $RuntimeDir 'venv'
$PythonExe = Join-Path $PythonDir 'Scripts\python.exe'
$Requirements = Join-Path $RuntimeDir 'requirements-workforce-controller-v1.txt'
$Runner = Join-Path $RuntimeDir 'run_workforce_controller_v1.py'
$Health = Join-Path $RuntimeDir 'health_workforce_controller_v1.py'
$LogDir = 'F:\TigerIQ\Logs'

function Fail([string]$Code, [string]$Message) { Write-Error "$Code`: $Message"; exit 1 }
function Resolve-Tailscale {
  $cmd = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  if (Test-Path 'C:\Program Files\Tailscale\tailscale.exe') { return 'C:\Program Files\Tailscale\tailscale.exe' }
  Fail 'TAILSCALE_MISSING' 'tailscale.exe not found.'
}
function Protect-SecretFile([string]$Path) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
  Set-Acl -Path $Path -AclObject $acl
}

if ($env:COMPUTERNAME -ne 'PC01') { Fail 'WRONG_HOST' 'This installer is pinned to PC01.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Fail 'ADMIN_REQUIRED' 'One elevated install is required.' }

$tailscale = Resolve-Tailscale
$ips = @(& $tailscale ip -4 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
if ($LASTEXITCODE -ne 0 -or $ips.Count -ne 1 -or $ips[0] -ne $ExpectedHost) { Fail 'TAILSCALE_IP_MISMATCH' "Expected PC01 Tailscale IP $ExpectedHost." }
if (-not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $ExpectedHost -ErrorAction SilentlyContinue)) { Fail 'TAILSCALE_IP_NOT_PRESENT' "$ExpectedHost is not assigned locally." }
if (-not (Test-Path $SourceDir)) { Fail 'SOURCE_MISSING' "Controller V1 source package not found at $SourceDir." }
if (-not (Test-Path $DsnFile)) { Fail 'POSTGRES_DSN_MISSING' "CHAT 03 handoff file is required at $DsnFile." }
if (-not (Test-Path $AdminSecretFile)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $AdminSecretFile -Parent) | Out-Null
  $bytes = New-Object byte[] 48
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  [IO.File]::WriteAllText($AdminSecretFile, $secret, (New-Object Text.UTF8Encoding($false)))
}
Protect-SecretFile $DsnFile
Protect-SecretFile $AdminSecretFile

$python = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $python) { Fail 'PYTHON_MISSING' 'Python 3.12+ is required.' }
$version = & $python.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($LASTEXITCODE -ne 0 -or [version]$version -lt [version]'3.12') { Fail 'PYTHON_VERSION' 'Python 3.12+ is required.' }

$existing = Get-NetTCPConnection -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue
if ($existing) { Fail 'PORT_IN_USE' 'Port 8790 already has a listener; installer will not replace an unknown process.' }

New-Item -ItemType Directory -Force -Path $RuntimeDir, $LogDir | Out-Null
$required = @(
  'workforce_controller_v1.py', 'workforce_controller_v1.sql', 'run_workforce_controller_v1.py',
  'prepare_workforce_controller_v1.py', 'health_workforce_controller_v1.py', 'requirements-workforce-controller-v1.txt'
)
foreach ($name in $required) {
  $source = Join-Path $SourceDir $name
  if (-not (Test-Path $source)) { Fail 'PACKAGE_INCOMPLETE' "Missing $name." }
  Copy-Item -Force $source (Join-Path $RuntimeDir $name)
}

if (-not (Test-Path $PythonExe)) {
  & $python.Source -m venv $PythonDir
  if ($LASTEXITCODE -ne 0) { Fail 'VENV_FAILED' 'Could not create runtime virtual environment.' }
}
& $PythonExe -m pip install --disable-pip-version-check --no-input -r $Requirements
if ($LASTEXITCODE -ne 0) { Fail 'DEPENDENCY_FAILED' 'Pinned controller dependency install failed.' }

$env:TIGERIQ_POSTGRES_DSN_FILE = $DsnFile
$env:TIGERIQ_WORKFORCE_ADMIN_SECRET_FILE = $AdminSecretFile
& $PythonExe (Join-Path $RuntimeDir 'prepare_workforce_controller_v1.py')
if ($LASTEXITCODE -ne 0) { Fail 'POSTGRES_PREP_FAILED' 'PostgreSQL migration/readiness failed.' }
Remove-Item Env:TIGERIQ_POSTGRES_DSN_FILE -ErrorAction SilentlyContinue
Remove-Item Env:TIGERIQ_WORKFORCE_ADMIN_SECRET_FILE -ErrorAction SilentlyContinue

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
$actionArgs = "`"$Runner`""
$action = New-ScheduledTaskAction -Execute $PythonExe -Argument $actionArgs -WorkingDirectory $RuntimeDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal | Out-Null

$oldRule = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
if ($oldRule) { Remove-NetFirewallRule -DisplayName $FirewallName }
New-NetFirewallRule -DisplayName $FirewallName -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $ExpectedHost -LocalPort $ControllerPort -RemoteAddress '100.64.0.0/10' -Profile Any | Out-Null

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 3
  & $PythonExe $Health
  exit $LASTEXITCODE
}

[ordered]@{
  ok = $true
  status = 'INSTALLED_NOT_STARTED'
  task = $TaskName
  bind = "$ExpectedHost`:$ControllerPort"
  postgres = 'MIGRATED_READY'
  firewall = 'TAILSCALE_ONLY'
  autostart = $true
  startNow = $false
  secrets = 'LOCAL_FILES_ACL_RESTRICTED'
} | ConvertTo-Json -Compress
