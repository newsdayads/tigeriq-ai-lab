param(
  [string]$DistRoot='D:\TigerIQ\worktrees\v2-a-529-ai-resource-core\dist',
  [string]$OllamaUrl='http://127.0.0.1:11434'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security
$secretRoot='D:\TigerIQ\Secrets'
$worker=Join-Path $PSScriptRoot 'ai-resource-worker.mjs'
function Read-FreeProof([string]$Path,[string]$Provider){
  $p=Get-Content -Raw -LiteralPath $Path|ConvertFrom-Json
  if([string]$p.provider-ne$Provider-or[string]$p.plan-ne'Free'-or[decimal]$p.priceUsd-ne0-or-not[bool]$p.ownerConfirmed-or[bool]$p.paidFallbackAllowed){throw ($Provider.ToUpperInvariant()+'_RUNTIME_BILLING_POLICY_INVALID')}
  if($Provider-eq'gemini'-and[bool]$p.billingLinked){throw 'GEMINI_RUNTIME_BILLING_LINKED_DENIED'}
  if([DateTime]::Parse([string]$p.expiresAtUtc).ToUniversalTime()-le[DateTime]::UtcNow){throw ($Provider.ToUpperInvariant()+'_RUNTIME_FREE_TIER_PROOF_EXPIRED')}
  return $p
}
function Unprotect-Key([string]$Path,[string]$Entropy){
  $cipher=[Convert]::FromBase64String([IO.File]::ReadAllText($Path).Trim())
  $bytes=[Security.Cryptography.ProtectedData]::Unprotect($cipher,[Text.Encoding]::UTF8.GetBytes($Entropy),[Security.Cryptography.DataProtectionScope]::LocalMachine)
  return [pscustomobject]@{cipher=$cipher;bytes=$bytes;key=[Text.Encoding]::UTF8.GetString($bytes)}
}
$groqProof=Read-FreeProof (Join-Path $secretRoot 'groq-free-tier-proof.json') 'groq'
$geminiProof=Read-FreeProof (Join-Path $secretRoot 'gemini-free-tier-proof.json') 'gemini'
if([string]$geminiProof.model-ne'gemini-3.5-flash-lite'){throw 'GEMINI_RUNTIME_MODEL_PROOF_INVALID'}
$groq=$null;$gemini=$null
try{
  $groq=Unprotect-Key (Join-Path $secretRoot 'groq-api-key.dpapi') 'TigerIQ-Groq-PC01-v1'
  $gemini=Unprotect-Key (Join-Path $secretRoot 'gemini-api-key.dpapi') 'TigerIQ-Gemini-PC01-v1'
  if([string]::IsNullOrWhiteSpace($groq.key)-or-not$groq.key.StartsWith('gsk_')){throw 'GROQ_RUNTIME_SECRET_DECRYPT_INVALID'}
  if([string]::IsNullOrWhiteSpace($gemini.key)-or$gemini.key.Length-lt30-or$gemini.key-match'\s'){throw 'GEMINI_RUNTIME_SECRET_DECRYPT_INVALID'}
  [Environment]::SetEnvironmentVariable('GROQ_API_KEY',$groq.key,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_GROQ_FREE_TIER_VERIFIED','true','Process')
  [Environment]::SetEnvironmentVariable('GEMINI_API_KEY',$gemini.key,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_GEMINI_FREE_TIER_VERIFIED','true','Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_AI_DIST_ROOT',$DistRoot,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_OLLAMA_URL',$OllamaUrl,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_WORKSPACE','D:\TigerIQ\Workspace\tigeriq-ai-lab','Process')
  & 'C:\Program Files\nodejs\node.exe' $worker
  if($LASTEXITCODE-ne0){throw "AI_RESOURCE_WORKER_EXIT_$LASTEXITCODE"}
}finally{
  foreach($name in @('GROQ_API_KEY','TIGERIQ_GROQ_FREE_TIER_VERIFIED','GEMINI_API_KEY','TIGERIQ_GEMINI_FREE_TIER_VERIFIED','TIGERIQ_AI_DIST_ROOT','TIGERIQ_OLLAMA_URL')){[Environment]::SetEnvironmentVariable($name,$null,'Process')}
  foreach($secret in @($groq,$gemini)){
    if($null-ne$secret){
      if($null-ne$secret.bytes){[Array]::Clear($secret.bytes,0,$secret.bytes.Length)}
      if($null-ne$secret.cipher){[Array]::Clear($secret.cipher,0,$secret.cipher.Length)}
      $secret.key=$null
    }
  }
  $groq=$null;$gemini=$null
}
