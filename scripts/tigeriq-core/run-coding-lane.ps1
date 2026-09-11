$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. 'D:\TigerIQ\Rebuild\credential-store.ps1'
$root=$PSScriptRoot
$app=Join-Path $root '..\..\apps\tigeriq-coding-lane\coding-entry.mjs'
if(-not(Test-Path -LiteralPath $app)){throw 'CODING_LANE_APP_MISSING'}
$mutex=New-Object Threading.Mutex($false,'Global\TigerIQCodingLaneSupervisorV1')
$owns=$false
try{$owns=$mutex.WaitOne(0)}catch{$owns=$false}
if(-not $owns){exit 73}
function Set-SecretEnv([string]$EnvName,[string]$SecretName,[string]$Entropy){
  $value=Get-TigerIQSecret $SecretName $Entropy
  if(-not[string]::IsNullOrWhiteSpace($value)){[Environment]::SetEnvironmentVariable($EnvName,$value,'Process')}
}
function Clear-ProviderEnvironment {
  foreach($name in @('GROQ_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','MISTRAL_API_KEY','HF_TOKEN','COHERE_API_KEY','TIGERIQ_GROQ_FREE_TIER_VERIFIED','TIGERIQ_GEMINI_FREE_TIER_VERIFIED','TIGERIQ_COHERE_TRIAL_CONFIRMED')){[Environment]::SetEnvironmentVariable($name,$null,'Process')}
}
function Load-Environment {
  Clear-ProviderEnvironment
  $env:DATABASE_URL=(Get-Content -Raw 'D:\TigerIQ\Secrets\workforce-controller-v1.database-url').Trim()
  $env:TIGERIQ_GITHUB_TOKEN=(Get-Content -Raw 'D:\TigerIQ\Secrets\github-command-center.token').Trim()
  $tail=(tailscale ip -4 2>$null|Select-Object -First 1)
  $env:TIGERIQ_CODING_HOST=if($tail){[string]$tail}else{'127.0.0.1'}
  $env:TIGERIQ_CODING_PORT='8797'
  $env:TIGERIQ_CODING_AUTO_MERGE='true'
  $env:TIGERIQ_ALLOW_PAID_AI='false'
  $groqProof=Get-Content -Raw 'D:\TigerIQ\Secrets\groq-free-tier-proof.json'|ConvertFrom-Json
  $geminiProof=Get-Content -Raw 'D:\TigerIQ\Secrets\gemini-free-tier-proof.json'|ConvertFrom-Json
  if($groqProof.plan -eq 'Free' -and $groqProof.priceUsd -eq 0 -and $groqProof.ownerConfirmed -and -not $groqProof.paidFallbackAllowed -and [DateTime]::Parse($groqProof.expiresAtUtc) -gt [DateTime]::UtcNow){Set-SecretEnv 'GROQ_API_KEY' 'groq-api-key' 'TigerIQ-Groq-PC01-v1';$env:TIGERIQ_GROQ_FREE_TIER_VERIFIED='true'}
  if($geminiProof.plan -eq 'Free' -and $geminiProof.priceUsd -eq 0 -and $geminiProof.ownerConfirmed -and -not $geminiProof.billingLinked -and -not $geminiProof.paidFallbackAllowed -and [DateTime]::Parse($geminiProof.expiresAtUtc) -gt [DateTime]::UtcNow){Set-SecretEnv 'GEMINI_API_KEY' 'gemini-api-key' 'TigerIQ-Gemini-PC01-v1';$env:TIGERIQ_GEMINI_FREE_TIER_VERIFIED='true'}
  $co=Get-TigerIQConfig 'cohere-proof'
  if($co -and $co.PSObject.Properties['trialConfirmed'] -and $co.trialConfirmed){Set-SecretEnv 'COHERE_API_KEY' 'cohere-api-key' 'TigerIQ-Cohere-PC01-v1';$env:TIGERIQ_COHERE_TRIAL_CONFIRMED='true'}
}
$logDir='D:\TigerIQ\Logs\CodingLane24x7';New-Item -ItemType Directory -Path $logDir -Force|Out-Null
while($true){
  try{
    Load-Environment
    $out=Join-Path $logDir ('coding-'+(Get-Date -Format 'yyyyMMdd')+'.out.log')
    $err=Join-Path $logDir ('coding-'+(Get-Date -Format 'yyyyMMdd')+'.err.log')
    $p=Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList @($app) -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
    $p.WaitForExit()
  }catch{Add-Content -Path (Join-Path $logDir 'supervisor.log') -Value ((Get-Date -Format o)+' '+$_.Exception.Message) -Encoding UTF8}
  Start-Sleep -Seconds 10
}
