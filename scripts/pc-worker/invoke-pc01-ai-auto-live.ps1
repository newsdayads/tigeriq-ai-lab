param(
  [string]$RepoRoot = '',
  [string]$DistRoot = '',
  [switch]$RequireGemini
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security
if([string]::IsNullOrWhiteSpace($RepoRoot)){$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path}
if([string]::IsNullOrWhiteSpace($DistRoot)){$DistRoot=Join-Path $RepoRoot 'dist'}
$secretRoot='D:\TigerIQ\Secrets'
$groqSecret=Join-Path $secretRoot 'groq-api-key.dpapi'
$groqProof=Join-Path $secretRoot 'groq-free-tier-proof.json'
$geminiSecret=Join-Path $secretRoot 'gemini-api-key.dpapi'
$geminiProof=Join-Path $secretRoot 'gemini-free-tier-proof.json'
$testPath=Join-Path $RepoRoot 'scripts\pc-worker\test-pc01-ai-auto-e2e.mjs'
function Read-FreeProof([string]$Path,[string]$Provider){
  if(-not(Test-Path -LiteralPath $Path)){throw ($Provider.ToUpperInvariant()+'_RUNTIME_FREE_TIER_PROOF_MISSING')}
  $p=Get-Content -Raw -LiteralPath $Path|ConvertFrom-Json
  if([string]$p.provider-ne$Provider-or[string]$p.plan-ne'Free'-or[decimal]$p.priceUsd-ne 0-or-not[bool]$p.ownerConfirmed-or[bool]$p.paidFallbackAllowed){throw ($Provider.ToUpperInvariant()+'_RUNTIME_BILLING_POLICY_INVALID')}
  if($Provider-eq'gemini'-and[bool]$p.billingLinked){throw 'GEMINI_RUNTIME_BILLING_LINKED_DENIED'}
  if([DateTime]::Parse([string]$p.expiresAtUtc).ToUniversalTime()-le[DateTime]::UtcNow){throw ($Provider.ToUpperInvariant()+'_RUNTIME_FREE_TIER_PROOF_EXPIRED')}
  return $p
}
function Unprotect-Key([string]$Path,[string]$Entropy){
  if(-not(Test-Path -LiteralPath $Path)){throw 'RUNTIME_SECRET_MISSING'}
  $cipher=[Convert]::FromBase64String([IO.File]::ReadAllText($Path).Trim())
  $bytes=[Security.Cryptography.ProtectedData]::Unprotect($cipher,[Text.Encoding]::UTF8.GetBytes($Entropy),[Security.Cryptography.DataProtectionScope]::LocalMachine)
  try{return [Text.Encoding]::UTF8.GetString($bytes)}finally{[Array]::Clear($bytes,0,$bytes.Length);[Array]::Clear($cipher,0,$cipher.Length)}
}
if(-not(Test-Path -LiteralPath $testPath)){throw 'PC01_AI_AUTO_TEST_MISSING'}
$null=Read-FreeProof $groqProof 'groq'
$groqKey=Unprotect-Key $groqSecret 'TigerIQ-Groq-PC01-v1'
$geminiKey=$null
try{
  [Environment]::SetEnvironmentVariable('GROQ_API_KEY',$groqKey,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_GROQ_FREE_TIER_VERIFIED','true','Process')
  $geminiAvailable=(Test-Path -LiteralPath $geminiSecret)-and(Test-Path -LiteralPath $geminiProof)
  if($RequireGemini-and-not$geminiAvailable){throw 'GEMINI_RUNTIME_SECRET_OR_PROOF_MISSING'}
  if($geminiAvailable){
    $gp=Read-FreeProof $geminiProof 'gemini'
    if([string]$gp.model-ne'gemini-2.5-flash'){throw 'GEMINI_RUNTIME_MODEL_PROOF_INVALID'}
    $geminiKey=Unprotect-Key $geminiSecret 'TigerIQ-Gemini-PC01-v1'
    if(-not$geminiKey.StartsWith('AIza')){throw 'GEMINI_RUNTIME_SECRET_DECRYPT_INVALID'}
    [Environment]::SetEnvironmentVariable('GEMINI_API_KEY',$geminiKey,'Process')
    [Environment]::SetEnvironmentVariable('TIGERIQ_GEMINI_FREE_TIER_VERIFIED','true','Process')
  }
  [Environment]::SetEnvironmentVariable('TIGERIQ_AI_DIST_ROOT',$DistRoot,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_OLLAMA_URL','http://127.0.0.1:11434','Process')
  Push-Location $RepoRoot
  try{& 'C:\Program Files\nodejs\node.exe' $testPath;$code=$LASTEXITCODE}finally{Pop-Location}
  if($code-ne 0){throw "PC01_AI_AUTO_E2E_EXIT_$code"}
}finally{
  [Environment]::SetEnvironmentVariable('GROQ_API_KEY',$null,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_GROQ_FREE_TIER_VERIFIED',$null,'Process')
  [Environment]::SetEnvironmentVariable('GEMINI_API_KEY',$null,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_GEMINI_FREE_TIER_VERIFIED',$null,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_AI_DIST_ROOT',$null,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_OLLAMA_URL',$null,'Process')
  $groqKey=$null;$geminiKey=$null
}
