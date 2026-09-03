$ErrorActionPreference = 'SilentlyContinue'

$Workspace = 'F:\TigerIQ\Workspace\tigeriq-ai-lab'
$ControllerPort = 8790

function Get-RuntimeSignature([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  $patterns = @(
    'worker_secure_v3\.py',
    'worker-github-queue\.py',
    'worker-watchdog-v3\.ps1',
    'control_plane_v2\.py',
    'bootstrap_worker_v2\.py',
    'runner_bootstrap_pc01\.py',
    'workforce-controller',
    'command-center',
    'TigerIQ'
  )
  foreach ($pattern in $patterns) {
    if ($Text -match "(?i)$pattern") { return $Matches[0].ToLowerInvariant() }
  }
  return $null
}

$tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object {
  $task = $_
  $actionText = (($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' ')
  $signature = Get-RuntimeSignature "$($task.TaskName) $($task.TaskPath) $actionText"
  if ($signature) {
    $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue
    [ordered]@{
      name = $task.TaskName
      path = $task.TaskPath
      state = [string]$task.State
      lastTaskResult = if ($info) { $info.LastTaskResult } else { $null }
      signature = $signature
      actionExecutables = @($task.Actions | ForEach-Object { $_.Execute } | Where-Object { $_ } | Select-Object -Unique)
    }
  }
})

$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $process = $_
  $signature = Get-RuntimeSignature "$($process.Name) $($process.ExecutablePath) $($process.CommandLine)"
  if ($signature) {
    [ordered]@{
      pid = [int]$process.ProcessId
      name = $process.Name
      executable = $process.ExecutablePath
      signature = $signature
    }
  }
})

$services = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | ForEach-Object {
  $service = $_
  $signature = Get-RuntimeSignature "$($service.Name) $($service.DisplayName) $($service.PathName)"
  if ($signature) {
    [ordered]@{
      name = $service.Name
      displayName = $service.DisplayName
      state = $service.State
      startMode = $service.StartMode
      signature = $signature
    }
  }
})

$startupCommands = @(Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue | ForEach-Object {
  $startup = $_
  $signature = Get-RuntimeSignature "$($startup.Name) $($startup.Command) $($startup.Location)"
  if ($signature) {
    [ordered]@{
      name = $startup.Name
      location = $startup.Location
      user = $startup.User
      signature = $signature
    }
  }
})

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $ControllerPort -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{
    localAddress = $_.LocalAddress
    localPort = $_.LocalPort
    owningProcess = $_.OwningProcess
  }
})

$files = [ordered]@{
  postgresDsnPresent = Test-Path 'F:\TigerIQ\Secrets\postgres-workforce.dsn'
  canonicalDatabaseUrlPresent = Test-Path 'F:\TigerIQ\Secrets\workforce-controller-v1.database-url'
  legacyQueueStateV3 = Test-Path 'F:\TigerIQ\Worker\queue-state-v3.json'
  legacyControlPlaneState = Test-Path 'F:\TigerIQ\Worker\control-plane-state.json'
  legacyWorkforceJsonl = Test-Path 'F:\TigerIQ\State\workforce.jsonl'
  workspacePresent = Test-Path $Workspace
  postgresMigration001 = Test-Path (Join-Path $Workspace 'db\migrations\001_operational_state_v1.sql')
  postgresMigration002 = Test-Path (Join-Path $Workspace 'db\migrations\002_device_proof_replay_v1.sql')
  controllerSource = Test-Path (Join-Path $Workspace 'apps\workforce-controller')
  workStateSource = Test-Path (Join-Path $Workspace 'packages\work-state')
}

$postgresServices = @(Get-Service -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '(?i)postgres' -or $_.DisplayName -match '(?i)postgres' } |
  ForEach-Object { [ordered]@{ name = $_.Name; status = [string]$_.Status } })

$repo = [ordered]@{ present = $files.workspacePresent; branch = $null; head = $null; dirty = $null }
$git = Get-Command git.exe -ErrorAction SilentlyContinue
if ($git -and $files.workspacePresent) {
  $repo.branch = (& $git.Source -C $Workspace branch --show-current 2>$null).Trim()
  $repo.head = (& $git.Source -C $Workspace rev-parse HEAD 2>$null).Trim()
  $porcelain = @(& $git.Source -C $Workspace status --porcelain 2>$null)
  $repo.dirty = $porcelain.Count -gt 0
}

[ordered]@{
  audit = 'TIGERIQ_M0_RUNTIME_AUDIT_V2'
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
  hostname = $env:COMPUTERNAME
  readOnly = $true
  repo = $repo
  tasks = $tasks
  processes = $processes
  services = $services
  startupCommands = $startupCommands
  controllerListeners = $listeners
  postgresServices = $postgresServices
  files = $files
  m0 = [ordered]@{
    status = 'AUDIT_ONLY_NOT_PASS'
    note = 'M0 PASS requires one canonical PostgreSQL controller, no conflicting legacy runtime, and verified restart/reboot recovery.'
  }
} | ConvertTo-Json -Depth 7
