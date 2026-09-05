$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True([bool]$Condition,[string]$Name) { if (-not $Condition) { throw "AI_JOB_ORCHESTRATION_TEST_FAIL:$Name" } }

$orchestratorPath = Join-Path $PSScriptRoot 'ai-job-orchestrator.ps1'
Assert-True (Test-Path -LiteralPath $orchestratorPath) 'orchestrator_exists'
. $orchestratorPath

$root = Join-Path ([IO.Path]::GetTempPath()) ("tigeriq-ai-job-{0}" -f [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
try {
  $statePath = Join-Path $root 'scheduler.json'
  $evidencePath = Join-Path $root 'evidence.json'
  $eligible = @('gemini:account','openrouter:free','ollama:qwen')
  $candidateMap = @{
    executor=@('openrouter:free','gemini:account','ollama:qwen')
    reviewer=@('openrouter:free','ollama:qwen','gemini:account')
    judge=@('ollama:qwen','gemini:account','openrouter:free')
  }
  $calls = 0
  $invoker = {
    param($role,$backend,$attempt)
    $script:calls++
    if ($role -eq 'executor' -and $backend -eq 'openrouter:free' -and $attempt -eq 1) {
      return [pscustomobject]@{ ok=$false; failureClass='timeout'; output='' }
    }
    return [pscustomobject]@{ ok=$true; failureClass=''; output=("SECRET_SHOULD_NOT_APPEAR::{0}::{1}::{2}" -f $role,$backend,$attempt) }
  }

  $result = Invoke-AiJobOrchestration -StatePath $statePath -EvidencePath $evidencePath -WorkOrderId 'JOB-001' -CandidatesByRole $candidateMap -EligibleBackendIdentities $eligible -ProviderInvoker $invoker -MaxAttempts 3 -LeaseSeconds 30
  Assert-True ($result.status -eq 'COMPLETED') 'job_completed'
  Assert-True (@($result.stages).Count -eq 3) 'three_stages'
  $identities = @($result.stages | ForEach-Object { [string]$_.backendIdentity })
  Assert-True (@($identities | Sort-Object -Unique).Count -eq 3) 'three_distinct_backends'
  $executor = @($result.stages | Where-Object { $_.role -eq 'executor' })[0]
  Assert-True ($executor.attempts -eq 2) 'executor_failover_attempted'
  Assert-True ($executor.backendIdentity -eq 'gemini:account') 'executor_failed_over_to_second_backend'
  foreach ($stage in @($result.stages)) { Assert-True ([string]$stage.resultSha256 -match '^[a-f0-9]{64}$') ("digest_{0}" -f $stage.role) }
  $rawEvidence = Get-Content -Raw -LiteralPath $evidencePath
  Assert-True ($rawEvidence -notmatch 'SECRET_SHOULD_NOT_APPEAR') 'raw_output_not_in_evidence'

  $beforeCalls = $script:calls
  $noCallInvoker = { param($role,$backend,$attempt) throw 'PROVIDER_SHOULD_NOT_RUN_AFTER_RESTART' }
  $restart = Invoke-AiJobOrchestration -StatePath $statePath -EvidencePath $evidencePath -WorkOrderId 'JOB-001' -CandidatesByRole $candidateMap -EligibleBackendIdentities $eligible -ProviderInvoker $noCallInvoker -MaxAttempts 3 -LeaseSeconds 30
  Assert-True ($restart.status -eq 'COMPLETED') 'restart_completed_from_evidence'
  Assert-True ($script:calls -eq $beforeCalls) 'restart_no_duplicate_provider_call'

  $tampered = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
  $tamperedExecutor = @($tampered.stages | Where-Object { $_.role -eq 'executor' })[0]
  $tamperedExecutor.resultSha256 = ('0' * 64)
  $tampered | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $evidencePath -Encoding UTF8
  $tamperRejected = $false
  try {
    Invoke-AiJobOrchestration -StatePath $statePath -EvidencePath $evidencePath -WorkOrderId 'JOB-001' -CandidatesByRole $candidateMap -EligibleBackendIdentities $eligible -ProviderInvoker $noCallInvoker -MaxAttempts 3 -LeaseSeconds 30 | Out-Null
  } catch {
    $tamperRejected = $_.Exception.Message -match 'EVIDENCE_SCHEDULER_DIGEST_MISMATCH'
  }
  Assert-True $tamperRejected 'tampered_evidence_rejected_against_scheduler'

  $crashState = Join-Path $root 'crash-scheduler.json'
  $crashEvidencePath = Join-Path $root 'crash-evidence.json'
  $crashEvidence = Read-OrchestrationEvidence -Path $crashEvidencePath -WorkOrderId 'JOB-CRASH'
  $crashLease = Invoke-ProviderSchedulerFile -StatePath $crashState -Action Acquire -WorkOrderId 'JOB-CRASH' -Role executor -Candidates @($candidateMap.executor) -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 30
  Assert-True ($crashLease.status -eq 'LEASE_ACQUIRED') 'crash_window_lease_acquired'
  $crashDigest = Get-TextSha256 'CRASH_WINDOW_RESULT'
  Set-OrchestrationStage -Evidence $crashEvidence -Role executor -Status 'COMMITTING' -BackendIdentity ([string]$crashLease.backendIdentity) -Attempts ([int]$crashLease.attempts) -ResultSha256 $crashDigest -FailureClass $null
  Write-OrchestrationEvidence -Evidence $crashEvidence -Path $crashEvidencePath
  $crashDone = Invoke-ProviderSchedulerFile -StatePath $crashState -Action Complete -WorkOrderId 'JOB-CRASH' -Role executor -LeaseToken ([string]$crashLease.leaseToken) -ResultSha256 $crashDigest -MaxAttempts 3 -LeaseSeconds 30
  Assert-True ($crashDone.status -eq 'COMPLETED') 'crash_window_scheduler_completed'
  $crashCalls = 0
  $crashInvoker = {
    param($role,$backend,$attempt)
    if ($role -eq 'executor') { throw 'EXECUTOR_MUST_RECOVER_WITHOUT_DUPLICATE' }
    $script:crashCalls++
    return [pscustomobject]@{ ok=$true; failureClass=''; output=("RECOVERY::{0}::{1}" -f $role,$backend) }
  }
  $crashRecovered = Invoke-AiJobOrchestration -StatePath $crashState -EvidencePath $crashEvidencePath -WorkOrderId 'JOB-CRASH' -CandidatesByRole $candidateMap -EligibleBackendIdentities $eligible -ProviderInvoker $crashInvoker -MaxAttempts 3 -LeaseSeconds 30
  Assert-True ($crashRecovered.status -eq 'COMPLETED') 'crash_window_auto_recovered'
  Assert-True ($script:crashCalls -eq 2) 'crash_window_executor_not_reinvoked'

  $ambState = Join-Path $root 'amb-scheduler.json'
  $ambEvidencePath = Join-Path $root 'amb-evidence.json'
  $ambEvidence = Read-OrchestrationEvidence -Path $ambEvidencePath -WorkOrderId 'JOB-AMB'
  $ambLease = Invoke-ProviderSchedulerFile -StatePath $ambState -Action Acquire -WorkOrderId 'JOB-AMB' -Role executor -Candidates @($candidateMap.executor) -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 30
  Set-OrchestrationStage -Evidence $ambEvidence -Role executor -Status 'INVOKING' -BackendIdentity ([string]$ambLease.backendIdentity) -Attempts ([int]$ambLease.attempts) -ResultSha256 $null -FailureClass $null
  Write-OrchestrationEvidence -Evidence $ambEvidence -Path $ambEvidencePath
  $ambCalls = 0
  $ambInvoker = { param($role,$backend,$attempt) $script:ambCalls++; return [pscustomobject]@{ok=$true;failureClass='';output='must-not-run'} }
  $amb = Invoke-AiJobOrchestration -StatePath $ambState -EvidencePath $ambEvidencePath -WorkOrderId 'JOB-AMB' -CandidatesByRole $candidateMap -EligibleBackendIdentities $eligible -ProviderInvoker $ambInvoker -MaxAttempts 3 -LeaseSeconds 30
  Assert-True ($amb.status -eq 'BLOCKED') 'ambiguous_provider_outcome_fail_closed'
  Assert-True ($script:ambCalls -eq 0) 'ambiguous_provider_outcome_not_reinvoked'
  $ambStage = @($amb.stages | Where-Object { $_.role -eq 'executor' })[0]
  Assert-True ($ambStage.failureClass -eq 'recovery_provider_outcome_unknown') 'ambiguous_recovery_reason_recorded'

  $terminalState = Join-Path $root 'terminal-scheduler.json'
  $terminalEvidence = Join-Path $root 'terminal-evidence.json'
  $terminalInvoker = { param($role,$backend,$attempt) return [pscustomobject]@{ ok=$false; failureClass='billing_unknown'; output='SHOULD_NOT_PERSIST' } }
  $terminal = Invoke-AiJobOrchestration -StatePath $terminalState -EvidencePath $terminalEvidence -WorkOrderId 'JOB-TERM' -CandidatesByRole $candidateMap -EligibleBackendIdentities $eligible -ProviderInvoker $terminalInvoker -MaxAttempts 3 -LeaseSeconds 30
  Assert-True ($terminal.status -eq 'BLOCKED') 'terminal_billing_blocks_job'
  $terminalStage = @($terminal.stages | Where-Object { $_.role -eq 'executor' })[0]
  Assert-True ($terminalStage.attempts -eq 1) 'terminal_billing_no_retry'
  Assert-True ($terminalStage.failureClass -eq 'billing_unknown') 'terminal_failure_class_recorded'

  $eligState = Join-Path $root 'elig-scheduler.json'
  $eligEvidence = Join-Path $root 'elig-evidence.json'
  $paidCandidateMap = @{ executor=@('paid:model'); reviewer=@('paid:model'); judge=@('paid:model') }
  $eligCalls = 0
  $eligInvoker = { param($role,$backend,$attempt) $script:eligCalls++; return [pscustomobject]@{ok=$true;failureClass='';output='x'} }
  $elig = Invoke-AiJobOrchestration -StatePath $eligState -EvidencePath $eligEvidence -WorkOrderId 'JOB-ELIG' -CandidatesByRole $paidCandidateMap -EligibleBackendIdentities $eligible -ProviderInvoker $eligInvoker -MaxAttempts 3 -LeaseSeconds 30
  Assert-True ($elig.status -eq 'BLOCKED') 'unproven_backend_blocked'
  Assert-True ($script:eligCalls -eq 0) 'unproven_backend_never_invoked'

  [ordered]@{
    orchestrationTest='PASS'
    workOrder='JOB-001'
    threeDistinctBackendIdentities=$true
    boundedFailover=$true
    restartRecoveryNoDuplicate=$true
    crashWindowCommitRecovery=$true
    ambiguousProviderOutcomeFailClosed=$true
    tamperedEvidenceRejected=$true
    evidenceDigestOnly=$true
    terminalBillingFailClosed=$true
    unprovenBackendNeverInvoked=$true
  } | ConvertTo-Json
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
