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

function Get-CompletedStage([object]$Evidence,[string]$Role) {
  return @($Evidence.stages) | Where-Object { [string]$_.role -eq $Role -and [string]$_.status -eq 'COMPLETED' } | Select-Object -First 1
}

function Add-OrchestrationStage([object]$Evidence,[string]$Role,[string]$BackendIdentity,[int]$Attempts,[string]$ResultSha256) {
  $existing = @($Evidence.stages) | Where-Object { [string]$_.role -eq $Role }
  $Evidence.stages = @($Evidence.stages | Where-Object { [string]$_.role -ne $Role }) + @([pscustomobject]@{
    role=$Role; status='COMPLETED'; backendIdentity=$BackendIdentity; attempts=$Attempts; resultSha256=$ResultSha256; failureClass=$null
  })
}

function Set-OrchestrationBlocked([object]$Evidence,[string]$Role,[string]$FailureClass,[int]$Attempts) {
  $Evidence.status = 'BLOCKED'
  $Evidence.stages = @($Evidence.stages | Where-Object { [string]$_.role -ne $Role }) + @([pscustomobject]@{
    role=$Role; status='BLOCKED'; backendIdentity=$null; attempts=$Attempts; resultSha256=$null; failureClass=$FailureClass
  })
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
    $completed = Get-CompletedStage -Evidence $evidence -Role $role
    if ($null -ne $completed) {
      $used += [string]$completed.backendIdentity
      continue
    }

    $attemptedThisRole = @()
    while ($true) {
      $candidates = @($CandidatesByRole[$role])
      $excluded = @($used + $attemptedThisRole)
      $lease = Invoke-ProviderSchedulerFile -StatePath $StatePath -Action Acquire -WorkOrderId $WorkOrderId -Role $role -Candidates $candidates -EligibleBackendIdentities $EligibleBackendIdentities -ExcludedBackendIdentities $excluded -MaxAttempts $MaxAttempts -LeaseSeconds $LeaseSeconds

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
      $outcome = & $ProviderInvoker $role $backend ([int]$lease.attempts)
      if ($null -eq $outcome) { throw 'AI_JOB_ORCHESTRATOR_PROVIDER_RESULT_MISSING' }

      if ([bool]$outcome.ok) {
        $digest = Get-TextSha256 ([string]$outcome.output)
        $done = Invoke-ProviderSchedulerFile -StatePath $StatePath -Action Complete -WorkOrderId $WorkOrderId -Role $role -LeaseToken ([string]$lease.leaseToken) -ResultSha256 $digest -MaxAttempts $MaxAttempts -LeaseSeconds $LeaseSeconds
        if ($done.status -ne 'COMPLETED') { throw "AI_JOB_ORCHESTRATOR_COMPLETE_FAILED:$($done.status)" }
        Add-OrchestrationStage -Evidence $evidence -Role $role -BackendIdentity $backend -Attempts ([int]$done.attempts) -ResultSha256 $digest
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
    }
  }

  $distinct = @($evidence.stages | Where-Object { $_.status -eq 'COMPLETED' } | ForEach-Object { [string]$_.backendIdentity } | Sort-Object -Unique)
  if ($distinct.Count -ne 3) { throw 'AI_JOB_ORCHESTRATOR_DISTINCT_BACKEND_INVARIANT_FAILED' }
  $evidence.status = 'COMPLETED'
  $evidence.updatedUtc = [DateTime]::UtcNow.ToString('o')
  Write-OrchestrationEvidence -Evidence $evidence -Path $EvidencePath
  return $evidence
}
