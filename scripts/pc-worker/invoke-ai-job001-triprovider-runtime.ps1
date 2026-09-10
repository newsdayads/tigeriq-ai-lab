param(
  [string]$WorkOrderId='',
  [string]$StatePath='',
  [string]$EvidencePath='',
  [int]$TimeoutSeconds=60
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security
$secretRoot='D:\TigerIQ\Secrets'
$harness=Join-Path $PSScriptRoot 'run-ai-job001-triprovider.ps1'
if(-not(Test-Path -LiteralPath $harness)){throw 'AI_JOB001_TRI_RUNTIME_HARNESS_MISSING'}
function Read-FreeProof([string]$Path,[string]$Provider){
  if(-not(Test-Path -LiteralPath $Path)){throw ($Provider.ToUpperInvariant()+'_RUNTIME_FREE_TIER_PROOF_MISSING')}
  $p=Get-Content -Raw -LiteralPath $Path|ConvertFrom-Json
  if([string]$p.provider-ne$Provider-or[string]$p.plan-ne'Free'-or[decimal]$p.priceUsd-ne0-or-not[bool]$p.ownerConfirmed-or[bool]$p.paidFallbackAllowed){throw ($Provider.ToUpperInvariant()+'_RUNTIME_BILLING_POLICY_INVALID')}
  if($Provider-eq'gemini'-and[bool]$p.billingLinked){throw 'GEMINI_RUNTIME_BILLING_LINKED_DENIED'}
  if([DateTime]::Parse([string]$p.expiresAtUtc).ToUniversalTime()-le[DateTime]::UtcNow){throw ($Provider.ToUpperInvariant()+'_RUNTIME_FREE_TIER_PROOF_EXPIRED')}
  return $p
}
function Unprotect-Key([string]$Path,[string]$Entropy){
  if(-not(Test-Path -LiteralPath $Path)){throw 'RUNTIME_SECRET_MISSING'}
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
  $invokeArgs=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$harness,'-Live','-TimeoutSeconds',[string]$TimeoutSeconds)
  if(-not[string]::IsNullOrWhiteSpace($WorkOrderId)){$invokeArgs+=@('-WorkOrderId',$WorkOrderId)}
  if(-not[string]::IsNullOrWhiteSpace($StatePath)){$invokeArgs+=@('-StatePath',$StatePath)}
  if(-not[string]::IsNullOrWhiteSpace($EvidencePath)){$invokeArgs+=@('-EvidencePath',$EvidencePath)}
  & powershell @invokeArgs
  $code=$LASTEXITCODE
  if($code-ne0){throw "AI_JOB001_TRI_RUNTIME_FAILED_EXIT_$code"}
}finally{
  [Environment]::SetEnvironmentVariable('GROQ_API_KEY',$null,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_GROQ_FREE_TIER_VERIFIED',$null,'Process')
  [Environment]::SetEnvironmentVariable('GEMINI_API_KEY',$null,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_GEMINI_FREE_TIER_VERIFIED',$null,'Process')
  foreach($secret in @($groq,$gemini)){
    if($null-ne$secret){
      if($null-ne$secret.bytes){[Array]::Clear($secret.bytes,0,$secret.bytes.Length)}
      if($null-ne$secret.cipher){[Array]::Clear($secret.cipher,0,$secret.cipher.Length)}
      $secret.key=$null
    }
  }
  $groq=$null;$gemini=$null
}