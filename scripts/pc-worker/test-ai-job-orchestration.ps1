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
    evidenceDigestOnly=$true
    terminalBillingFailClosed=$true
    unprovenBackendNeverInvoked=$true
  } | ConvertTo-Json
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
