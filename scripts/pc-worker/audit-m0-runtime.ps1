$ErrorActionPreference = 'SilentlyContinue'

$taskNames = @(
  'TigerIQ Worker',
  'TigerIQ Worker Watchdog',
  'TigerIQ Command Center',
  'TigerIQ Workforce Controller'
)

$tasks = @($taskNames | ForEach-Object {
  $name = $_
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  $info = if ($task) { Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue } else { $null }
  [ordered]@{
    name = $name
    exists = [bool]$task
    state = if ($task) { [string]$task.State } else { $null }
    lastTaskResult = if ($info) { $info.LastTaskResult } else { $null }
  }
})

$files = [ordered]@{
  postgresDsnPresent = Test-Path 'F:\TigerIQ\Secrets\postgres-workforce.dsn'
  legacyQueueStateV3 = Test-Path 'F:\TigerIQ\Worker\queue-state-v3.json'
  legacyControlPlaneState = Test-Path 'F:\TigerIQ\Worker\control-plane-state.json'
  legacyWorkforceJsonl = Test-Path 'F:\TigerIQ\State\workforce.jsonl'
  workspacePresent = Test-Path 'F:\TigerIQ\Workspace\tigeriq-ai-lab'
  postgresMigration001 = Test-Path 'F:\TigerIQ\Workspace\tigeriq-ai-lab\db\migrations\001_operational_state_v1.sql'
  postgresMigration002 = Test-Path 'F:\TigerIQ\Workspace\tigeriq-ai-lab\db\migrations\002_device_proof_replay_v1.sql'
  controllerSource = Test-Path 'F:\TigerIQ\Workspace\tigeriq-ai-lab\apps\workforce-controller'
  workStateSource = Test-Path 'F:\TigerIQ\Workspace\tigeriq-ai-lab\packages\work-state'
}

$postgresServices = @(Get-Service -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '(?i)postgres' -or $_.DisplayName -match '(?i)postgres' } |
  ForEach-Object { [ordered]@{ name = $_.Name; status = [string]$_.Status } })

[ordered]@{
  audit = 'TIGERIQ_M0_RUNTIME_AUDIT_V1'
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
  hostname = $env:COMPUTERNAME
  readOnly = $true
  tasks = $tasks
  postgresServices = $postgresServices
  files = $files
  m0 = [ordered]@{
    status = 'AUDIT_ONLY_NOT_PASS'
    note = 'M0 PASS still requires one canonical PostgreSQL runtime and verified restart/reboot recovery.'
  }
} | ConvertTo-Json -Depth 6
