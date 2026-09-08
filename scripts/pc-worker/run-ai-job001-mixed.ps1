param(
  [switch]$SelfTest,
  [switch]$Live,
  [string]$WorkOrderId = '',
  [string]$StatePath = '',
  [string]$EvidencePath = '',
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (($SelfTest -and $Live) -or (-not $SelfTest -and -not $Live)) {
  throw 'AI_JOB001_MIXED_SELECT_EXACTLY_ONE_MODE'
}
if ($TimeoutSeconds -lt 5 -or $TimeoutSeconds -gt 180) {
  throw 'AI_JOB001_MIXED_TIMEOUT_OUT_OF_RANGE'
}

$orchestratorPath = Join-Path $PSScriptRoot 'ai-job-orchestrator.ps1'
if (-not (Test-Path -LiteralPath $orchestratorPath)) { throw 'AI_JOB001_MIXED_ORCHESTRATOR_MISSING' }
. $orchestratorPath

$script:GroqIdentity = 'groq:openai.gpt-oss-120b'
$script:OllamaExecutor = 'ollama:qwen3:4b'
$script:OllamaReviewer = 'ollama:gemma3:4b'
$script:OllamaJudge = 'ollama:qwen3:8b'
function New-ProviderOutcome([bool]$Ok,[string]$Output,[string]$FailureClass) {
  return [pscustomobject]@{ ok=$Ok; output=$Output; failureClass=$FailureClass }
}

function Get-CandidateMap {
  return @{
    executor=@($script:GroqIdentity,$script:OllamaExecutor,$script:OllamaJudge)
    reviewer=@($script:OllamaReviewer,$script:GroqIdentity,$script:OllamaJudge)
    judge=@($script:OllamaJudge,$script:GroqIdentity,$script:OllamaExecutor)
  }
}

function Get-EligibleIdentities {
  return @($script:GroqIdentity,$script:OllamaExecutor,$script:OllamaReviewer,$script:OllamaJudge)
}

function Invoke-OllamaMarker([string]$Backend,[string]$Marker) {
  $model = $Backend.Substring('ollama:'.Length)
  try {
    $body = @{model=$model;prompt=("Return exactly {0} and nothing else." -f $Marker);stream=$false;options=@{temperature=0}} | ConvertTo-Json -Depth 5
    $response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:11434/api/generate' -ContentType 'application/json' -Body $body -TimeoutSec $TimeoutSeconds
    $text = [string]$response.response
    if ($text -notmatch [regex]::Escape($Marker)) { return New-ProviderOutcome $false '' 'invalid_response' }
    return New-ProviderOutcome $true $text ''
  } catch { return New-ProviderOutcome $false '' 'outage' }
}
function Invoke-GroqMarker([string]$Marker) {
  $proof = [Environment]::GetEnvironmentVariable('TIGERIQ_GROQ_FREE_TIER_VERIFIED','Process')
  if ([string]::IsNullOrWhiteSpace($proof) -or $proof.Trim().ToLowerInvariant() -ne 'true') {
    return New-ProviderOutcome $false '' 'billing_unknown'
  }
  $key = [Environment]::GetEnvironmentVariable('GROQ_API_KEY','Process')
  if ([string]::IsNullOrWhiteSpace($key)) { return New-ProviderOutcome $false '' 'config' }
  try {
    $headers = @{ Authorization=('Bearer '+$key); 'Content-Type'='application/json' }
    $payload = @{model='openai/gpt-oss-120b';service_tier='on_demand';messages=@(@{role='user';content=("Return exactly {0} and nothing else." -f $Marker)});stream=$false;reasoning_effort='low';max_completion_tokens=256} | ConvertTo-Json -Depth 6
    $job = Start-Job -ScriptBlock {
      param($h,$b,$timeout)
      try {
        $r=Invoke-RestMethod -Method Post -Uri 'https://api.groq.com/openai/v1/chat/completions' -Headers $h -Body $b -TimeoutSec $timeout
        [pscustomobject]@{ok=$true;json=($r|ConvertTo-Json -Depth 8);status=200}
      } catch {
        $status=$null
        try { $status=[int]$_.Exception.Response.StatusCode.value__ } catch {}
        [pscustomobject]@{ok=$false;json='';status=$status}
      }
    } -ArgumentList $headers,$payload,$TimeoutSeconds
    if (-not (Wait-Job $job -Timeout $TimeoutSeconds)) {
      Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue
      return New-ProviderOutcome $false '' 'timeout'
    }
    $result = Receive-Job $job -ErrorAction SilentlyContinue | Select-Object -Last 1
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    if ($null -eq $result -or -not [bool]$result.ok) {
      $status = if ($null -eq $result) { 0 } else { [int]$result.status }
      if ($status -eq 429) { return New-ProviderOutcome $false '' 'rate_limit' }
      if ($status -eq 401 -or $status -eq 403) { return New-ProviderOutcome $false '' 'auth' }
      if ($status -ge 500) { return New-ProviderOutcome $false '' 'outage' }
      return New-ProviderOutcome $false '' 'invalid_response'
    }
    $json = [string]$result.json | ConvertFrom-Json
    if ([string]$json.model -ne 'openai/gpt-oss-120b') { return New-ProviderOutcome $false '' 'invalid_response' }
    $text = [string]$json.choices[0].message.content
    if ($text -notmatch [regex]::Escape($Marker)) { return New-ProviderOutcome $false '' 'invalid_response' }
    return New-ProviderOutcome $true $text ''
  } catch { return New-ProviderOutcome $false '' 'outage' }
}

function Assert-Mixed([object]$Result,[bool]$RequireCloud) {
  if ([string]$Result.status -ne 'COMPLETED') { throw 'AI_JOB001_MIXED_NOT_COMPLETED' }
  $completed=@($Result.stages | Where-Object { $_.status -eq 'COMPLETED' })
  $distinct=@($completed | ForEach-Object { [string]$_.backendIdentity } | Sort-Object -Unique)
  if ($distinct.Count -ne 3) { throw 'AI_JOB001_MIXED_DISTINCT_BACKEND_FAILED' }
  $cloudUsed=@($completed | Where-Object { [string]$_.backendIdentity -eq $script:GroqIdentity }).Count -gt 0
  if ($RequireCloud -and -not $cloudUsed) { throw 'AI_JOB001_MIXED_CLOUD_NOT_USED' }
  return $cloudUsed
}
if ($SelfTest) {
  function Invoke-SelfCase([string]$Name,[bool]$GroqSucceeds) {
    $root=Join-Path ([IO.Path]::GetTempPath()) ("tigeriq-mixed-{0}" -f [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    try {
      $script:SelfGroqSucceeds=$GroqSucceeds
      $invoker={
        param($role,$backend,$attempt)
        if ($backend -eq $script:GroqIdentity -and -not $script:SelfGroqSucceeds) {
          return New-ProviderOutcome $false '' 'timeout'
        }
        return New-ProviderOutcome $true ("SELF::{0}::{1}::{2}" -f $role,$backend,$attempt) ''
      }
      $result=Invoke-AiJobOrchestration -StatePath (Join-Path $root 'state.json') -EvidencePath (Join-Path $root 'evidence.json') -WorkOrderId ("JOB-001-{0}" -f $Name) -CandidatesByRole (Get-CandidateMap) -EligibleBackendIdentities (Get-EligibleIdentities) -ProviderInvoker $invoker -MaxAttempts 3 -LeaseSeconds 30
      $cloudUsed=Assert-Mixed $result $GroqSucceeds
      $executor=@($result.stages | Where-Object { $_.role -eq 'executor' })[0]
      if (-not $GroqSucceeds -and ([int]$executor.attempts -ne 2 -or [string]$executor.backendIdentity -ne $script:OllamaExecutor)) {
        throw 'AI_JOB001_MIXED_FAILOVER_ASSERTION_FAILED'
      }
      return [pscustomobject]@{name=$Name;status='PASS';cloudUsed=$cloudUsed;executorBackend=[string]$executor.backendIdentity;executorAttempts=[int]$executor.attempts}
    } finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
  }
  $success=Invoke-SelfCase 'MIXED-SUCCESS' $true
  $failover=Invoke-SelfCase 'GROQ-TIMEOUT-FALLBACK' $false
  [pscustomobject]@{selfTest='PASS';mixed=$success;groqFailover=$failover;rawProviderOutputPersisted=$false} | ConvertTo-Json -Depth 6
  exit 0
}
if ([string]::IsNullOrWhiteSpace($WorkOrderId)) {
  $WorkOrderId='JOB-001-MIXED-'+([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
}
$proof=[Environment]::GetEnvironmentVariable('TIGERIQ_GROQ_FREE_TIER_VERIFIED','Process')
$key=[Environment]::GetEnvironmentVariable('GROQ_API_KEY','Process')
if ([string]::IsNullOrWhiteSpace($proof) -or $proof.Trim().ToLowerInvariant() -ne 'true' -or [string]::IsNullOrWhiteSpace($key)) {
  [pscustomobject]@{status='BLOCKED';reason='GROQ_KEY_OR_FREE_TIER_PROOF_MISSING';workOrderId=$WorkOrderId;networkCallMade=$false} | ConvertTo-Json
  exit 2
}
if ([string]::IsNullOrWhiteSpace($StatePath)) { $StatePath=Join-Path 'D:\TigerIQ\Temp' ($WorkOrderId+'-scheduler.json') }
if ([string]::IsNullOrWhiteSpace($EvidencePath)) { $EvidencePath=Join-Path 'D:\TigerIQ\Evidence\AI-API' ($WorkOrderId+'-evidence.json') }

$providerInvoker={
  param($role,$backend,$attempt)
  $marker='TIGERIQ_JOB001_'+$role.ToUpperInvariant()+'_PASS'
  if ($backend -eq $script:GroqIdentity) { return Invoke-GroqMarker $marker }
  if ($backend -like 'ollama:*') { return Invoke-OllamaMarker $backend $marker }
  return New-ProviderOutcome $false '' 'config'
}

$result=Invoke-AiJobOrchestration -StatePath $StatePath -EvidencePath $EvidencePath -WorkOrderId $WorkOrderId -CandidatesByRole (Get-CandidateMap) -EligibleBackendIdentities (Get-EligibleIdentities) -ProviderInvoker $providerInvoker -MaxAttempts 3 -LeaseSeconds 120
$cloudUsed=Assert-Mixed $result $true
[pscustomobject]@{status='PASS';workOrderId=$WorkOrderId;mixedCloudLocal=$cloudUsed;evidencePath=$EvidencePath;stages=$result.stages} | ConvertTo-Json -Depth 8
