param(
  [ValidateSet('Acquire','Complete','Fail','Status')][string]$Action = 'Status',
  [string]$StatePath = '',
  [string]$WorkOrderId = '',
  [ValidateSet('executor','reviewer','judge')][string]$Role = 'executor',
  [string[]]$Candidates = @(),
  [string[]]$EligibleBackendIdentities = @(),
  [string[]]$ExcludedBackendIdentities = @(),
  [string]$LeaseToken = '',
  [string]$FailureClass = '',
  [string]$ResultSha256 = '',
  [int]$MaxAttempts = 3,
  [int]$LeaseSeconds = 120,
  [int]$LockWaitMs = 1500
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:SchedulerVersion = 'TIGERIQ_AI_PROVIDER_SCHEDULER_V1'
$script:RetryableFailures = @('timeout','rate_limit','outage')
$script:TerminalFailures = @('auth','config','invalid_response','billing_unknown','billing_nonzero')

function Assert-SchedulerId([string]$Value, [string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') {
    throw "AI_PROVIDER_SCHEDULER_INVALID_$Name"
  }
}

function New-StringSet([string[]]$Values) {
  $set = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($item in @($Values)) {
    if (-not [string]::IsNullOrWhiteSpace($item)) {
      [void]$set.Add($item.Trim())
    }
  }
  return ,$set
}

function New-SchedulerState {
  return [pscustomobject]@{
    version = $script:SchedulerVersion
    jobs = @()
  }
}

function Read-SchedulerState([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return New-SchedulerState
  }
  $raw = Get-Content -Raw -LiteralPath $Path
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return New-SchedulerState
  }
  $state = $raw | ConvertFrom-Json
  if ([string]$state.version -ne $script:SchedulerVersion) {
    throw 'AI_PROVIDER_SCHEDULER_STATE_VERSION_MISMATCH'
  }
  if ($null -eq $state.jobs) {
    $state | Add-Member -NotePropertyName jobs -NotePropertyValue @() -Force
  }
  return $state
}

function Write-SchedulerState([object]$State, [string]$Path) {
  $dir = Split-Path -Parent $Path
  if (-not [string]::IsNullOrWhiteSpace($dir) -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $tmp = "$Path.$PID.tmp"
  $State | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Get-SchedulerJob([object]$State, [string]$WorkOrderId, [string]$Role) {
  return @($State.jobs) |
    Where-Object { [string]$_.workOrderId -eq $WorkOrderId -and [string]$_.role -eq $Role } |
    Select-Object -First 1
}

function Add-SchedulerJob([object]$State, [string]$WorkOrderId, [string]$Role) {
  $job = [pscustomobject]@{
    workOrderId = $WorkOrderId
    role = $Role
    attempts = 0
    completed = $false
    blocked = $false
    activeLease = $null
    lastFailure = $null
    resultSha256 = $null
    updatedUtc = $null
  }
  $State.jobs = @($State.jobs) + @($job)
  return $job
}

function Test-LeaseExpired([object]$Lease, [datetime]$NowUtc) {
  if ($null -eq $Lease) {
    return $true
  }
  $expiry = [datetime]::Parse([string]$Lease.expiresUtc).ToUniversalTime()
  return $expiry -le $NowUtc.ToUniversalTime()
}

function Select-BackendIdentity(
  [string[]]$Candidates,
  [string[]]$Eligible,
  [string[]]$Excluded
) {
  $eligibleSet = New-StringSet $Eligible
  if ($eligibleSet.Count -eq 0) {
    return $null
  }

  $excludedSet = New-StringSet $Excluded
  $seen = New-StringSet @()

  foreach ($candidate in @($Candidates)) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }
    $identity = $candidate.Trim()
    Assert-SchedulerId $identity 'BACKEND_IDENTITY'
    if (-not $eligibleSet.Contains($identity)) {
      continue
    }
    if ($excludedSet.Contains($identity)) {
      continue
    }
    if ($seen.Add($identity)) {
      return $identity
    }
  }
  return $null
}

function New-SchedulerResult(
  [string]$Status,
  [object]$Job,
  [object]$Lease = $null,
  [string]$Reason = ''
) {
  return [ordered]@{
    version = $script:SchedulerVersion
    status = $Status
    workOrderId = if ($null -ne $Job) { [string]$Job.workOrderId } else { $null }
    role = if ($null -ne $Job) { [string]$Job.role } else { $null }
    attempts = if ($null -ne $Job) { [int]$Job.attempts } else { 0 }
    backendIdentity = if ($null -ne $Lease) { [string]$Lease.backendIdentity } else { $null }
    leaseToken = if ($null -ne $Lease) { [string]$Lease.token } else { $null }
    expiresUtc = if ($null -ne $Lease) { [string]$Lease.expiresUtc } else { $null }
    reason = $Reason
  }
}

function Invoke-SchedulerAction {
  param(
    [Parameter(Mandatory = $true)][object]$State,
    [Parameter(Mandatory = $true)][ValidateSet('Acquire','Complete','Fail','Status')][string]$Action,
    [Parameter(Mandatory = $true)][string]$WorkOrderId,
    [Parameter(Mandatory = $true)][ValidateSet('executor','reviewer','judge')][string]$Role,
    [string[]]$Candidates = @(),
    [string[]]$EligibleBackendIdentities = @(),
    [string[]]$ExcludedBackendIdentities = @(),
    [string]$LeaseToken = '',
    [string]$FailureClass = '',
    [string]$ResultSha256 = '',
    [int]$MaxAttempts = 3,
    [int]$LeaseSeconds = 120,
    [datetime]$NowUtc = ([datetime]::UtcNow)
  )

  Assert-SchedulerId $WorkOrderId 'WORK_ORDER_ID'
  if ($MaxAttempts -lt 1 -or $MaxAttempts -gt 3) {
    throw 'AI_PROVIDER_SCHEDULER_INVALID_MAX_ATTEMPTS'
  }
  if ($LeaseSeconds -lt 5 -or $LeaseSeconds -gt 3600) {
    throw 'AI_PROVIDER_SCHEDULER_INVALID_LEASE_SECONDS'
  }
  $NowUtc = $NowUtc.ToUniversalTime()

  $job = Get-SchedulerJob $State $WorkOrderId $Role
  if ($null -eq $job) {
    $job = Add-SchedulerJob $State $WorkOrderId $Role
  }

  if ($null -ne $job.activeLease -and (Test-LeaseExpired $job.activeLease $NowUtc)) {
    $job.activeLease = $null
    $job.updatedUtc = $NowUtc.ToString('o')
  }

  switch ($Action) {
    'Acquire' {
      if ([bool]$job.completed) {
        return New-SchedulerResult 'DEDUPED_COMPLETED' $job $null 'work_order_role_already_completed'
      }
      if ([bool]$job.blocked) {
        return New-SchedulerResult 'BLOCKED_TERMINAL' $job $null 'terminal_failure_or_attempts_exhausted'
      }
      if ($null -ne $job.activeLease) {
        return New-SchedulerResult 'LEASE_HELD' $job $job.activeLease 'active_unexpired_lease'
      }
      if ([int]$job.attempts -ge $MaxAttempts) {
        $job.blocked = $true
        $job.updatedUtc = $NowUtc.ToString('o')
        return New-SchedulerResult 'ATTEMPTS_EXHAUSTED' $job $null 'bounded_attempt_limit_reached'
      }

      $backend = Select-BackendIdentity $Candidates $EligibleBackendIdentities $ExcludedBackendIdentities
      if ([string]::IsNullOrWhiteSpace($backend)) {
        return New-SchedulerResult 'BLOCKED_NO_ELIGIBLE_BACKEND' $job $null 'candidate_not_in_probe_ready_eligibility_set'
      }

      $job.attempts = [int]$job.attempts + 1
      $lease = [pscustomobject]@{
        token = [guid]::NewGuid().ToString('N')
        backendIdentity = $backend
        acquiredUtc = $NowUtc.ToString('o')
        expiresUtc = $NowUtc.AddSeconds($LeaseSeconds).ToString('o')
      }
      $job.activeLease = $lease
      $job.updatedUtc = $NowUtc.ToString('o')
      return New-SchedulerResult 'LEASE_ACQUIRED' $job $lease ''
    }

    'Complete' {
      if ([bool]$job.completed) {
        return New-SchedulerResult 'DEDUPED_COMPLETED' $job $null 'work_order_role_already_completed'
      }
      if ($null -eq $job.activeLease) {
        return New-SchedulerResult 'STALE_LEASE_REJECTED' $job $null 'no_active_lease'
      }
      if ([string]::IsNullOrWhiteSpace($LeaseToken) -or [string]$job.activeLease.token -ne $LeaseToken) {
        return New-SchedulerResult 'STALE_LEASE_REJECTED' $job $job.activeLease 'lease_token_mismatch'
      }
      if ($ResultSha256 -notmatch '^[a-fA-F0-9]{64}$') {
        throw 'AI_PROVIDER_SCHEDULER_INVALID_RESULT_SHA256'
      }

      $job.completed = $true
      $job.blocked = $false
      $job.resultSha256 = $ResultSha256.ToLowerInvariant()
      $job.activeLease = $null
      $job.lastFailure = $null
      $job.updatedUtc = $NowUtc.ToString('o')
      return New-SchedulerResult 'COMPLETED' $job $null ''
    }

    'Fail' {
      if ($null -eq $job.activeLease) {
        return New-SchedulerResult 'STALE_LEASE_REJECTED' $job $null 'no_active_lease'
      }
      if ([string]::IsNullOrWhiteSpace($LeaseToken) -or [string]$job.activeLease.token -ne $LeaseToken) {
        return New-SchedulerResult 'STALE_LEASE_REJECTED' $job $job.activeLease 'lease_token_mismatch'
      }

      $failure = $FailureClass.Trim().ToLowerInvariant()
      $knownFailure = ($script:RetryableFailures -contains $failure) -or ($script:TerminalFailures -contains $failure)
      if (-not $knownFailure) {
        throw 'AI_PROVIDER_SCHEDULER_INVALID_FAILURE_CLASS'
      }

      $job.lastFailure = [pscustomobject]@{
        class = $failure
        atUtc = $NowUtc.ToString('o')
      }
      $job.activeLease = $null
      $job.updatedUtc = $NowUtc.ToString('o')

      if ($script:TerminalFailures -contains $failure) {
        $job.blocked = $true
        return New-SchedulerResult 'BLOCKED_TERMINAL' $job $null $failure
      }
      if ([int]$job.attempts -ge $MaxAttempts) {
        $job.blocked = $true
        return New-SchedulerResult 'ATTEMPTS_EXHAUSTED' $job $null $failure
      }
      return New-SchedulerResult 'RETRY_READY' $job $null $failure
    }

    'Status' {
      if ([bool]$job.completed) {
        return New-SchedulerResult 'DEDUPED_COMPLETED' $job $null 'work_order_role_already_completed'
      }
      if ([bool]$job.blocked) {
        return New-SchedulerResult 'BLOCKED_TERMINAL' $job $null 'terminal_failure_or_attempts_exhausted'
      }
      if ($null -ne $job.activeLease) {
        return New-SchedulerResult 'LEASE_HELD' $job $job.activeLease 'active_unexpired_lease'
      }
      return New-SchedulerResult 'READY' $job $null ''
    }
  }
}

function Invoke-ProviderSchedulerFile {
  param(
    [Parameter(Mandatory = $true)][string]$StatePath,
    [Parameter(Mandatory = $true)][ValidateSet('Acquire','Complete','Fail','Status')][string]$Action,
    [Parameter(Mandatory = $true)][string]$WorkOrderId,
    [Parameter(Mandatory = $true)][ValidateSet('executor','reviewer','judge')][string]$Role,
    [string[]]$Candidates = @(),
    [string[]]$EligibleBackendIdentities = @(),
    [string[]]$ExcludedBackendIdentities = @(),
    [string]$LeaseToken = '',
    [string]$FailureClass = '',
    [string]$ResultSha256 = '',
    [int]$MaxAttempts = 3,
    [int]$LeaseSeconds = 120,
    [int]$LockWaitMs = 1500
  )

  if ($LockWaitMs -lt 100 -or $LockWaitMs -gt 10000) {
    throw 'AI_PROVIDER_SCHEDULER_INVALID_LOCK_WAIT_MS'
  }

  $lockPath = "$StatePath.lock"
  $lockDir = Split-Path -Parent $lockPath
  if (-not [string]::IsNullOrWhiteSpace($lockDir) -and -not (Test-Path -LiteralPath $lockDir)) {
    New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
  }

  $deadline = [datetime]::UtcNow.AddMilliseconds($LockWaitMs)
  $stream = $null
  while ($null -eq $stream -and [datetime]::UtcNow -lt $deadline) {
    try {
      $stream = [System.IO.File]::Open(
        $lockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
      )
    }
    catch [System.IO.IOException] {
      Start-Sleep -Milliseconds 50
    }
  }
  if ($null -eq $stream) {
    throw 'AI_PROVIDER_SCHEDULER_LOCK_TIMEOUT'
  }

  try {
    $state = Read-SchedulerState $StatePath
    $result = Invoke-SchedulerAction `
      -State $state `
      -Action $Action `
      -WorkOrderId $WorkOrderId `
      -Role $Role `
      -Candidates $Candidates `
      -EligibleBackendIdentities $EligibleBackendIdentities `
      -ExcludedBackendIdentities $ExcludedBackendIdentities `
      -LeaseToken $LeaseToken `
      -FailureClass $FailureClass `
      -ResultSha256 $ResultSha256 `
      -MaxAttempts $MaxAttempts `
      -LeaseSeconds $LeaseSeconds
    Write-SchedulerState $state $StatePath
    return $result
  }
  finally {
    $stream.Dispose()
  }
}

if ($MyInvocation.InvocationName -eq '.') {
  return
}
if ([string]::IsNullOrWhiteSpace($StatePath)) {
  throw 'AI_PROVIDER_SCHEDULER_STATE_PATH_REQUIRED'
}
if ([string]::IsNullOrWhiteSpace($WorkOrderId)) {
  throw 'AI_PROVIDER_SCHEDULER_WORK_ORDER_REQUIRED'
}

$result = Invoke-ProviderSchedulerFile `
  -StatePath $StatePath `
  -Action $Action `
  -WorkOrderId $WorkOrderId `
  -Role $Role `
  -Candidates $Candidates `
  -EligibleBackendIdentities $EligibleBackendIdentities `
  -ExcludedBackendIdentities $ExcludedBackendIdentities `
  -LeaseToken $LeaseToken `
  -FailureClass $FailureClass `
  -ResultSha256 $ResultSha256 `
  -MaxAttempts $MaxAttempts `
  -LeaseSeconds $LeaseSeconds `
  -LockWaitMs $LockWaitMs
$result | ConvertTo-Json -Depth 8
