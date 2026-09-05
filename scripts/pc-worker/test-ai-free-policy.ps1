$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True([bool]$Condition, [string]$Name) {
  if (-not $Condition) { throw "AI_FREE_POLICY_FAIL:$Name" }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$configPath = Join-Path $repoRoot 'config\ai-free-providers-v1.json'
$probePath = Join-Path $repoRoot 'scripts\pc-worker\probe-multi-ai.ps1'
$schedulerPath = Join-Path $repoRoot 'scripts\pc-worker\ai-provider-scheduler.ps1'
$schedulerTestPath = Join-Path $repoRoot 'scripts\pc-worker\test-ai-provider-scheduler.ps1'
$orchestratorPath = Join-Path $repoRoot 'scripts\pc-worker\ai-job-orchestrator.ps1'
$orchestratorTestPath = Join-Path $repoRoot 'scripts\pc-worker\test-ai-job-orchestration.ps1'
Assert-True (Test-Path $configPath) 'config_exists'
Assert-True (Test-Path $probePath) 'probe_exists'
Assert-True (Test-Path $schedulerPath) 'scheduler_exists'
Assert-True (Test-Path $schedulerTestPath) 'scheduler_test_exists'
Assert-True (Test-Path $orchestratorPath) 'orchestrator_exists'
Assert-True (Test-Path $orchestratorTestPath) 'orchestrator_test_exists'

$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
$probeText = Get-Content -Raw -Path $probePath
$schedulerText = Get-Content -Raw -Path $schedulerPath
$orchestratorText = Get-Content -Raw -Path $orchestratorPath
Assert-True ([string]$config.version -eq 'TIGERIQ_AI_FREE_PROVIDERS_V1') 'version'
Assert-True ([string]$config.policy.billingMode -eq 'ZERO_COST_ONLY') 'zero_cost_only'
Assert-True (-not [bool]$config.policy.paidFallback) 'paid_fallback_disabled'
Assert-True ([bool]$config.policy.failClosedOnUnknownBilling) 'unknown_billing_fail_closed'
Assert-True ([int]$config.policy.maxAttemptsPerRole -ge 1 -and [int]$config.policy.maxAttemptsPerRole -le 3) 'bounded_role_attempts'

Assert-True (-not [bool]$config.execution.coordinatorRequiresProviderCredential) 'coordinator_does_not_require_provider_credential'
Assert-True (-not [bool]$config.execution.serverProviderCallRequired) 'server_provider_call_not_required'
Assert-True (@($config.execution.allowedLocations) -contains 'pc01-local') 'pc01_local_allowed'
Assert-True (@($config.execution.allowedLocations) -contains 'pc01-server') 'pc01_server_allowed'
Assert-True (@($config.execution.allowedLocations) -contains 'employee-device') 'employee_device_allowed'
Assert-True ([string]$config.execution.employeeDeviceCredentialOwner -eq 'employee-device') 'device_owns_device_provider_credential'
Assert-True (-not [bool]$config.execution.providerSecretsInEvidence) 'provider_secrets_not_in_evidence'

Assert-True ([string]$config.scheduler.version -eq 'TIGERIQ_AI_PROVIDER_SCHEDULER_V1') 'scheduler_version'
Assert-True ([string]$config.scheduler.stateMode -eq 'file_backed_exclusive_lock') 'scheduler_file_backed_lock'
Assert-True ([string]$config.scheduler.dedupeScope -eq 'work_order_role') 'scheduler_dedupe_scope'
Assert-True ([bool]$config.scheduler.leaseRequired) 'scheduler_lease_required'
Assert-True ([int]$config.scheduler.maxAttemptsPerRole -eq [int]$config.policy.maxAttemptsPerRole) 'scheduler_attempts_match_policy'
Assert-True ([int]$config.scheduler.leaseSeconds -ge 5 -and [int]$config.scheduler.leaseSeconds -le 3600) 'scheduler_lease_bounds'
Assert-True ([int]$config.scheduler.lockWaitMs -ge 100 -and [int]$config.scheduler.lockWaitMs -le 10000) 'scheduler_lock_wait_bounds'
Assert-True (@($config.scheduler.retryableFailures) -contains 'timeout') 'scheduler_timeout_retryable'
Assert-True (@($config.scheduler.retryableFailures) -contains 'rate_limit') 'scheduler_rate_limit_retryable'
Assert-True (@($config.scheduler.retryableFailures) -contains 'outage') 'scheduler_outage_retryable'
Assert-True (@($config.scheduler.terminalFailures) -contains 'billing_unknown') 'scheduler_unknown_billing_terminal'
Assert-True (@($config.scheduler.terminalFailures) -contains 'billing_nonzero') 'scheduler_nonzero_billing_terminal'
Assert-True ([bool]$config.scheduler.staleLeaseTokenFailsClosed) 'scheduler_stale_token_fail_closed'
Assert-True ([bool]$config.scheduler.expiredLeaseRecoverable) 'scheduler_expired_lease_recoverable'
Assert-True ([bool]$config.scheduler.candidateEligibilityRequired) 'scheduler_candidate_eligibility_required'
Assert-True ([string]$config.scheduler.eligibilitySource -eq 'guarded_live_probe_READY') 'scheduler_eligibility_source'

Assert-True ([string]$config.providers.openrouter.mode -eq 'free_router_only') 'openrouter_free_mode'
Assert-True ([string]$config.providers.openrouter.model -eq 'openrouter/free') 'openrouter_free_model'
Assert-True (-not [bool]$config.providers.openrouter.allowNonFreeModels) 'openrouter_nonfree_disabled'
Assert-True (-not [bool]$config.providers.gemini_api.enabled) 'gemini_api_disabled'
Assert-True ([bool]$config.providers.gemini_cli.forbidApiKeyRoute) 'gemini_api_key_route_forbidden'
Assert-True ([bool]$config.providers.gemini_cli.forbidVertexRoute) 'gemini_vertex_route_forbidden'
Assert-True (-not [bool]$config.providers.groq.enabled) 'groq_disabled_until_zero_cost_proven'
Assert-True (-not [bool]$config.providers.claude_code.enabled) 'claude_disabled_until_no_usage_credits_proven'
Assert-True ([bool]$config.providers.claude_code.forbidApiKeyRoute) 'claude_api_route_forbidden'
Assert-True ([bool]$config.providers.claude_code.forbidCloudGatewayRoutes) 'claude_gateway_routes_forbidden'
Assert-True ([bool]$config.providers.claude_code.forbidUsageCredits) 'claude_usage_credits_forbidden'

Assert-True ([string]$config.routing.selectionMode -eq 'capability_then_zero_cost_rank') 'capability_cost_selection'
Assert-True ([bool]$config.routing.dedupeByWorkOrder) 'dedupe_required'
Assert-True ([bool]$config.routing.leaseRequired) 'lease_required'
Assert-True ([bool]$config.routing.independentReviewRequired) 'review_required'
Assert-True ([bool]$config.routing.independentJudgeRequired) 'judge_required'
Assert-True ([int]$config.routing.requiredDistinctBackendIdentities -eq 3) 'three_distinct_identities_required'
Assert-True ([string]$config.routing.fallbackOrder[0] -eq 'ollama') 'local_first_fallback'
Assert-True (-not (@($config.routing.fallbackOrder) -contains 'groq')) 'unproven_groq_not_routable'
Assert-True (-not (@($config.routing.fallbackOrder) -contains 'claude_code')) 'unproven_claude_credits_not_routable'

Assert-True ($probeText -match 'function\s+Set-SubscriptionAuthFromInvocation') 'truthful_subscription_auth_helper_exists'
Assert-True ($probeText -match 'Set-SubscriptionAuthFromInvocation\s+-Result\s+\$result\s+-ExpectedMarker\s+''TIGERIQ_GEMINI_READY''') 'gemini_uses_truthful_subscription_auth_helper'
Assert-True ($probeText -match 'function\s+Invoke-OllamaLocalProbe') 'ollama_live_probe_exists'
Assert-True ($probeText -match 'Invoke-OllamaLocalProbe\s+\$ollama\.path') 'ollama_live_probe_wired'
Assert-True ($probeText -match 'ExpectedMarker\s+''TIGERIQ_OLLAMA_READY''') 'ollama_ready_marker_required'
Assert-True ($schedulerText -match 'function\s+Invoke-SchedulerAction') 'scheduler_action_exists'
Assert-True ($schedulerText -match 'STALE_LEASE_REJECTED') 'scheduler_stale_lease_guard_exists'
Assert-True ($schedulerText -match 'ATTEMPTS_EXHAUSTED') 'scheduler_bounded_attempt_guard_exists'
Assert-True ($schedulerText -match 'billing_unknown') 'scheduler_billing_unknown_fail_closed_exists'
Assert-True ($schedulerText -match 'System\.IO\.FileShare\]::None') 'scheduler_exclusive_file_lock_exists'
Assert-True ($schedulerText -match 'EligibleBackendIdentities') 'scheduler_probe_eligibility_input_exists'
Assert-True ($schedulerText -match 'BLOCKED_NO_ELIGIBLE_BACKEND') 'scheduler_unproven_backend_fail_closed_exists'
Assert-True ($orchestratorText -match "Status 'INVOKING'") 'orchestrator_invoking_journal_exists'
Assert-True ($orchestratorText -match "Status 'COMMITTING'") 'orchestrator_committing_journal_exists'
Assert-True ($orchestratorText -match 'recovery_provider_outcome_unknown') 'orchestrator_ambiguous_outcome_fail_closed_exists'
Assert-True ($orchestratorText -match 'EVIDENCE_SCHEDULER_DIGEST_MISMATCH') 'orchestrator_evidence_scheduler_binding_exists'

$requiredRoles = @('executor', 'reviewer', 'judge')
$enabledProviders = @($config.providers.PSObject.Properties | Where-Object { [bool]$_.Value.enabled })
Assert-True ($enabledProviders.Count -ge 3) 'at_least_three_enabled_provider_candidates'
foreach ($provider in $enabledProviders) {
  $roles = @($provider.Value.role)
  foreach ($role in $requiredRoles) {
    Assert-True ($roles -contains $role) ("provider_{0}_supports_{1}" -f $provider.Name, $role)
  }
}

$serialized = $config | ConvertTo-Json -Depth 10
Assert-True (-not ($serialized -match '(?i)"paidFallback"\s*:\s*true')) 'no_paid_fallback_true'
Assert-True (-not ($serialized -match '(?i)"allowNonFreeModels"\s*:\s*true')) 'no_nonfree_openrouter_model'

[ordered]@{
  policyTest = 'PASS'
  billingMode = 'ZERO_COST_ONLY'
  requiredDistinctBackendIdentities = 3
  enabledProviderCandidates = $enabledProviders.Count
  schedulerVersion = [string]$config.scheduler.version
  schedulerDedupeScope = [string]$config.scheduler.dedupeScope
  schedulerLeaseSeconds = [int]$config.scheduler.leaseSeconds
  schedulerMaxAttemptsPerRole = [int]$config.scheduler.maxAttemptsPerRole
  schedulerCandidateEligibilityRequired = [bool]$config.scheduler.candidateEligibilityRequired
  schedulerEligibilitySource = [string]$config.scheduler.eligibilitySource
  firstFallback = [string]$config.routing.fallbackOrder[0]
  serverProviderCallRequired = [bool]$config.execution.serverProviderCallRequired
  employeeDeviceAllowed = @($config.execution.allowedLocations) -contains 'employee-device'
  employeeDeviceCredentialOwner = [string]$config.execution.employeeDeviceCredentialOwner
  groqEnabled = [bool]$config.providers.groq.enabled
  claudeEnabled = [bool]$config.providers.claude_code.enabled
  truthfulGeminiSubscriptionAuthGuard = $true
  ollamaLiveProbeGuard = $true
  crashSafeOrchestrationGuard = $true
  timestampUtc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json
