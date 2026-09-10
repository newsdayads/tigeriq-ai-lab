param([int]$TimeoutSeconds=60)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security
if($TimeoutSeconds-lt 5-or$TimeoutSeconds-gt 180){throw 'GEMINI_RUNTIME_TIMEOUT_OUT_OF_RANGE'}
$secretPath='D:\TigerIQ\Secrets\gemini-api-key.dpapi'
$proofPath='D:\TigerIQ\Secrets\gemini-free-tier-proof.json'
if(-not(Test-Path -LiteralPath $secretPath)){throw 'GEMINI_RUNTIME_SECRET_MISSING'}
if(-not(Test-Path -LiteralPath $proofPath)){throw 'GEMINI_RUNTIME_FREE_TIER_PROOF_MISSING'}
$proof=Get-Content -Raw -LiteralPath $proofPath|ConvertFrom-Json
if([string]$proof.provider-ne'gemini'-or[string]$proof.plan-ne'Free'-or[decimal]$proof.priceUsd-ne 0){throw 'GEMINI_RUNTIME_FREE_TIER_PROOF_INVALID'}
if(-not[bool]$proof.ownerConfirmed-or[bool]$proof.billingLinked-or[bool]$proof.paidFallbackAllowed){throw 'GEMINI_RUNTIME_BILLING_POLICY_INVALID'}
if([string]$proof.model-ne'gemini-3.5-flash-lite'){throw 'GEMINI_RUNTIME_MODEL_PROOF_INVALID'}
if([DateTime]::Parse([string]$proof.expiresAtUtc).ToUniversalTime()-le[DateTime]::UtcNow){throw 'GEMINI_RUNTIME_FREE_TIER_PROOF_EXPIRED'}
$cipher=[Convert]::FromBase64String([IO.File]::ReadAllText($secretPath).Trim())
$entropy=[Text.Encoding]::UTF8.GetBytes('TigerIQ-Gemini-PC01-v1')
$plainBytes=$null;$key=$null
try{
  $plainBytes=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  $key=[Text.Encoding]::UTF8.GetString($plainBytes)
  if([string]::IsNullOrWhiteSpace($key)-or $key.Length-lt 30-or $key-match '\s'){throw 'GEMINI_RUNTIME_SECRET_DECRYPT_INVALID'}
  $headers=@{'x-goog-api-key'=$key;'Content-Type'='application/json'}
  $marker='TIGERIQ_GEMINI_FREE_READY'
  $body=@{contents=@(@{role='user';parts=@(@{text=('Return exactly '+$marker)})});generationConfig=@{maxOutputTokens=256;temperature=0}}|ConvertTo-Json -Depth 7
  $uri='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'
  $response=Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -TimeoutSec $TimeoutSeconds
  $text=($response.candidates[0].content.parts|ForEach-Object{[string]$_.text})-join [Environment]::NewLine
  if($text-notmatch[regex]::Escape($marker)){throw 'GEMINI_RUNTIME_UNEXPECTED_RESPONSE'}
  [pscustomobject]@{status='PASS';provider='gemini';model='gemini-3.5-flash-lite';freeTierProof=$true;paidFallbackAllowed=$false}|ConvertTo-Json
}finally{
  if($null-ne$plainBytes){[Array]::Clear($plainBytes,0,$plainBytes.Length)}
  if($null-ne$cipher){[Array]::Clear($cipher,0,$cipher.Length)}
  $key=$null
}
