param(
  [string]$WorkOrderId = '',
  [string]$StatePath = '',
  [string]$EvidencePath = '',
  [int]$TimeoutSeconds = 60
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$secretPath = 'D:\TigerIQ\Secrets\groq-api-key.dpapi'
$proofPath = 'D:\TigerIQ\Secrets\groq-free-tier-proof.json'
$harness = Join-Path $PSScriptRoot 'run-ai-job001-mixed.ps1'
if (-not (Test-Path -LiteralPath $secretPath)) { throw 'GROQ_RUNTIME_SECRET_MISSING' }
if (-not (Test-Path -LiteralPath $proofPath)) { throw 'GROQ_RUNTIME_FREE_TIER_PROOF_MISSING' }
if (-not (Test-Path -LiteralPath $harness)) { throw 'GROQ_RUNTIME_HARNESS_MISSING' }
$proof = Get-Content -Raw -LiteralPath $proofPath | ConvertFrom-Json
if ([string]$proof.provider -ne 'groq' -or [string]$proof.plan -ne 'Free' -or [decimal]$proof.priceUsd -ne 0) {
  throw 'GROQ_RUNTIME_FREE_TIER_PROOF_INVALID'
}
if (-not [bool]$proof.ownerConfirmed -or [bool]$proof.paidFallbackAllowed) {
  throw 'GROQ_RUNTIME_BILLING_POLICY_INVALID'
}
$expires = [DateTime]::Parse([string]$proof.expiresAtUtc).ToUniversalTime()
if ($expires -le [DateTime]::UtcNow) { throw 'GROQ_RUNTIME_FREE_TIER_PROOF_EXPIRED' }
$cipherText = [IO.File]::ReadAllText($secretPath).Trim()
$cipherBytes = [Convert]::FromBase64String($cipherText)
$entropy = [Text.Encoding]::UTF8.GetBytes('TigerIQ-Groq-PC01-v1')
$plainBytes = $null
$key = $null
try {
  $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $cipherBytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  $key = [Text.Encoding]::UTF8.GetString($plainBytes)
  if ([string]::IsNullOrWhiteSpace($key) -or -not $key.StartsWith('gsk_')) { throw 'GROQ_RUNTIME_SECRET_DECRYPT_INVALID' }
  [Environment]::SetEnvironmentVariable('GROQ_API_KEY',$key,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_GROQ_FREE_TIER_VERIFIED','true','Process')
  $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$harness,'-Live','-TimeoutSeconds',[string]$TimeoutSeconds)
  if (-not [string]::IsNullOrWhiteSpace($WorkOrderId)) { $args += @('-WorkOrderId',$WorkOrderId) }
  if (-not [string]::IsNullOrWhiteSpace($StatePath)) { $args += @('-StatePath',$StatePath) }
  if (-not [string]::IsNullOrWhiteSpace($EvidencePath)) { $args += @('-EvidencePath',$EvidencePath) }
  & powershell @args
  $code = $LASTEXITCODE
  if ($code -ne 0) { throw "GROQ_RUNTIME_JOB_FAILED_EXIT_$code" }
} finally {
  [Environment]::SetEnvironmentVariable('GROQ_API_KEY',$null,'Process')
  [Environment]::SetEnvironmentVariable('TIGERIQ_GROQ_FREE_TIER_VERIFIED',$null,'Process')
  if ($null -ne $plainBytes) { [Array]::Clear($plainBytes,0,$plainBytes.Length) }
  if ($null -ne $cipherBytes) { [Array]::Clear($cipherBytes,0,$cipherBytes.Length) }
  $key = $null
}