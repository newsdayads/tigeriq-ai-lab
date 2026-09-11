$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. 'D:\TigerIQ\Rebuild\credential-store.ps1'
$repo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$core=Join-Path $repo 'apps\tigeriq-core\core.mjs'
$logDir='D:\TigerIQ\Logs\Core24x7'
New-Item -ItemType Directory -Path $logDir -Force|Out-Null
function Set-SecretEnv([string]$EnvName,[string]$SecretName,[string]$Entropy){
  $value=Get-TigerIQSecret $SecretName $Entropy
  if(-not[string]::IsNullOrWhiteSpace($value)){[Environment]::SetEnvironmentVariable($EnvName,$value,'Process')}
}
function Clear-CoreEnvironment {
  $names=@('DATABASE_URL','PGPASSWORD','TIGERIQ_CORE_TOKEN','GROQ_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','MISTRAL_API_KEY','CLOUDFLARE_AUTH_TOKEN','HF_TOKEN','AI_GATEWAY_API_KEY','WATSONX_API_KEY','COHERE_API_KEY','NVIDIA_API_KEY','CLOUDFLARE_ACCOUNT_ID','WATSONX_PROJECT_ID','WATSONX_MODEL_ID','TIGERIQ_GROQ_FREE_TIER_VERIFIED','TIGERIQ_GEMINI_FREE_TIER_VERIFIED','TIGERIQ_VERCEL_FREE_CREDIT_CONFIRMED','TIGERIQ_WATSONX_LITE_CONFIRMED','TIGERIQ_COHERE_TRIAL_CONFIRMED','TIGERIQ_NVIDIA_FREE_DEV_CONFIRMED')
  foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$null,'Process')}
}
function Get-SecretStamp {
  $files=Get-ChildItem 'D:\TigerIQ\Secrets' -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match 'api|token|proof|config|database-url|pgpass'} | Sort-Object Name
  return (($files | ForEach-Object {$_.Name+':'+$_.Length+':'+$_.LastWriteTimeUtc.Ticks}) -join '|')
}
function Load-CoreEnvironment {
  Clear-CoreEnvironment
  $env:DATABASE_URL=(Get-Content -Raw 'D:\TigerIQ\Secrets\workforce-controller-v1.database-url').Trim()
  $pgLine=(Get-Content 'D:\TigerIQ\Secrets\workforce-controller-v1.pgpass'|Where-Object{$_ -and -not $_.StartsWith('#')}|Select-Object -First 1)
  $env:PGPASSWORD=([string]$pgLine).Split(':',5)[4]
  $env:TIGERIQ_CORE_TOKEN=(Get-Content -Raw 'D:\TigerIQ\Secrets\pc01-primary-node.ingress-token').Trim()
  $tail=(tailscale ip -4 2>$null | Select-Object -First 1)
  $env:TIGERIQ_CORE_HOST=if($tail){[string]$tail}else{'127.0.0.1'}
  $env:TIGERIQ_CORE_PORT='8795'
  $env:TIGERIQ_OLLAMA_MODEL='qwen3:4b'
  $env:TIGERIQ_ALLOW_PAID_AI='false'
  $groqProof=Get-Content -Raw 'D:\TigerIQ\Secrets\groq-free-tier-proof.json'|ConvertFrom-Json
  $geminiProof=Get-Content -Raw 'D:\TigerIQ\Secrets\gemini-free-tier-proof.json'|ConvertFrom-Json
  if($groqProof.plan -eq 'Free' -and $groqProof.priceUsd -eq 0 -and $groqProof.ownerConfirmed -and -not $groqProof.paidFallbackAllowed -and [DateTime]::Parse($groqProof.expiresAtUtc) -gt [DateTime]::UtcNow){
    Set-SecretEnv 'GROQ_API_KEY' 'groq-api-key' 'TigerIQ-Groq-PC01-v1';$env:TIGERIQ_GROQ_FREE_TIER_VERIFIED='true'
  }
  if($geminiProof.plan -eq 'Free' -and $geminiProof.priceUsd -eq 0 -and $geminiProof.ownerConfirmed -and -not $geminiProof.billingLinked -and -not $geminiProof.paidFallbackAllowed -and [DateTime]::Parse($geminiProof.expiresAtUtc) -gt [DateTime]::UtcNow){
    Set-SecretEnv 'GEMINI_API_KEY' 'gemini-api-key' 'TigerIQ-Gemini-PC01-v1';$env:TIGERIQ_GEMINI_FREE_TIER_VERIFIED='true'
  }
  Set-SecretEnv 'OPENROUTER_API_KEY' 'openrouter-api-key' 'TigerIQ-OpenRouter-PC01-v1'
  Set-SecretEnv 'MISTRAL_API_KEY' 'mistral-api-key' 'TigerIQ-Mistral-PC01-v1'
  Set-SecretEnv 'CLOUDFLARE_AUTH_TOKEN' 'cloudflare-auth-token' 'TigerIQ-Cloudflare-PC01-v1'
  Set-SecretEnv 'HF_TOKEN' 'hf-token' 'TigerIQ-HuggingFace-PC01-v1'
  Set-SecretEnv 'AI_GATEWAY_API_KEY' 'vercel-ai-gateway-key' 'TigerIQ-Vercel-PC01-v1'
  Set-SecretEnv 'WATSONX_API_KEY' 'watsonx-api-key' 'TigerIQ-Watsonx-PC01-v1'
  Set-SecretEnv 'COHERE_API_KEY' 'cohere-api-key' 'TigerIQ-Cohere-PC01-v1'
  Set-SecretEnv 'NVIDIA_API_KEY' 'nvidia-api-key' 'TigerIQ-NVIDIA-PC01-v1'
  $cf=Get-TigerIQConfig 'cloudflare-config';if($cf -and $cf.PSObject.Properties['accountId']){$env:CLOUDFLARE_ACCOUNT_ID=[string]$cf.accountId}
  $ve=Get-TigerIQConfig 'vercel-proof';if($ve -and $ve.PSObject.Properties['freeConfirmed'] -and $ve.freeConfirmed){$env:TIGERIQ_VERCEL_FREE_CREDIT_CONFIRMED='true'}
  $wx=Get-TigerIQConfig 'watsonx-config';if($wx){if($wx.PSObject.Properties['projectId']){$env:WATSONX_PROJECT_ID=[string]$wx.projectId};if($wx.PSObject.Properties['modelId']){$env:WATSONX_MODEL_ID=[string]$wx.modelId};if($wx.PSObject.Properties['liteConfirmed'] -and $wx.liteConfirmed){$env:TIGERIQ_WATSONX_LITE_CONFIRMED='true'}}
  $co=Get-TigerIQConfig 'cohere-proof';if($co -and $co.PSObject.Properties['trialConfirmed'] -and $co.trialConfirmed){$env:TIGERIQ_COHERE_TRIAL_CONFIRMED='true'}
  $nv=Get-TigerIQConfig 'nvidia-proof';if($nv -and $nv.PSObject.Properties['freeConfirmed'] -and $nv.freeConfirmed){$env:TIGERIQ_NVIDIA_FREE_DEV_CONFIRMED='true'}
}
while($true){
  try {
    Load-CoreEnvironment
    $stamp=Get-SecretStamp
    $out=Join-Path $logDir ('core-'+(Get-Date -Format 'yyyyMMdd')+'.out.log')
    $err=Join-Path $logDir ('core-'+(Get-Date -Format 'yyyyMMdd')+'.err.log')
    $p=Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList @($core) -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
    while(-not $p.HasExited){
      Start-Sleep -Seconds 5
      if((Get-SecretStamp)-ne$stamp){try{Stop-Process -Id $p.Id -Force -ErrorAction Stop}catch{};break}
    }
  } catch {
    $supervisorLog=Join-Path $logDir 'supervisor.log'
    Add-Content -Path $supervisorLog -Value ((Get-Date -Format o)+' '+($_.Exception.Message)) -Encoding UTF8
  } finally {
    Clear-CoreEnvironment
  }
  Start-Sleep -Seconds 10
}
