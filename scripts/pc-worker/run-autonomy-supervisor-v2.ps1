param(
  [switch]$Once,
  [switch]$NoRepair,
  [switch]$SelfTest,
  [int]$IntervalSeconds = 15
)
$ErrorActionPreference = 'Continue'
$Version = '2.0.0'
$Root = 'D:\TigerIQ'
$RuntimeDir = Join-Path $Root 'Runtime\autonomy-supervisor-v2'
$StatusPath = Join-Path $RuntimeDir 'status.json'
$EventPath = Join-Path $RuntimeDir 'events.jsonl'
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Write-AtomicJson([string]$Path, $Value) {
  $tmp = "$Path.tmp"
  $json = $Value | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}
function Write-Event([string]$Type, $Data) {
  $obj = [ordered]@{ at=(Get-Date).ToUniversalTime().ToString('o'); type=$Type; data=$Data }
  $line = $obj | ConvertTo-Json -Compress -Depth 8
  Add-Content -LiteralPath $EventPath -Value $line -Encoding UTF8
}
function Get-TaskState([string]$Name) {
  $t = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if ($null -eq $t) { return 'MISSING' }
  return [string]$t.State
}
function Get-ProcessCount([string]$Pattern, [string]$ProcessName='') {
  $p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine -match $Pattern -and ([string]::IsNullOrWhiteSpace($ProcessName) -or $_.Name -eq $ProcessName)
  }
  return @($p).Count
}
function Invoke-Probe([string]$Uri, [bool]$RequireJsonOk) {
  try {
    if ($RequireJsonOk) {
      $body = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 5
      return [pscustomobject]@{ ok=[bool]$body.ok; status=200; body=$body; error=$null }
    }
    $r = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 5
    return [pscustomobject]@{ ok=($r.StatusCode -ge 200 -and $r.StatusCode -lt 400); status=[int]$r.StatusCode; body=$null; error=$null }
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode.value__ } catch {}
    return [pscustomobject]@{ ok=$false; status=$code; body=$null; error=$_.Exception.Message }
  }
}
function Test-QueueStalled([Nullable[int]]$QueuedJobs, [Nullable[int]]$ActiveLeases, $Since, [datetime]$Now, [int]$ThresholdSeconds = 90) {
  if ($null -eq $QueuedJobs -or $QueuedJobs -le 0 -or $ActiveLeases -ne 0 -or $null -eq $Since) { return $false }
  return (($Now - [datetime]$Since).TotalSeconds -ge $ThresholdSeconds)
}

function Get-SystemMetrics {
  try {
    $os = Get-CimInstance Win32_OperatingSystem
    $cpu = Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average
    $totalGb = [math]::Round(($os.TotalVisibleMemorySize * 1KB) / 1GB, 2)
    $freeGb = [math]::Round(($os.FreePhysicalMemory * 1KB) / 1GB, 2)
    $usedGb = [math]::Round($totalGb - $freeGb, 2)
    $usedPct = if ($totalGb -gt 0) { [math]::Round(($usedGb / $totalGb) * 100, 1) } else { 0 }
    return [ordered]@{ cpuPercent=[math]::Round([double]$cpu.Average,1); memoryUsedPercent=$usedPct; memoryUsedGb=$usedGb; memoryTotalGb=$totalGb }
  } catch { return [ordered]@{ cpuPercent=$null; memoryUsedPercent=$null; memoryUsedGb=$null; memoryTotalGb=$null } }
}
$Components = @(
  [pscustomobject]@{ id='controller'; task='TigerIQ Workforce Controller'; mode='http'; uri='http://100.97.23.87:8790/api/v1/status'; jsonOk=$true; pattern='workforce-controller.*standalone\.js'; autoRepair=$true; critical=$true },
  [pscustomobject]@{ id='command-center'; task='TigerIQ Command Center'; mode='http'; uri='http://100.97.23.87:8787/'; jsonOk=$false; pattern='releases-v3.*standalone\.js'; autoRepair=$false; critical=$false },
  [pscustomobject]@{ id='ollama'; task='TigerIQ Ollama Runtime'; mode='http'; uri='http://127.0.0.1:11434/api/version'; jsonOk=$false; pattern='ollama\.exe.*serve'; autoRepair=$true; critical=$true },
  [pscustomobject]@{ id='openclaw'; task='TigerIQ OpenClaw Gateway'; mode='http'; uri='http://127.0.0.1:18789/'; jsonOk=$false; pattern='openclaw\\.mjs.*gateway run'; autoRepair=$true; critical=$true },
  [pscustomobject]@{ id='planner'; task='TigerIQ Autonomous Planner'; mode='process'; uri=$null; jsonOk=$false; pattern='autonomous-planner.*standalone\.js'; autoRepair=$true; critical=$true },
  [pscustomobject]@{ id='ai-resource-worker'; task='TigerIQ AI Resource Worker'; mode='process'; uri=$null; jsonOk=$false; pattern='ai-resource-worker\.mjs'; autoRepair=$true; critical=$true },
  [pscustomobject]@{ id='orchestrator'; task='TigerIQ Mission Orchestrator'; mode='process'; uri=$null; jsonOk=$false; pattern='mission-orchestrator.*standalone\.js'; autoRepair=$true; critical=$true },
  [pscustomobject]@{ id='pc01-worker'; task='TigerIQ PC01 Native Worker'; mode='process'; uri=$null; jsonOk=$false; pattern='pc01-native-worker.*standalone\.js'; autoRepair=$true; critical=$true },
  [pscustomobject]@{ id='nv06-openclaw-worker'; task='TigerIQ NV06 OpenClaw Worker'; mode='process'; uri=$null; jsonOk=$false; pattern='nv06-openclaw-worker.*standalone\.js'; processName='node.exe'; autoRepair=$true; critical=$true },
  [pscustomobject]@{ id='nv02-worker'; task='TigerIQ NV02 Worker'; mode='process'; uri=$null; jsonOk=$false; pattern='nv02-worker\\groq-worker\.mjs'; autoRepair=$false; critical=$false },
  [pscustomobject]@{ id='desktop-commander'; task='TigerIQ Desktop Commander Remote'; mode='process'; uri=$null; jsonOk=$false; pattern='desktop-commander.*remote --persist-session'; autoRepair=$false; critical=$true }
)
$Failures = @{}
$NextRepair = @{}
$LastHealthy = @{}
$QueueNoLeaseSince = $null
$LastQueueAlertAt = [datetime]::MinValue

function Get-ComponentHealth($Component) {
  $taskState = Get-TaskState $Component.task
  $processCount = Get-ProcessCount $Component.pattern ([string]$Component.processName)
  $processOk = ($processCount -gt 0)
  $probe = $null
  if ($Component.mode -eq 'http') { $probe = Invoke-Probe $Component.uri $Component.jsonOk }
  $healthy = if ($Component.mode -eq 'http') { [bool]$probe.ok } else { [bool]$processOk }
  return [pscustomobject]@{
    id=$Component.id; task=$Component.task; healthy=$healthy; taskState=$taskState; processOk=$processOk; processCount=$processCount
    httpOk=if($probe){[bool]$probe.ok}else{$null}; httpStatus=if($probe){$probe.status}else{$null}; error=if($probe){$probe.error}else{$null}; body=if($probe){$probe.body}else{$null}
  }
}
function Invoke-BoundedRepair($Component, [string]$Reason) {
  $now = Get-Date
  $id = $Component.id
  if ($NoRepair -or -not $Component.autoRepair) {
    return [pscustomobject]@{ attempted=$false; id=$id; reason=$Reason; outcome='observe-only' }
  }
  if ($NextRepair.ContainsKey($id) -and $now -lt $NextRepair[$id]) {
    return [pscustomobject]@{ attempted=$false; id=$id; reason=$Reason; outcome='backoff'; nextAllowedAt=$NextRepair[$id].ToUniversalTime().ToString('o') }
  }
  $state = Get-TaskState $Component.task
  if ($state -eq 'MISSING') {
    Write-Event 'repair-blocked' ([ordered]@{ component=$id; reason=$Reason; error='TASK_MISSING' })
    return [pscustomobject]@{ attempted=$false; id=$id; reason=$Reason; outcome='task-missing' }
  }
  try {
    if ($state -eq 'Running') { Stop-ScheduledTask -TaskName $Component.task -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1 }
    Start-ScheduledTask -TaskName $Component.task -ErrorAction Stop
    Start-Sleep -Seconds 3
    $after = Get-ComponentHealth $Component
    $failCount = [int]($Failures[$id])
    $backoff = [math]::Min(900, 30 * [math]::Pow(2, [math]::Min([math]::Max($failCount-2,0),4)))
    $NextRepair[$id] = (Get-Date).AddSeconds($backoff)
    $outcome = if ($after.healthy) { 'recovered' } else { 'restart-did-not-recover' }
    Write-Event 'repair' ([ordered]@{ component=$id; reason=$Reason; outcome=$outcome; taskState=$after.taskState; nextAllowedAt=$NextRepair[$id].ToUniversalTime().ToString('o') })
    return [pscustomobject]@{ attempted=$true; id=$id; reason=$Reason; outcome=$outcome; after=$after }
  } catch {
    $NextRepair[$id] = (Get-Date).AddMinutes(5)
    Write-Event 'repair-error' ([ordered]@{ component=$id; reason=$Reason; error=$_.Exception.Message })
    return [pscustomobject]@{ attempted=$true; id=$id; reason=$Reason; outcome='error'; error=$_.Exception.Message }
  }
}

if ($SelfTest) {
  $parserErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$null, [ref]$parserErrors)
  $taskName = 'TigerIQ Supervisor V2 SelfTest Target'
  $marker = 'supervisor-v2-selftest-target'
  $repairOutcome = 'not-run'; $selfTestError = $null
  try {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -Command `"Start-Sleep -Seconds 60 # $marker`""
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddHours(1)
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
    $dummy = [pscustomobject]@{ id='selftest-target'; task=$taskName; mode='process'; uri=$null; jsonOk=$false; pattern=$marker; autoRepair=$true; critical=$false }
    $Failures[$dummy.id] = 2
    $repair = Invoke-BoundedRepair $dummy 'selftest'
    $repairOutcome = $repair.outcome
  } catch { $selfTestError = $_.Exception.Message }
  finally { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue }
  $nowTest = Get-Date
  $queueStallTrue = Test-QueueStalled 1 0 $nowTest.AddSeconds(-91) $nowTest
  $queueStallFalseWithLease = Test-QueueStalled 1 1 $nowTest.AddSeconds(-120) $nowTest
  $queueStallFalseEmpty = Test-QueueStalled 0 0 $nowTest.AddSeconds(-120) $nowTest
  $pass = (@($parserErrors).Count -eq 0 -and $Components.Count -ge 8 -and $repairOutcome -eq 'recovered' -and $queueStallTrue -and -not $queueStallFalseWithLease -and -not $queueStallFalseEmpty)
  [ordered]@{ version=$Version; parserErrors=@($parserErrors).Count; components=$Components.Count; repairOutcome=$repairOutcome; queueStallTrue=$queueStallTrue; queueStallFalseWithLease=$queueStallFalseWithLease; queueStallFalseEmpty=$queueStallFalseEmpty; error=$selfTestError; pass=$pass } | ConvertTo-Json -Depth 4
  if ($pass) { exit 0 } else { exit 1 }
}
while ($true) {
  $now = Get-Date
  $controllerBody = $null
  $componentStates = @()
  $repairs = @()
  foreach ($component in $Components) {
    $health = Get-ComponentHealth $component
    if ($component.id -eq 'controller' -and $health.body) { $controllerBody = $health.body }
    if (-not $LastHealthy.ContainsKey($component.id) -or $LastHealthy[$component.id] -ne $health.healthy) {
      Write-Event 'health-change' ([ordered]@{ component=$component.id; healthy=$health.healthy; taskState=$health.taskState; httpStatus=$health.httpStatus; error=$health.error })
      $LastHealthy[$component.id] = $health.healthy
    }
    if ($health.healthy) { $Failures[$component.id] = 0 }
    else {
      $Failures[$component.id] = 1 + [int]($Failures[$component.id])
      if ([int]$Failures[$component.id] -ge 2) {
        $repair = Invoke-BoundedRepair $component 'component-unhealthy'
        $repairs += $repair
        if ($repair.attempted -and $repair.outcome -eq 'recovered') {
          $health = $repair.after
          $Failures[$component.id] = 0
          $LastHealthy[$component.id] = $true
        }
      }
    }
    $componentStates += [ordered]@{
      id=$health.id; healthy=$health.healthy; taskState=$health.taskState; processOk=$health.processOk; processCount=$health.processCount; duplicateProcess=([int]$health.processCount -gt 1)
      httpOk=$health.httpOk; httpStatus=$health.httpStatus; failures=[int]$Failures[$component.id]; autoRepair=[bool]$component.autoRepair; critical=[bool]$component.critical
    }
  }

  $queuedJobs = if ($controllerBody) { [int]$controllerBody.workforce.queuedJobs } else { $null }
  $activeLeases = if ($controllerBody) { [int]$controllerBody.workforce.activeLeases } else { $null }
  $pc01Online = if ($controllerBody -and $controllerBody.pc01) { [bool]$controllerBody.pc01.online } else { $false }
  $postgresOk = if ($controllerBody) { [bool]$controllerBody.postgres } else { $false }
  $queueStalled = $false
  if ($queuedJobs -ne $null -and $queuedJobs -gt 0 -and $activeLeases -eq 0) {
    if ($null -eq $QueueNoLeaseSince) { $QueueNoLeaseSince = $now }
    if (Test-QueueStalled $queuedJobs $activeLeases $QueueNoLeaseSince $now) {
      $queueStalled = $true
      if (($now - $LastQueueAlertAt).TotalMinutes -ge 5) {
        Write-Event 'queue-stalled' ([ordered]@{ queuedJobs=$queuedJobs; activeLeases=$activeLeases; since=$QueueNoLeaseSince.ToUniversalTime().ToString('o') })
        $LastQueueAlertAt = $now
      }
    }
  } else { $QueueNoLeaseSince = $null }

  if (-not $pc01Online) {
    $Failures['pc01-heartbeat'] = 1 + [int]($Failures['pc01-heartbeat'])
    if ([int]$Failures['pc01-heartbeat'] -ge 2) {
      $workerComponent = $Components | Where-Object { $_.id -eq 'pc01-worker' } | Select-Object -First 1
      $repair = Invoke-BoundedRepair $workerComponent 'pc01-heartbeat-stale'
      $repairs += $repair
    }
  } else { $Failures['pc01-heartbeat'] = 0 }

  $criticalHealthy = @($componentStates | Where-Object { $_.critical -and -not $_.healthy }).Count -eq 0
  $overallOk = [bool]($criticalHealthy -and $postgresOk -and $pc01Online -and -not $queueStalled)
  $status = [ordered]@{
    updatedAt=$now.ToUniversalTime().ToString('o'); version=$Version; repairsEnabled=(-not $NoRepair); overallOk=$overallOk
    system=(Get-SystemMetrics); controller=[ordered]@{ postgresOk=$postgresOk; pc01Online=$pc01Online; queuedJobs=$queuedJobs; activeLeases=$activeLeases; queueStalled=$queueStalled }
    components=$componentStates; repairsThisLoop=@($repairs | ForEach-Object { [ordered]@{ id=$_.id; attempted=$_.attempted; reason=$_.reason; outcome=$_.outcome } })
    boundaries=[ordered]@{ providerRouterMutation=$false; webControlMutation=$false; browserSessionMutation=$false; rebootPerformed=$false }
  }
  Write-AtomicJson $StatusPath $status
  if ($Once) { $status | ConvertTo-Json -Depth 10; break }
  Start-Sleep -Seconds ([math]::Max(5,$IntervalSeconds))
}
