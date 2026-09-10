param(
  [string]$DistRoot='D:\TigerIQ\worktrees\v2-a-529-ai-resource-core\dist',
  [string]$Log='D:\TigerIQ\Logs\ai-resource-failover-probe-529.log'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security
$secretRoot='D:\TigerIQ\Secrets'
function Read-FreeProof([string]$Path,[string]$Provider){
  $p=Get-Content -Raw -LiteralPath $Path|ConvertFrom-Json
  if([string]$p.provider-ne$Provider-or[string]$p.plan-ne'Free'-or[decimal]$p.priceUsd-ne0-or-not[bool]$p.ownerConfirmed-or[bool]$p.paidFallbackAllowed){throw ($Provider.ToUpperInvariant()+'_RUNTIME_BILLING_POLICY_INVALID')}
  if($Provider-eq'gemini'-and[bool]$p.billingLinked){throw 'GEMINI_RUNTIME_BILLING_LINKED_DENIED'}
  if([DateTime]::Parse([string]$p.expiresAtUtc).ToUniversalTime()-le[DateTime]::UtcNow){throw ($Provider.ToUpperInvariant()+'_RUNTIME_FREE_TIER_PROOF_EXPIRED')}
}
function Unprotect-Key([string]$Path,[string]$Entropy){
  $cipher=[Convert]::FromBase64String([IO.File]::ReadAllText($Path).Trim())
  $bytes=[Security.Cryptography.ProtectedData]::Unprotect($cipher,[Text.Encoding]::UTF8.GetBytes($Entropy),[Security.Cryptography.DataProtectionScope]::LocalMachine)
  [pscustomobject]@{cipher=$cipher;bytes=$bytes;key=[Text.Encoding]::UTF8.GetString($bytes)}
}
Read-FreeProof (Join-Path $secretRoot 'groq-free-tier-proof.json') 'groq'
Read-FreeProof (Join-Path $secretRoot 'gemini-free-tier-proof.json') 'gemini'
$groq=$null
try{
  $groq=Unprotect-Key (Join-Path $secretRoot 'groq-api-key.dpapi') 'TigerIQ-Groq-PC01-v1'
  if([string]::IsNullOrWhiteSpace($groq.key)-or-not$groq.key.StartsWith('gsk_')){throw 'GROQ_RUNTIME_SECRET_DECRYPT_INVALID'}
  $env:GROQ_API_KEY=$groq.key
  $env:TIGERIQ_GROQ_FREE_TIER_VERIFIED='true'
  $env:GEMINI_API_KEY='tigeriq-intentional-invalid-key-for-failover-probe'
  $env:TIGERIQ_GEMINI_FREE_TIER_VERIFIED='true'
  $env:TIGERIQ_AI_DIST_ROOT=$DistRoot
  $env:TIGERIQ_WORKSPACE='D:\TigerIQ\Workspace\tigeriq-ai-lab'
  $env:TIGERIQ_OLLAMA_URL='http://127.0.0.1:11434'
  $worker=Join-Path $PSScriptRoot 'ai-resource-worker.mjs'
  $p=Start-Process 'C:\Program Files\nodejs\node.exe' -ArgumentList @($worker) -WindowStyle Hidden -RedirectStandardOutput $Log -RedirectStandardError ($Log+'.err') -PassThru
  [pscustomobject]@{probePid=$p.Id;injectedFailure='gemini_auth';paidFallback=$false}|ConvertTo-Json -Compress
} finally {
  foreach($name in @('GROQ_API_KEY','TIGERIQ_GROQ_FREE_TIER_VERIFIED','GEMINI_API_KEY','TIGERIQ_GEMINI_FREE_TIER_VERIFIED','TIGERIQ_AI_DIST_ROOT','TIGERIQ_WORKSPACE','TIGERIQ_OLLAMA_URL')){Remove-Item "Env:$name" -ErrorAction SilentlyContinue}
  if($null-ne$groq){if($null-ne$groq.bytes){[Array]::Clear($groq.bytes,0,$groq.bytes.Length)};if($null-ne$groq.cipher){[Array]::Clear($groq.cipher,0,$groq.cipher.Length)};$groq.key=$null}
}
