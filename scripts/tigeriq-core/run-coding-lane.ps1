$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. 'D:\TigerIQ\Rebuild\credential-store.ps1'
$defaultRepo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$runtimeSourceState='D:\TigerIQ\State\core-runtime-source.json'
$repo=$defaultRepo
if(Test-Path -LiteralPath $runtimeSourceState){
  try{$meta=Get-Content -Raw -LiteralPath $runtimeSourceState|ConvertFrom-Json;if($meta.sourcePath -and (Test-Path -LiteralPath ([string]$meta.sourcePath))){$repo=[string]$meta.sourcePath}}catch{}
}
$app=(Resolve-Path -LiteralPath (Join-Path $repo 'apps\tigeriq-coding-lane\coding-entry.mjs')).Path
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
  foreach($name in @('GROQ_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','MISTRAL_API_KEY','CLOUDFLARE_AUTH_TOKEN','CLOUDFLARE_ACCOUNT_ID','HF_TOKEN','COHERE_API_KEY','INCEPTION_API_KEY','NVIDIA_API_KEY','TIGERIQ_GROQ_FREE_TIER_VERIFIED','TIGERIQ_GEMINI_FREE_TIER_VERIFIED','TIGERIQ_COHERE_TRIAL_CONFIRMED','TIGERIQ_INCEPTION_FREE_TIER_VERIFIED','TIGERIQ_CLOUDFLARE_FREE_CONFIRMED','TIGERIQ_NVIDIA_FREE_DEV_CONFIRMED','TIGERIQ_INCEPTION_MODEL','TIGERIQ_NVIDIA_MODEL','TIGERIQ_GEMINI_MODEL','TIGERIQ_GEMINI_MIN_INTERVAL_MS','TIGERIQ_GEMINI_BACKOFF_BASE_MS','TIGERIQ_GEMINI_MAX_ATTEMPTS','TIGERIQ_CODING_MAX_PARALLEL')){[Environment]::SetEnvironmentVariable($name,$null,'Process')}
}
function Load-Environment {
  Clear-ProviderEnvironment
  $env:DATABASE_URL=(Get-Content -Raw 'D:\TigerIQ\Secrets\workforce-controller-v1.database-url').Trim()
  $pgLine=(Get-Content 'D:\TigerIQ\Secrets\workforce-controller-v1.pgpass'|Where-Object{$_ -and -not $_.StartsWith('#')}|Select-Object -First 1)
  if(-not $pgLine){throw 'PGPASSWORD_MISSING'}
  $env:PGPASSWORD=([string]$pgLine).Split(':',5)[4]
  $env:TIGERIQ_GITHUB_TOKEN=(Get-Content -Raw 'D:\TigerIQ\Secrets\github-command-center.token').Trim()
  $tail=(tailscale ip -4 2>$null|Select-Object -First 1)
  $env:TIGERIQ_CODING_HOST=if($tail){[string]$tail}else{'127.0.0.1'}
  $env:TIGERIQ_CODING_PORT='8797'
  $env:TIGERIQ_CODING_AUTO_MERGE='true'
  $env:TIGERIQ_ALLOW_PAID_AI='false'
  $env:TIGERIQ_GEMINI_MODEL='gemini-3.5-flash-lite'
  $env:TIGERIQ_GEMINI_MIN_INTERVAL_MS='4500'
  $env:TIGERIQ_GEMINI_BACKOFF_BASE_MS='4500'
  $env:TIGERIQ_GEMINI_MAX_ATTEMPTS='4'
  $env:TIGERIQ_CODING_MAX_PARALLEL='6'
  $groqProof=Get-Content -Raw 'D:\TigerIQ\Secrets\groq-free-tier-proof.json'|ConvertFrom-Json
  $geminiProof=Get-Content -Raw 'D:\TigerIQ\Secrets\gemini-free-tier-proof.json'|ConvertFrom-Json
  if($groqProof.plan -eq 'Free' -and $groqProof.priceUsd -eq 0 -and $groqProof.ownerConfirmed -and -not $groqProof.paidFallbackAllowed -and [DateTime]::Parse($groqProof.expiresAtUtc) -gt [DateTime]::UtcNow){Set-SecretEnv 'GROQ_API_KEY' 'groq-api-key' 'TigerIQ-Groq-PC01-v1';$env:TIGERIQ_GROQ_FREE_TIER_VERIFIED='true'}
  if($geminiProof.plan -eq 'Free' -and $geminiProof.priceUsd -eq 0 -and $geminiProof.ownerConfirmed -and -not $geminiProof.billingLinked -and -not $geminiProof.paidFallbackAllowed -and [DateTime]::Parse($geminiProof.expiresAtUtc) -gt [DateTime]::UtcNow){Set-SecretEnv 'GEMINI_API_KEY' 'gemini-api-key' 'TigerIQ-Gemini-PC01-v1';$env:TIGERIQ_GEMINI_FREE_TIER_VERIFIED='true'}
  $co=Get-TigerIQConfig 'cohere-proof'
  if($co -and $co.PSObject.Properties['trialConfirmed'] -and $co.trialConfirmed){Set-SecretEnv 'COHERE_API_KEY' 'cohere-api-key' 'TigerIQ-Cohere-PC01-v1';$env:TIGERIQ_COHERE_TRIAL_CONFIRMED='true'}
  # #572 established the existing Cloudflare Workers AI allocation as Free with no paid fallback.
  Set-SecretEnv 'CLOUDFLARE_AUTH_TOKEN' 'cloudflare-auth-token' 'TigerIQ-Cloudflare-PC01-v1'
  $cf=Get-TigerIQConfig 'cloudflare-config'
  if($cf -and $cf.PSObject.Properties['accountId'] -and $env:CLOUDFLARE_AUTH_TOKEN){$env:CLOUDFLARE_ACCOUNT_ID=[string]$cf.accountId;$env:TIGERIQ_CLOUDFLARE_FREE_CONFIRMED='true'}
  $nv=Get-TigerIQConfig 'nvidia-proof'
  if($nv -and $nv.PSObject.Properties['freeConfirmed'] -and $nv.freeConfirmed -and $nv.PSObject.Properties['paidFallbackAllowed'] -and -not $nv.paidFallbackAllowed -and $nv.PSObject.Properties['ownerConfirmed'] -and $nv.ownerConfirmed){Set-SecretEnv 'NVIDIA_API_KEY' 'nvidia-api-key' 'TigerIQ-NVIDIA-PC01-v1';$env:TIGERIQ_NVIDIA_FREE_DEV_CONFIRMED='true';$env:TIGERIQ_NVIDIA_MODEL='nvidia/nemotron-3-super-120b-a12b'}
  $inc=Get-TigerIQConfig 'inception-proof'
  if($inc -and $inc.PSObject.Properties['plan'] -and [string]$inc.plan -eq 'Free' -and $inc.PSObject.Properties['freeConfirmed'] -and $inc.freeConfirmed -and $inc.PSObject.Properties['freeTokens'] -and [double]$inc.freeTokens -gt 0 -and $inc.PSObject.Properties['creditCardRequired'] -and -not $inc.creditCardRequired -and $inc.PSObject.Properties['paidFallbackAllowed'] -and -not $inc.paidFallbackAllowed){Set-SecretEnv 'INCEPTION_API_KEY' 'inception-api-key' 'TigerIQ-Inception-PC01-v1';$env:TIGERIQ_INCEPTION_FREE_TIER_VERIFIED='true';$env:TIGERIQ_INCEPTION_MODEL='mercury-2.5'}
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
