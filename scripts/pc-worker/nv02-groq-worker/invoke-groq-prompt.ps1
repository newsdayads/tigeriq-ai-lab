param(
  [Parameter(Mandatory=$true)][string]$PromptPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [int]$TimeoutSeconds=90,
  [ValidateRange(1,3)][int]$MaxAttempts=3
)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security
$secretPath='D:\TigerIQ\Secrets\groq-api-key.dpapi'
$proofPath='D:\TigerIQ\Secrets\groq-free-tier-proof.json'
if(-not (Test-Path -LiteralPath $PromptPath)){throw 'GROQ_PROMPT_MISSING'}
if(-not (Test-Path -LiteralPath $secretPath)){throw 'GROQ_RUNTIME_SECRET_MISSING'}
if(-not (Test-Path -LiteralPath $proofPath)){throw 'GROQ_FREE_PROOF_MISSING'}
$proof=Get-Content -Raw -LiteralPath $proofPath|ConvertFrom-Json
if([string]$proof.provider -ne 'groq' -or [string]$proof.plan -ne 'Free' -or [decimal]$proof.priceUsd -ne 0){throw 'GROQ_FREE_PROOF_INVALID'}
if(-not [bool]$proof.ownerConfirmed -or [bool]$proof.paidFallbackAllowed){throw 'GROQ_BILLING_POLICY_INVALID'}
if([DateTime]::Parse([string]$proof.expiresAtUtc).ToUniversalTime() -le [DateTime]::UtcNow){throw 'GROQ_FREE_PROOF_EXPIRED'}
$prompt=[IO.File]::ReadAllText($PromptPath)
if([string]::IsNullOrWhiteSpace($prompt)){throw 'GROQ_PROMPT_EMPTY'}
$cipher=[Convert]::FromBase64String([IO.File]::ReadAllText($secretPath).Trim())
$entropy=[Text.Encoding]::UTF8.GetBytes('TigerIQ-Groq-PC01-v1')
$plain=$null; $key=$null; $attempt=0; $lastClass=$null
try{
  $plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  $key=[Text.Encoding]::UTF8.GetString($plain)
  if([string]::IsNullOrWhiteSpace($key)-or -not $key.StartsWith('gsk_')){throw 'GROQ_SECRET_DECRYPT_INVALID'}
  $headers=@{Authorization=('Bearer '+$key);'Content-Type'='application/json'}
  $body=@{model='openai/gpt-oss-120b';service_tier='on_demand';messages=@(@{role='user';content=$prompt});stream=$false;reasoning_effort='low';max_completion_tokens=2048}|ConvertTo-Json -Depth 8
  while($attempt -lt $MaxAttempts){
    $attempt++
    try{
      $r=Invoke-RestMethod -Method Post -Uri 'https://api.groq.com/openai/v1/chat/completions' -Headers $headers -Body $body -TimeoutSec $TimeoutSeconds
      if([string]$r.model -ne 'openai/gpt-oss-120b'){throw 'GROQ_MODEL_MISMATCH'}
      $text=[string]$r.choices[0].message.content
      if([string]::IsNullOrWhiteSpace($text)){throw 'GROQ_EMPTY_RESPONSE'}
      $out=[ordered]@{ok=$true;provider='groq';model=[string]$r.model;content=$text;usage=$r.usage;attempts=$attempt;completedAt=[DateTime]::UtcNow.ToString('o')}
      $dir=Split-Path -Parent $OutputPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
      [IO.File]::WriteAllText($OutputPath,($out|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
      return
    }catch{
      $status=0
      try{$status=[int]$_.Exception.Response.StatusCode.value__}catch{}
      $msg=[string]$_.Exception.Message
      if($status -eq 429){$lastClass='rate_limit'}
      elseif($status -eq 401 -or $status -eq 403){$lastClass='auth'}
      elseif($status -ge 500){$lastClass='outage'}
      elseif($msg -match 'timed out|timeout'){$lastClass='timeout'}
      elseif($msg -match 'GROQ_MODEL_MISMATCH|GROQ_EMPTY_RESPONSE'){$lastClass='invalid_response'}
      else{$lastClass='invalid_response'}
      $retryable=@('rate_limit','outage','timeout') -contains $lastClass
      if(-not $retryable -or $attempt -ge $MaxAttempts){throw ("GROQ_{0}_ATTEMPT_{1}" -f $lastClass.ToUpperInvariant(),$attempt)}
      Start-Sleep -Seconds ([Math]::Pow(2,$attempt-1))
    }
  }
}finally{
  if($null-ne $plain){[Array]::Clear($plain,0,$plain.Length)}
  if($null-ne $cipher){[Array]::Clear($cipher,0,$cipher.Length)}
  $key=$null
}
