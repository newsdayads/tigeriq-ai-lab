param(
  [switch]$SelfTest,
  [switch]$Live,
  [string]$WorkOrderId = '',
  [string]$StatePath = '',
  [string]$EvidencePath = '',
  [int]$TimeoutSeconds = 60
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if (($SelfTest -and $Live) -or (-not $SelfTest -and -not $Live)) { throw 'AI_JOB001_TRI_SELECT_EXACTLY_ONE_MODE' }
if ($TimeoutSeconds -lt 5 -or $TimeoutSeconds -gt 180) { throw 'AI_JOB001_TRI_TIMEOUT_OUT_OF_RANGE' }
$orchestratorPath=Join-Path $PSScriptRoot 'ai-job-orchestrator.ps1'
$requestedWorkOrderId=$WorkOrderId
$requestedStatePath=$StatePath
$requestedEvidencePath=$EvidencePath
if (-not (Test-Path -LiteralPath $orchestratorPath)) { throw 'AI_JOB001_TRI_ORCHESTRATOR_MISSING' }
. $orchestratorPath
$WorkOrderId=$requestedWorkOrderId
$StatePath=$requestedStatePath
$EvidencePath=$requestedEvidencePath

$script:GroqIdentity='groq:openai.gpt-oss-120b'
$script:GeminiIdentity='gemini:gemini-3.5-flash-lite'
$script:OllamaExecutor='ollama:qwen3:4b'
$script:OllamaReviewer='ollama:gemma3:4b'
$script:OllamaJudge='ollama:qwen3:8b'

function New-ProviderOutcome([bool]$Ok,[string]$Output,[string]$FailureClass){
  [pscustomobject]@{ok=$Ok;output=$Output;failureClass=$FailureClass}
}
function Get-CandidateMap {
  @{
    executor=@($script:GroqIdentity,$script:OllamaExecutor,$script:OllamaJudge)
    reviewer=@($script:GeminiIdentity,$script:OllamaReviewer,$script:GroqIdentity)
    judge=@($script:OllamaJudge,$script:GroqIdentity,$script:OllamaExecutor)
  }
}
function Get-EligibleIdentities {
  @($script:GroqIdentity,$script:GeminiIdentity,$script:OllamaExecutor,$script:OllamaReviewer,$script:OllamaJudge)
}
function Invoke-OllamaMarker([string]$Backend,[string]$Marker){
  $model=$Backend.Substring('ollama:'.Length)
  try {
    $body=@{model=$model;prompt=("Return exactly {0} and nothing else." -f $Marker);stream=$false;options=@{temperature=0}}|ConvertTo-Json -Depth 5
    $response=Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:11434/api/generate' -ContentType 'application/json' -Body $body -TimeoutSec $TimeoutSeconds
    $text=[string]$response.response
    if($text-notmatch[regex]::Escape($Marker)){return New-ProviderOutcome $false '' 'invalid_response'}
    return New-ProviderOutcome $true $text ''
  } catch { return New-ProviderOutcome $false '' 'outage' }
}
function Invoke-GroqMarker([string]$Marker){
  $proof=[Environment]::GetEnvironmentVariable('TIGERIQ_GROQ_FREE_TIER_VERIFIED','Process')
  if([string]::IsNullOrWhiteSpace($proof)-or$proof.Trim().ToLowerInvariant()-ne'true'){return New-ProviderOutcome $false '' 'billing_unknown'}
  $key=[Environment]::GetEnvironmentVariable('GROQ_API_KEY','Process')
  if([string]::IsNullOrWhiteSpace($key)){return New-ProviderOutcome $false '' 'config'}
  try {
    $headers=@{Authorization=('Bearer '+$key);'Content-Type'='application/json'}
    $payload=@{model='openai/gpt-oss-120b';service_tier='on_demand';messages=@(@{role='user';content=("Return exactly {0} and nothing else." -f $Marker)});stream=$false;reasoning_effort='low';max_completion_tokens=256}|ConvertTo-Json -Depth 6
    $job=Start-Job -ScriptBlock {
      param($h,$b,$timeout)
      try {$r=Invoke-RestMethod -Method Post -Uri 'https://api.groq.com/openai/v1/chat/completions' -Headers $h -Body $b -TimeoutSec $timeout; [pscustomobject]@{ok=$true;json=($r|ConvertTo-Json -Depth 8);status=200}}
      catch {$status=0;try{$status=[int]$_.Exception.Response.StatusCode.value__}catch{};[pscustomobject]@{ok=$false;json='';status=$status}}
    } -ArgumentList $headers,$payload,$TimeoutSeconds
    if(-not(Wait-Job $job -Timeout $TimeoutSeconds)){Stop-Job $job -ErrorAction SilentlyContinue;Remove-Job $job -Force -ErrorAction SilentlyContinue;return New-ProviderOutcome $false '' 'timeout'}
    $result=Receive-Job $job -ErrorAction SilentlyContinue|Select-Object -Last 1
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    if($null-eq$result-or-not[bool]$result.ok){$status=if($null-eq$result){0}else{[int]$result.status};if($status-eq429){return New-ProviderOutcome $false '' 'rate_limit'};if($status-eq401-or$status-eq403){return New-ProviderOutcome $false '' 'auth'};if($status-ge500){return New-ProviderOutcome $false '' 'outage'};return New-ProviderOutcome $false '' 'invalid_response'}
    $json=[string]$result.json|ConvertFrom-Json
    $text=[string]$json.choices[0].message.content
    if([string]$json.model-ne'openai/gpt-oss-120b'-or$text-notmatch[regex]::Escape($Marker)){return New-ProviderOutcome $false '' 'invalid_response'}
    return New-ProviderOutcome $true $text ''
  } catch { return New-ProviderOutcome $false '' 'outage' }
}
function Invoke-GeminiMarker([string]$Marker){
  $proof=[Environment]::GetEnvironmentVariable('TIGERIQ_GEMINI_FREE_TIER_VERIFIED','Process')
  if([string]::IsNullOrWhiteSpace($proof)-or$proof.Trim().ToLowerInvariant()-ne'true'){return New-ProviderOutcome $false '' 'billing_unknown'}
  $key=[Environment]::GetEnvironmentVariable('GEMINI_API_KEY','Process')
  if([string]::IsNullOrWhiteSpace($key)){return New-ProviderOutcome $false '' 'config'}
  try {
    $headers=@{'x-goog-api-key'=$key;'Content-Type'='application/json'}
    $payload=@{contents=@(@{role='user';parts=@(@{text=("Return exactly {0} and nothing else." -f $Marker)})});generationConfig=@{maxOutputTokens=256;temperature=0}}|ConvertTo-Json -Depth 7
    $job=Start-Job -ScriptBlock {
      param($h,$b,$timeout)
      try {$r=Invoke-RestMethod -Method Post -Uri 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent' -Headers $h -Body $b -TimeoutSec $timeout; [pscustomobject]@{ok=$true;json=($r|ConvertTo-Json -Depth 10);status=200}}
      catch {$status=0;try{$status=[int]$_.Exception.Response.StatusCode.value__}catch{};[pscustomobject]@{ok=$false;json='';status=$status}}
    } -ArgumentList $headers,$payload,$TimeoutSeconds
    if(-not(Wait-Job $job -Timeout $TimeoutSeconds)){Stop-Job $job -ErrorAction SilentlyContinue;Remove-Job $job -Force -ErrorAction SilentlyContinue;return New-ProviderOutcome $false '' 'timeout'}
    $result=Receive-Job $job -ErrorAction SilentlyContinue|Select-Object -Last 1
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    if($null-eq$result-or-not[bool]$result.ok){$status=if($null-eq$result){0}else{[int]$result.status};if($status-eq429){return New-ProviderOutcome $false '' 'rate_limit'};if($status-eq401-or$status-eq403){return New-ProviderOutcome $false '' 'auth'};if($status-ge500){return New-ProviderOutcome $false '' 'outage'};return New-ProviderOutcome $false '' 'invalid_response'}
    $json=[string]$result.json|ConvertFrom-Json
    $text=($json.candidates[0].content.parts|ForEach-Object{[string]$_.text})-join[Environment]::NewLine
    if($text-notmatch[regex]::Escape($Marker)){return New-ProviderOutcome $false '' 'invalid_response'}
    return New-ProviderOutcome $true $text ''
  } catch { return New-ProviderOutcome $false '' 'outage' }
}
function Assert-TriProvider([object]$Result,[bool]$RequirePrimary){
  if([string]$Result.status-ne'COMPLETED'){throw 'AI_JOB001_TRI_NOT_COMPLETED'}
  $completed=@($Result.stages|Where-Object{$_.status-eq'COMPLETED'})
  $distinct=@($completed|ForEach-Object{[string]$_.backendIdentity}|Sort-Object -Unique)
  if($distinct.Count-ne3){throw 'AI_JOB001_TRI_DISTINCT_BACKEND_FAILED'}
  if($RequirePrimary){
    $executor=@($completed|Where-Object{$_.role-eq'executor'})[0]
    $reviewer=@($completed|Where-Object{$_.role-eq'reviewer'})[0]
    $judge=@($completed|Where-Object{$_.role-eq'judge'})[0]
    if([string]$executor.backendIdentity-ne$script:GroqIdentity){throw 'AI_JOB001_TRI_EXECUTOR_NOT_GROQ'}
    if([string]$reviewer.backendIdentity-ne$script:GeminiIdentity){throw 'AI_JOB001_TRI_REVIEWER_NOT_GEMINI'}
    if([string]$judge.backendIdentity-notlike'ollama:*'){throw 'AI_JOB001_TRI_JUDGE_NOT_OLLAMA'}
  }
  return $true
}
function Get-StableEvidenceHash([string]$Path){
  if(-not(Test-Path -LiteralPath $Path)){throw 'AI_JOB001_TRI_EVIDENCE_MISSING'}
  $e=Get-Content -Raw -LiteralPath $Path|ConvertFrom-Json
  $stable=[pscustomobject]@{version=$e.version;workOrderId=$e.workOrderId;status=$e.status;stages=@($e.stages)}|ConvertTo-Json -Depth 10 -Compress
  Get-TextSha256 $stable
}
function Get-RawEvidenceHash([string]$Path){
  (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

if($SelfTest){
  $root=Join-Path ([IO.Path]::GetTempPath()) ('tigeriq-tri-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $root -Force|Out-Null
  try{
    $state=Join-Path $root 'state.json';$evidence=Join-Path $root 'evidence.json'
    $invoker={param($role,$backend,$attempt);New-ProviderOutcome $true ("SELF::{0}::{1}::{2}" -f $role,$backend,$attempt) ''}
    $result=Invoke-AiJobOrchestration -StatePath $state -EvidencePath $evidence -WorkOrderId 'JOB-001-TRI-SELF' -CandidatesByRole (Get-CandidateMap) -EligibleBackendIdentities (Get-EligibleIdentities) -ProviderInvoker $invoker -MaxAttempts 3 -LeaseSeconds 30
    $null=Assert-TriProvider $result $true
    $before=Get-StableEvidenceHash $evidence
    $script:UnexpectedResumeCall=$false
    $noCall={param($role,$backend,$attempt);$script:UnexpectedResumeCall=$true;New-ProviderOutcome $false '' 'config'}
    $resumed=Invoke-AiJobOrchestration -StatePath $state -EvidencePath $evidence -WorkOrderId 'JOB-001-TRI-SELF' -CandidatesByRole (Get-CandidateMap) -EligibleBackendIdentities (Get-EligibleIdentities) -ProviderInvoker $noCall -MaxAttempts 3 -LeaseSeconds 30
    $after=Get-StableEvidenceHash $evidence
    if($script:UnexpectedResumeCall-or$before-ne$after-or[string]$resumed.status-ne'COMPLETED'){throw 'AI_JOB001_TRI_RESUME_NO_CALL_FAILED'}
    $fallbackState=Join-Path $root 'fallback-state.json';$fallbackEvidence=Join-Path $root 'fallback-evidence.json'
    $fallbackInvoker={param($role,$backend,$attempt);if($role-eq'judge'-and$backend-eq$script:OllamaJudge){return New-ProviderOutcome $false '' 'timeout'};New-ProviderOutcome $true ("SELF-FALLBACK::{0}::{1}::{2}" -f $role,$backend,$attempt) ''}
    $fallback=Invoke-AiJobOrchestration -StatePath $fallbackState -EvidencePath $fallbackEvidence -WorkOrderId 'JOB-001-TRI-FALLBACK' -CandidatesByRole (Get-CandidateMap) -EligibleBackendIdentities (Get-EligibleIdentities) -ProviderInvoker $fallbackInvoker -MaxAttempts 3 -LeaseSeconds 30
    $null=Assert-TriProvider $fallback $true
    $fallbackJudge=@($fallback.stages|Where-Object{$_.role-eq'judge'})[0]
    if([int]$fallbackJudge.attempts-ne2-or[string]$fallbackJudge.backendIdentity-ne$script:OllamaExecutor){throw 'AI_JOB001_TRI_JUDGE_FALLBACK_FAILED'}
    [pscustomobject]@{selfTest='PASS';primaryTriProvider=$true;resumeNoProviderCall=$true;judgeFallback=$true;stableEvidenceHash=$after;rawProviderOutputPersisted=$false}|ConvertTo-Json
  }finally{Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue}
  exit 0
}

if([string]::IsNullOrWhiteSpace($WorkOrderId)){$WorkOrderId='JOB-001-TRI-'+([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))}
$groqProof=[Environment]::GetEnvironmentVariable('TIGERIQ_GROQ_FREE_TIER_VERIFIED','Process')
$geminiProof=[Environment]::GetEnvironmentVariable('TIGERIQ_GEMINI_FREE_TIER_VERIFIED','Process')
$groqKey=[Environment]::GetEnvironmentVariable('GROQ_API_KEY','Process')
$geminiKey=[Environment]::GetEnvironmentVariable('GEMINI_API_KEY','Process')
$ready=(-not[string]::IsNullOrWhiteSpace($groqProof))-and$groqProof.Trim().ToLowerInvariant()-eq'true'-and(-not[string]::IsNullOrWhiteSpace($geminiProof))-and$geminiProof.Trim().ToLowerInvariant()-eq'true'-and(-not[string]::IsNullOrWhiteSpace($groqKey))-and(-not[string]::IsNullOrWhiteSpace($geminiKey))
if(-not$ready){[pscustomobject]@{status='BLOCKED';reason='GROQ_OR_GEMINI_KEY_OR_FREE_TIER_PROOF_MISSING';workOrderId=$WorkOrderId;networkCallMade=$false}|ConvertTo-Json;exit 2}
if([string]::IsNullOrWhiteSpace($StatePath)){$StatePath=Join-Path 'D:\TigerIQ\Temp' ($WorkOrderId+'-scheduler.json')}
if([string]::IsNullOrWhiteSpace($EvidencePath)){$EvidencePath=Join-Path 'D:\TigerIQ\Evidence\AI-API' ($WorkOrderId+'-evidence.json')}

$providerInvoker={
  param($role,$backend,$attempt)
  $marker='TIGERIQ_JOB001_'+$role.ToUpperInvariant()+'_PASS'
  if($backend-eq$script:GroqIdentity){return Invoke-GroqMarker $marker}
  if($backend-eq$script:GeminiIdentity){return Invoke-GeminiMarker $marker}
  if($backend-like'ollama:*'){return Invoke-OllamaMarker $backend $marker}
  return New-ProviderOutcome $false '' 'config'
}
$result=Invoke-AiJobOrchestration -StatePath $StatePath -EvidencePath $EvidencePath -WorkOrderId $WorkOrderId -CandidatesByRole (Get-CandidateMap) -EligibleBackendIdentities (Get-EligibleIdentities) -ProviderInvoker $providerInvoker -MaxAttempts 3 -LeaseSeconds 120
$null=Assert-TriProvider $result $true
$before=Get-StableEvidenceHash $EvidencePath
$script:UnexpectedResumeCall=$false
$noCall={param($role,$backend,$attempt);$script:UnexpectedResumeCall=$true;New-ProviderOutcome $false '' 'config'}
$resumed=Invoke-AiJobOrchestration -StatePath $StatePath -EvidencePath $EvidencePath -WorkOrderId $WorkOrderId -CandidatesByRole (Get-CandidateMap) -EligibleBackendIdentities (Get-EligibleIdentities) -ProviderInvoker $noCall -MaxAttempts 3 -LeaseSeconds 120
$after=Get-StableEvidenceHash $EvidencePath
if($script:UnexpectedResumeCall-or$before-ne$after-or[string]$resumed.status-ne'COMPLETED'){throw 'AI_JOB001_TRI_LIVE_RESUME_NO_CALL_FAILED'}
[pscustomobject]@{
  status='PASS'
  workOrderId=$WorkOrderId
  triProvider=$true
  path='groq_executor__gemini_reviewer__ollama_judge'
  resumeNoProviderCall=$true
  stableEvidenceHash=$after
  evidenceSha256=(Get-RawEvidenceHash $EvidencePath)
  evidencePath=$EvidencePath
  stages=$result.stages
}|ConvertTo-Json -Depth 8
