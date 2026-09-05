$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True([bool]$Condition, [string]$Name) {
  if (-not $Condition) { throw "AI_PROVIDER_SCHEDULER_TEST_FAIL:$Name" }
}

$schedulerPath = Join-Path $PSScriptRoot 'ai-provider-scheduler.ps1'
Assert-True (Test-Path $schedulerPath) 'scheduler_exists'
. $schedulerPath

$root = Join-Path ([System.IO.Path]::GetTempPath()) ("tigeriq-ai-scheduler-{0}" -f [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
try {
  $state = New-SchedulerState
  $t0 = [datetime]'2026-09-05T00:00:00Z'
  $eligible = @('openrouter:free','ollama:qwen','gemini:account')

  $noProof = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-NOPROOF' -Role executor -Candidates @('openrouter:free') -EligibleBackendIdentities @() -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0
  Assert-True ($noProof.status -eq 'BLOCKED_NO_ELIGIBLE_BACKEND') 'missing_probe_eligibility_fails_closed'
  Assert-True ($noProof.attempts -eq 0) 'missing_eligibility_does_not_consume_attempt'

  $paidCandidate = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-PAID' -Role executor -Candidates @('openrouter:paid-model') -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0
  Assert-True ($paidCandidate.status -eq 'BLOCKED_NO_ELIGIBLE_BACKEND') 'candidate_outside_probe_ready_set_rejected'
  Assert-True ($paidCandidate.attempts -eq 0) 'rejected_candidate_does_not_consume_attempt'

  $a1 = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-TEST-1' -Role executor -Candidates @('openrouter:free','ollama:qwen') -EligibleBackendIdentities $eligible -ExcludedBackendIdentities @() -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0
  Assert-True ($a1.status -eq 'LEASE_ACQUIRED') 'first_lease_acquired'
  Assert-True ($a1.attempts -eq 1) 'first_attempt_count'
  Assert-True ($a1.backendIdentity -eq 'openrouter:free') 'first_backend_selected'

  $held = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-TEST-1' -Role executor -Candidates @('ollama:qwen') -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0.AddSeconds(5)
  Assert-True ($held.status -eq 'LEASE_HELD') 'duplicate_acquire_held'
  Assert-True ($held.attempts -eq 1) 'duplicate_does_not_increment_attempts'

  $staleFail = Invoke-SchedulerAction -State $state -Action Fail -WorkOrderId 'WO-TEST-1' -Role executor -LeaseToken 'wrong-token' -FailureClass timeout -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0.AddSeconds(6)
  Assert-True ($staleFail.status -eq 'STALE_LEASE_REJECTED') 'stale_fail_rejected'

  $retry1 = Invoke-SchedulerAction -State $state -Action Fail -WorkOrderId 'WO-TEST-1' -Role executor -LeaseToken $a1.leaseToken -FailureClass timeout -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0.AddSeconds(7)
  Assert-True ($retry1.status -eq 'RETRY_READY') 'timeout_retry_ready'

  $a2 = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-TEST-1' -Role executor -Candidates @('ollama:qwen') -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0.AddSeconds(8)
  Assert-True ($a2.status -eq 'LEASE_ACQUIRED') 'second_lease_acquired'
  Assert-True ($a2.attempts -eq 2) 'second_attempt_count'
  $retry2 = Invoke-SchedulerAction -State $state -Action Fail -WorkOrderId 'WO-TEST-1' -Role executor -LeaseToken $a2.leaseToken -FailureClass rate_limit -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0.AddSeconds(9)
  Assert-True ($retry2.status -eq 'RETRY_READY') 'rate_limit_retry_ready'

  $a3 = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-TEST-1' -Role executor -Candidates @('gemini:account') -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0.AddSeconds(10)
  Assert-True ($a3.attempts -eq 3) 'third_attempt_count'
  $exhausted = Invoke-SchedulerAction -State $state -Action Fail -WorkOrderId 'WO-TEST-1' -Role executor -LeaseToken $a3.leaseToken -FailureClass outage -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0.AddSeconds(11)
  Assert-True ($exhausted.status -eq 'ATTEMPTS_EXHAUSTED') 'bounded_retry_exhausted'
  $blocked = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-TEST-1' -Role executor -Candidates @('ollama:qwen') -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0.AddSeconds(12)
  Assert-True ($blocked.status -eq 'BLOCKED_TERMINAL') 'exhausted_stays_blocked'

  $review = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-TEST-2' -Role reviewer -Candidates @('openrouter:free','ollama:qwen') -EligibleBackendIdentities $eligible -ExcludedBackendIdentities @('openrouter:free') -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0
  Assert-True ($review.status -eq 'LEASE_ACQUIRED') 'reviewer_lease_acquired'
  Assert-True ($review.backendIdentity -eq 'ollama:qwen') 'excluded_backend_not_reused'
  $sha = ('a' * 64)
  $complete = Invoke-SchedulerAction -State $state -Action Complete -WorkOrderId 'WO-TEST-2' -Role reviewer -LeaseToken $review.leaseToken -ResultSha256 $sha -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0.AddSeconds(1)
  Assert-True ($complete.status -eq 'COMPLETED') 'completion_recorded'
  $deduped = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-TEST-2' -Role reviewer -Candidates @('gemini:account') -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0.AddSeconds(2)
  Assert-True ($deduped.status -eq 'DEDUPED_COMPLETED') 'completed_work_deduped'

  $expired1 = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-TEST-3' -Role judge -Candidates @('ollama:qwen') -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 5 -NowUtc $t0
  Assert-True ($expired1.status -eq 'LEASE_ACQUIRED') 'expiring_lease_acquired'
  $expired2 = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-TEST-3' -Role judge -Candidates @('gemini:account') -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 5 -NowUtc $t0.AddSeconds(6)
  Assert-True ($expired2.status -eq 'LEASE_ACQUIRED') 'expired_lease_recovered'
  Assert-True ($expired2.attempts -eq 2) 'expired_recovery_counts_attempt'
  Assert-True ($expired2.leaseToken -ne $expired1.leaseToken) 'expired_recovery_new_token'

  $terminal = Invoke-SchedulerAction -State $state -Action Acquire -WorkOrderId 'WO-TEST-4' -Role executor -Candidates @('openrouter:free') -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0
  $terminalFail = Invoke-SchedulerAction -State $state -Action Fail -WorkOrderId 'WO-TEST-4' -Role executor -LeaseToken $terminal.leaseToken -FailureClass billing_unknown -MaxAttempts 3 -LeaseSeconds 30 -NowUtc $t0.AddSeconds(1)
  Assert-True ($terminalFail.status -eq 'BLOCKED_TERMINAL') 'billing_unknown_fail_closed'
  Assert-True ($terminalFail.attempts -eq 1) 'terminal_failure_no_hidden_retry'

  $statePath = Join-Path $root 'state.json'
  $fileAcquire = Invoke-ProviderSchedulerFile -StatePath $statePath -Action Acquire -WorkOrderId 'WO-FILE-1' -Role executor -Candidates @('ollama:qwen') -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 30 -LockWaitMs 1000
  Assert-True ($fileAcquire.status -eq 'LEASE_ACQUIRED') 'file_backed_acquire'
  Assert-True (Test-Path $statePath) 'file_state_written'
  $fileHeld = Invoke-ProviderSchedulerFile -StatePath $statePath -Action Acquire -WorkOrderId 'WO-FILE-1' -Role executor -Candidates @('gemini:account') -EligibleBackendIdentities $eligible -MaxAttempts 3 -LeaseSeconds 30 -LockWaitMs 1000
  Assert-True ($fileHeld.status -eq 'LEASE_HELD') 'file_backed_dedupe'

  [ordered]@{
    schedulerTest = 'PASS'
    version = $script:SchedulerVersion
    probeEligibilityRequired = $true
    unprovenBackendRejected = $true
    boundedAttempts = 3
    dedupeByWorkOrderRole = $true
    leaseExpiryRecovery = $true
    staleTokenRejected = $true
    terminalBillingFailClosed = $true
    distinctBackendExclusion = $true
    fileBackedState = $true
  } | ConvertTo-Json
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
