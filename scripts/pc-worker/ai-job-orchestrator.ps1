$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$schedulerPath = Join-Path $PSScriptRoot 'ai-provider-scheduler.ps1'
if (-not (Test-Path -LiteralPath $schedulerPath)) { throw 'AI_JOB_ORCHESTRATOR_SCHEDULER_MISSING' }
. $schedulerPath

$script:OrchestratorVersion = 'TIGERIQ_AI_JOB_ORCHESTRATOR_V1'
$script:Roles = @('executor','reviewer','judge')

function Get-TextSha256([string]$Text) {
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]$Text)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Read-OrchestrationEvidence([string]$Path,[string]$WorkOrderId) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]@{ version=$script:OrchestratorVersion; workOrderId=$WorkOrderId; status='IN_PROGRESS'; stages=@(); updatedUtc=$null }
  }
  $evidence = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  if ([string]$evidence.version -ne $script:OrchestratorVersion) { throw 'AI_JOB_ORCHESTRATOR_EVIDENCE_VERSION_MISMATCH' }
  if ([string]$evidence.workOrderId -ne $WorkOrderId) { throw 'AI_JOB_ORCHESTRATOR_WORK_ORDER_MISMATCH' }
  if ($null -eq $evidence.stages) { $evidence | Add-Member -NotePropertyName stages -NotePropertyValue @() -Force }
  return $evidence
}

function Write-OrchestrationEvidence([object]$Evidence,[string]$Path) {
  $dir = Split-Path -Parent $Path
  if (-not [string]::IsNullOrWhiteSpace($dir) -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $tmp = "$Path.$PID.tmp"
  $Evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Get-OrchestrationStage([object]$Evidence,[string]$Role) {
  return @($Evidence.stages) | Where-Object { [string]$_.role -eq $Role } | Select-Object -First 1
}

function Set-OrchestrationStage([object]$Evidence,[string]$Role,[string]$Status,[string]$BackendIdentity,[int]$Attempts,[object]$ResultSha256,[object]$FailureClass) {
  $Evidence.stages = @($Evidence.stages | Where-Object { [string]$_.role -ne $Role }) + @([pscustomobject]@{
    role=$Role
    status=$Status
    backendIdentity=if ([string]::IsNullOrWhiteSpace($BackendIdentity)) { $null } else { $BackendIdentity }
    attempts=$Attempts
    resultSha256=$ResultSha256
    failureClass=$FailureClass
  })
}

function Set-OrchestrationBlocked([object]$Evidence,[string]$Role,[string]$FailureClass,[int]$Attempts) {
  $Evidence.status = 'BLOCKED'
  Set-OrchestrationStage -Evidence $Evidence -Role $Role -Status 'BLOCKED' -BackendIdentity '' -Attempts $Attempts -ResultSha256 $null -FailureClass $FailureClass
}

function Test-IdentityInSet([string]$Identity,[object[]]$Values) {
  foreach ($value in @($Values)) {
    if ([string]::Equals([string]$value,$Identity,[StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Get-SchedulerJobSnapshot([string]$StatePath,[string]$WorkOrderId,[string]$Role) {
  $state = Read-SchedulerState $StatePath
  return Get-SchedulerJob -State $state -WorkOrderId $WorkOrderId -Role $Role
}

function Assert-StageMatchesScheduler(
  [object]$Stage,
  [object]$SchedulerJob,
  [string]$Role,
  [object[]]$Candidates,
  [string[]]$EligibleBackendIdentities,
  [string[]]$AlreadyUsed
) {
  if ($null -eq $SchedulerJob -or -not [bool]$SchedulerJob.completed) { throw "AI_JOB_ORCHESTRATOR_SCHEDULER_NOT_COMPLETED:$Role" }
  $backend = [string]$Stage.backendIdentity
  $digest = [string]$Stage.resultSha256
  if ([string]::IsNullOrWhiteSpace($backend)) { throw "AI_JOB_ORCHESTRATOR_EVIDENCE_BACKEND_MISSING:$Role" }
  if ($digest -notmatch '^[a-f0-9]{64}$') { throw "AI_JOB_ORCHESTRATOR_EVIDENCE_DIGEST_INVALID:$Role" }
  if (-not (Test-IdentityInSet $backend $EligibleBackendIdentities)) { throw "AI_JOB_ORCHESTRATOR_EVIDENCE_BACKEND_NOT_ELIGIBLE:$Role" }
  if (-not (Test-IdentityInSet $backend $Candidates)) { throw "AI_JOB_ORCHESTRATOR_EVIDENCE_BACKEND_NOT_CANDIDATE:$Role" }
  if (Test-IdentityInSet $backend $AlreadyUsed) { throw "AI_JOB_ORCHESTRATOR_EVIDENCE_BACKEND_REUSED:$Role" }
  if ([string]$SchedulerJob.resultSha256 -ne $digest) { throw "AI_JOB_ORCHESTRATOR_EVIDENCE_SCHEDULER_DIGEST_MISMATCH:$Role" }
  if ([int]$SchedulerJob.attempts -ne [int]$Stage.attempts) { throw "AI_JOB_ORCHESTRATOR_EVIDENCE_SCHEDULER_ATTEMPT_MISMATCH:$Role" }
}

function Invoke-AiJobOrchestration {
  param(
    [Parameter(Mandatory=$true)][string]$StatePath,
    [Parameter(Mandatory=$true)][string]$EvidencePath,
    [Parameter(Mandatory=$true)][string]$WorkOrderId,
    [Parameter(Mandatory=$true)][hashtable]$CandidatesByRole,
    [Parameter(Mandatory=$true)][string[]]$EligibleBackendIdentities,
    [Parameter(Mandatory=$true)][scriptblock]$ProviderInvoker,
    [int]$MaxAttempts=3,
    [int]$LeaseSeconds=120
  )

  Assert-SchedulerId $WorkOrderId 'WORK_ORDER_ID'
  $evidence = Read-OrchestrationEvidence -Path $EvidencePath -WorkOrderId $WorkOrderId
  $used = @()

  foreach ($role in $script:Roles) {
    $roleCandidates = @($CandidatesByRole[$role])
    $stage = Get-OrchestrationStage -Evidence $evidence -Role $role
    if ($null -ne $stage) {
      $stageStatus = [string]$stage.status
      if ($stageStatus -eq 'COMPLETED') {
        $schedulerJob = Get-SchedulerJobSnapshot -StatePath $StatePath -WorkOrderId $WorkOrderId -Role $role
        Assert-StageMatchesScheduler -Stage $stage -SchedulerJob $schedulerJob -Role $role -Candidates $roleCandidates -EligibleBackendIdentities $EligibleBackendIdentities -AlreadyUsed $used
        $used += [string]$stage.backendIdentity
        continue
      }
      if ($stageStatus -eq 'COMMITTING') {
        $schedulerJob = Get-SchedulerJobSnapshot -StatePath $StatePath -WorkOrderId $WorkOrderId -Role $role
        if ($null -ne $schedulerJob -and [bool]$schedulerJob.completed) {
          Assert-StageMatchesScheduler -Stage $stage -SchedulerJob $schedulerJob -Role $role -Candidates $roleCandidates -EligibleBackendIdentities $EligibleBackendIdentities -AlreadyUsed $used
          Set-OrchestrationStage -Evidence $evidence -Role $role -Status 'COMPLETED' -BackendIdentity ([string]$stage.backendIdentity) -Attempts ([int]$stage.attempts) -ResultSha256 ([string]$stage.resultSha256) -FailureClass $null
          $evidence.status = 'IN_PROGRESS'
          $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
          Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath
          $used += [string]$stage.backendIdentity
          continue
        }
        $evidence.status = 'BLOCKED'
        $stage.failureClass = 'recovery_commit_not_confirmed'
        $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
        Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath
        return $evidence
      }
      if ($stageStatus -eq 'INVOKING') {
        $evidence.status = 'BLOCKED'
        $stage.failureClass = 'recovery_provider_outcome_unknown'
        $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
        Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath
        return $evidence
      }
    }

    $attemptedThisRole = @()
    $evidence.status = 'IN_PROGRESS'
    while ($true) {
      $excluded = @($used + $attemptedThisRole)
      $lease = Invoke-ProviderSchedulerFile -StatePath $StatePath -Action Acquire -WorkOrderId $WorkOrderId -Role $role -Candidates $roleCandidates -EligibleBackendIdentities $EligibleBackendIdentities -ExcludedBackendIdentities $excluded -MaxAttempts $MaxAttempts -LeaseSeconds $LeaseSeconds

      if ($lease.status -eq 'DEDUPED_COMPLETED') {
        throw "AI_JOB_ORCHESTRATOR_EVIDENCE_MISSING_FOR_DEDUPED_STAGE:$role"
      }
      if ($lease.status -ne 'LEASE_ACQUIRED') {
        Set-OrchestrationBlocked -Evidence $evidence -Role $role -FailureClass ([string]$lease.status) -Attempts ([int]$lease.attempts)
        $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
        Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath
        return $evidence
      }

      $backend = [string]$lease.backendIdentity
      Set-OrchestrationStage -Evidence $evidence -Role $role -Status 'INVOKING' -BackendIdentity $backend -Attempts ([int]$lease.attempts) -ResultSha256 $null -FailureClass $null
      $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
      Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath

      $outcome = & $ProviderInvoker $role $backend ([int]$lease.attempts)
      if ($null -eq $outcome) { throw 'AI_JOB_ORCHESTRATOR_PROVIDER_RESULT_MISSING' }

      if ([bool]$outcome.ok) {
        $digest = Get-TextSha256 ([string]$outcome.output)
        Set-OrchestrationStage -Evidence $evidence -Role $role -Status 'COMMITTING' -BackendIdentity $backend -Attempts ([int]$lease.attempts) -ResultSha256 $digest -FailureClass $null
        $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
        Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath

        $done = Invoke-ProviderSchedulerFile -StatePath $StatePath -Action Complete -WorkOrderId $WorkOrderId -Role $role -LeaseToken ([string]$lease.leaseToken) -ResultSha256 $digest -MaxAttempts $MaxAttempts -LeaseSeconds $LeaseSeconds
        if ($done.status -ne 'COMPLETED') {
          $evidence.status = 'BLOCKED'
          $stageNow = Get-OrchestrationStage -Evidence $evidence -Role $role
          $stageNow.failureClass = "scheduler_complete_$([string]$done.status)"
          $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
          Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath
          return $evidence
        }
        Set-OrchestrationStage -Evidence $evidence -Role $role -Status 'COMPLETED' -BackendIdentity $backend -Attempts ([int]$done.attempts) -ResultSha256 $digest -FailureClass $null
        $used += $backend
        $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
        Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath
        break
      }

      $failure = ([string]$outcome.failureClass).Trim().ToLowerInvariant()
      $failed = Invoke-ProviderSchedulerFile -StatePath $StatePath -Action Fail -WorkOrderId $WorkOrderId -Role $role -LeaseToken ([string]$lease.leaseToken) -FailureClass $failure -MaxAttempts $MaxAttempts -LeaseSeconds $LeaseSeconds
      $attemptedThisRole += $backend
      if ($failed.status -ne 'RETRY_READY') {
        Set-OrchestrationBlocked -Evidence $evidence -Role $role -FailureClass $failure -Attempts ([int]$failed.attempts)
        $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
        Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath
        return $evidence
      }

      $evidence.stages = @($evidence.stages | Where-Object { [string]$_.role -ne $role })
      $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
      Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath
    }
  }

  $distinct = @($evidence.stages | Where-Object { $_.status -eq 'COMPLETED' } | ForEach-Object { [string]$_.backendIdentity } | Sort-Object -Unique)
  if ($distinct.Count -ne 3) { throw 'AI_JOB_ORCHESTRATOR_DISTINCT_BACKEND_INVARIANT_FAILED' }
  $evidence.status = 'COMPLETED'
  $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
  Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath
  return $evidence
}
