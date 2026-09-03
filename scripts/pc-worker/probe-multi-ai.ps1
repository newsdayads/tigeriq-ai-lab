param(
  [switch]$Live,
  [switch]$SelfTest,
  [switch]$ClaudeNoUsageCreditsVerified,
  [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Sanitize([string]$Text) {
  if ($null -eq $Text) { return '' }
  $safe = [string]$Text
  $safe = [regex]::Replace($safe, '(?is)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----', '[REDACTED PRIVATE KEY]')
  $safe = [regex]::Replace($safe, '(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=:-]+', '$1 REDACTED')
  $safe = [regex]::Replace($safe, '(?i)(https?://)[^/\s:@]+:[^@\s/]+@', '$1REDACTED@')
  $safe = [regex]::Replace($safe, '(?im)(["'']?(?:api[_-]?key|token|secret|authorization|password|private[_-]?key)["'']?\s*[:=]\s*["'']?)[^\s,"''}\r\n]+', '$1REDACTED')
  $safe = [regex]::Replace($safe, '(?i)\b(?:sk-or-v1-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9._-]{20,})\b', '[REDACTED TOKEN]')
  $safe = [regex]::Replace($safe, '(?i)\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b', '[REDACTED JWT]')
  $safe = $safe.Trim()
  if ($safe.Length -gt 600) { $safe = $safe.Substring(0, 600) + '…' }
  return $safe
}

function Resolve-Tool([string[]]$Names) {
  foreach ($name in $Names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
  }
  return $null
}

function Invoke-External([string]$Exe, [string[]]$ArgumentList, [int]$Timeout) {
  $stdout = Join-Path $env:TEMP ("tigeriq-probe-out-{0}.txt" -f [guid]::NewGuid().ToString('N'))
  $stderr = Join-Path $env:TEMP ("tigeriq-probe-err-{0}.txt" -f [guid]::NewGuid().ToString('N'))
  try {
    $p = Start-Process -FilePath $Exe -ArgumentList $ArgumentList -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if (-not $p.WaitForExit($Timeout * 1000)) {
      try { $p.Kill() } catch {}
      return [ordered]@{ exitCode = $null; timeout = $true; output = ''; error = 'TIMEOUT' }
    }
    $outText = if (Test-Path $stdout) { [IO.File]::ReadAllText($stdout) } else { '' }
    $errText = if (Test-Path $stderr) { [IO.File]::ReadAllText($stderr) } else { '' }
    return [ordered]@{ exitCode=$p.ExitCode; timeout=$false; output=(Sanitize $outText); error=(Sanitize $errText) }
  } finally {
    Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-WithTemporaryEnvironment([hashtable]$SetValues, [string[]]$ClearNames, [scriptblock]$Action) {
  $names = @($SetValues.Keys) + @($ClearNames) | Select-Object -Unique
  $before = @{}
  foreach ($name in $names) { $before[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  try {
    foreach ($name in $ClearNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    foreach ($name in $SetValues.Keys) { [Environment]::SetEnvironmentVariable($name, [string]$SetValues[$name], 'Process') }
    return & $Action
  } finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $before[$name], 'Process') }
  }
}

function New-StaticResult([string]$Name, [string[]]$CommandNames, [string[]]$VersionArgs) {
  $exe = Resolve-Tool $CommandNames
  if (-not $exe) { return [ordered]@{ name=$Name; installed=$false; versionOk=$false; liveTested=$false; liveOk=$false; status='NOT_INSTALLED' } }
  $version = Invoke-External -Exe $exe -ArgumentList $VersionArgs -Timeout ([Math]::Min($TimeoutSeconds, 15))
  return [ordered]@{ name=$Name; installed=$true; path=$exe; versionOk=(-not $version.timeout -and $version.exitCode -eq 0); version=if($version.output){$version.output}else{$version.error}; liveTested=$false; liveOk=$false; status=if($version.timeout){'VERSION_TIMEOUT'}elseif($version.exitCode -eq 0){'INSTALLED'}else{'VERSION_ERROR'} }
}

function Set-LiveResult([System.Collections.IDictionary]$Result, [System.Collections.IDictionary]$LiveResult, [string]$ExpectedMarker) {
  $Result.liveTested = $true
  $combined = (([string]$LiveResult.output) + "`n" + ([string]$LiveResult.error)).Trim()
  $markerOk = $combined -match [regex]::Escape($ExpectedMarker)
  $Result.liveOk = (-not $LiveResult.timeout -and $LiveResult.exitCode -eq 0 -and $markerOk)
  $Result.status = if ($LiveResult.timeout) { 'LIVE_TIMEOUT' } elseif ($Result.liveOk) { 'READY' } elseif ($LiveResult.exitCode -ne 0) { if ($combined -match '^BILLING_ROUTE_BLOCKED|CLAUDE_SUBSCRIPTION_AUTH_UNPROVEN|CLAUDE_USAGE_CREDITS_STATUS_UNPROVEN|OPENROUTER_(NONFREE_MODEL|COST_UNPROVEN|COST_NONZERO)') { 'BILLING_ROUTE_BLOCKED' } else { 'AUTH_OR_INVOCATION_ERROR' } } else { 'UNEXPECTED_RESPONSE' }
  $Result.liveOutput = Sanitize $combined
}

function Test-GeminiConfigHasBillingRoute([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return [bool]($Text -match '(?i)GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENAI_USE_VERTEXAI|GEMINI_CLI_USE_COMPUTE_ADC|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_GEMINI_BASE_URL|GOOGLE_VERTEX_BASE_URL|gemini-api-key|vertex-ai')
}

function Get-GeminiBillingRouteBlockers {
  $hits = @()
  $alwaysBlockedEnv = @('GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_GEMINI_BASE_URL','GOOGLE_VERTEX_BASE_URL')
  foreach ($name in $alwaysBlockedEnv) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) { $hits += "ENV:$name" }
  }
  foreach ($name in @('GOOGLE_GENAI_USE_VERTEXAI','GEMINI_CLI_USE_COMPUTE_ADC')) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($value -match '^(?i:true|1|yes|on)$') { $hits += "ENV:$name" }
  }
  $gca = [Environment]::GetEnvironmentVariable('GOOGLE_GENAI_USE_GCA', 'Process')
  if (-not [string]::IsNullOrWhiteSpace($gca) -and $gca -notmatch '^(?i:true|1|yes|on)$') { $hits += 'ENV:GOOGLE_GENAI_USE_GCA_NOT_TRUE' }

  $configPaths = @(
    (Join-Path $HOME '.gemini\settings.json'),
    (Join-Path $HOME '.gemini\.env'),
    (Join-Path (Get-Location).Path '.gemini\settings.json'),
    (Join-Path (Get-Location).Path '.gemini\.env')
  ) | Select-Object -Unique
  foreach ($path in $configPaths) {
    if (-not (Test-Path $path)) { continue }
    try {
      $text = [IO.File]::ReadAllText($path)
      if (Test-GeminiConfigHasBillingRoute $text) { $hits += 'CONFIG:GEMINI_NON_ACCOUNT_ROUTE' }
    } catch {
      $hits += 'CONFIG:GEMINI_ROUTE_UNREADABLE'
    }
  }
  return @($hits | Select-Object -Unique)
}

function Get-ClaudeBillingRouteBlockers {
  $blockedEnv = @('ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','ANTHROPIC_BEDROCK_BASE_URL','ANTHROPIC_VERTEX_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY')
  $hits = @()
  foreach ($name in $blockedEnv) {
    $value=[Environment]::GetEnvironmentVariable($name,'Process')
    if(-not [string]::IsNullOrWhiteSpace($value)){ $hits += "ENV:$name" }
  }
  $activeConfig = Join-Path $HOME '.config\anthropic\active_config'
  if (Test-Path $activeConfig) { $hits += 'CONFIG:ANTHROPIC_ACTIVE_PROFILE' }
  $settingsPaths = @((Join-Path $HOME '.claude\settings.json'),(Join-Path (Get-Location).Path '.claude\settings.json'),(Join-Path (Get-Location).Path '.claude\settings.local.json')) | Select-Object -Unique
  foreach ($path in $settingsPaths) {
    if(-not(Test-Path $path)){continue}
    try {
      $text=[IO.File]::ReadAllText($path)
      if($text -match '(?i)"apiKeyHelper"|ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)'){ $hits += 'CONFIG:CLAUDE_NON_SUBSCRIPTION_ROUTE' }
    } catch {
      $hits += 'CONFIG:CLAUDE_ROUTE_UNREADABLE'
    }
  }
  return @($hits | Select-Object -Unique)
}

function Test-ClaudeSubscriptionStatus([string]$JsonText) {
  try {
    $status=$JsonText|ConvertFrom-Json
    return ([bool]$status.loggedIn -and [string]$status.apiProvider -eq 'firstParty' -and [string]$status.authMethod -match '^(claude\.ai|oauth_token)$' -and [string]$status.subscriptionType -match '^(pro|max)$')
  } catch { return $false }
}

function Test-OpenRouterFreeResponse([string]$JsonText,[string]$ExpectedMarker) {
  try { $response=$JsonText|ConvertFrom-Json } catch { return [ordered]@{ok=$false;error='OPENROUTER_INVALID_JSON'} }
  $model=[string]$response.model
  if([string]::IsNullOrWhiteSpace($model) -or $model -notmatch ':free$'){ return [ordered]@{ok=$false;error='OPENROUTER_NONFREE_MODEL'} }
  if($null -eq $response.usage -or $null -eq $response.usage.cost){ return [ordered]@{ok=$false;error='OPENROUTER_COST_UNPROVEN'} }
  try { $cost=[double]::Parse(([string]$response.usage.cost),[Globalization.CultureInfo]::InvariantCulture) } catch { return [ordered]@{ok=$false;error='OPENROUTER_COST_UNPROVEN'} }
  if([Math]::Abs($cost) -gt 0){ return [ordered]@{ok=$false;error='OPENROUTER_COST_NONZERO'} }
  $content=[string]$response.choices[0].message.content
  if($content -notmatch [regex]::Escape($ExpectedMarker)){ return [ordered]@{ok=$false;error='UNEXPECTED_RESPONSE'} }
  return [ordered]@{ok=$true;error='';model=$model;cost=$cost}
}

function Invoke-GeminiSubscriptionProbe([string]$Exe) {
  $blockers = @(Get-GeminiBillingRouteBlockers)
  if ($blockers.Count -gt 0) {
    return [ordered]@{exitCode=2;timeout=$false;output='';error=('BILLING_ROUTE_BLOCKED '+($blockers -join ','));subscriptionAuth=$false}
  }
  $set=@{ 'GOOGLE_GENAI_USE_GCA'='true' }
  $clear=@('GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_GENAI_USE_VERTEXAI','GEMINI_CLI_USE_COMPUTE_ADC','GOOGLE_GEMINI_BASE_URL','GOOGLE_VERTEX_BASE_URL','GOOGLE_APPLICATION_CREDENTIALS')
  $result = Invoke-WithTemporaryEnvironment -SetValues $set -ClearNames $clear -Action { Invoke-External -Exe $Exe -ArgumentList @('-p','"Return exactly TIGERIQ_GEMINI_READY"') -Timeout $TimeoutSeconds }
  $result.subscriptionAuth = $true
  return $result
}

function Invoke-ClaudeSubscriptionProbe([string]$Exe) {
  $blockers=@(Get-ClaudeBillingRouteBlockers)
  if($blockers.Count -gt 0){ return [ordered]@{exitCode=2;timeout=$false;output='';error=('BILLING_ROUTE_BLOCKED '+($blockers -join ','));subscriptionAuth=$false} }
  if(-not $ClaudeNoUsageCreditsVerified){ return [ordered]@{exitCode=7;timeout=$false;output='';error='CLAUDE_USAGE_CREDITS_STATUS_UNPROVEN';subscriptionAuth=$false} }
  $auth=Invoke-External -Exe $Exe -ArgumentList @('auth','status') -Timeout ([Math]::Min($TimeoutSeconds,15))
  if($auth.timeout -or $auth.exitCode -ne 0 -or -not(Test-ClaudeSubscriptionStatus $auth.output)){ return [ordered]@{exitCode=3;timeout=$false;output='';error='CLAUDE_SUBSCRIPTION_AUTH_UNPROVEN';subscriptionAuth=$false} }
  $clear=@('ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','ANTHROPIC_BEDROCK_BASE_URL','ANTHROPIC_VERTEX_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY')
  $result=Invoke-WithTemporaryEnvironment -SetValues @{} -ClearNames $clear -Action { Invoke-External -Exe $Exe -ArgumentList @('-p','"Return exactly TIGERIQ_CLAUDE_READY"') -Timeout $TimeoutSeconds }
  $result.subscriptionAuth=$true
  return $result
}

function Invoke-OpenRouterFreeProbe {
  $key=[Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','Process')
  if([string]::IsNullOrWhiteSpace($key)){ return [ordered]@{exitCode=4;timeout=$false;output='';error='OPENROUTER_KEY_MISSING'} }
  try {
    $headers=@{ Authorization=('Bearer '+$key); 'Content-Type'='application/json' }
    $body=@{ model='openrouter/free'; messages=@(@{role='user';content='Return exactly TIGERIQ_OPENROUTER_FREE_READY'}); max_tokens=20 } | ConvertTo-Json -Depth 5
    $job=Start-Job -ScriptBlock { param($h,$b) Invoke-RestMethod -Method Post -Uri 'https://openrouter.ai/api/v1/chat/completions' -Headers $h -Body $b -TimeoutSec 30 | ConvertTo-Json -Depth 8 } -ArgumentList $headers,$body
    if(-not(Wait-Job $job -Timeout $TimeoutSeconds)){ Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue; return [ordered]@{exitCode=$null;timeout=$true;output='';error='TIMEOUT'} }
    $raw=(Receive-Job $job -ErrorAction SilentlyContinue | Out-String); Remove-Job $job -Force -ErrorAction SilentlyContinue
    $validation=Test-OpenRouterFreeResponse $raw 'TIGERIQ_OPENROUTER_FREE_READY'
    if(-not $validation.ok){ return [ordered]@{exitCode=8;timeout=$false;output='';error=[string]$validation.error} }
    return [ordered]@{exitCode=0;timeout=$false;output=("TIGERIQ_OPENROUTER_FREE_READY model={0} cost=0" -f (Sanitize ([string]$validation.model)));error='' }
  } catch { return [ordered]@{exitCode=6;timeout=$false;output='';error=(Sanitize $_.Exception.Message)} }
}

function Assert-True([bool]$Condition,[string]$Name){ if(-not $Condition){ throw "SELFTEST_FAIL:$Name" } }

function Run-SelfTest {
  foreach($sample in @(
    'Authorization: Bearer abc.def.ghi',
    'password: supersecret',
    'https://user:pass@example.com/path',
    '{"private_key":"DO_NOT_PRINT"}',
    "-----BEGIN PRIVATE KEY-----`nABCDEF`n-----END PRIVATE KEY-----",
    'sk-or-v1-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
    'sk-ant-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
    'AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
    'ya29.ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
    'eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop'
  )){
    $safe=Sanitize $sample
    Assert-True (-not($safe -match 'abc\.def\.ghi|supersecret|user:pass|DO_NOT_PRINT|ABCDEF|sk-or-v1-|sk-ant-|AIza|ghp_|ya29\.|eyJabcdefghijk')) 'redaction'
  }

  $free='{"model":"meta-llama/example:free","choices":[{"message":{"content":"TIGERIQ_OPENROUTER_FREE_READY"}}],"usage":{"cost":0}}'
  $nonFree='{"model":"paid/model","choices":[{"message":{"content":"TIGERIQ_OPENROUTER_FREE_READY"}}],"usage":{"cost":0}}'
  $missingCost='{"model":"meta-llama/example:free","choices":[{"message":{"content":"TIGERIQ_OPENROUTER_FREE_READY"}}],"usage":{}}'
  $paid='{"model":"meta-llama/example:free","choices":[{"message":{"content":"TIGERIQ_OPENROUTER_FREE_READY"}}],"usage":{"cost":0.001}}'
  Assert-True ([bool](Test-OpenRouterFreeResponse $free 'TIGERIQ_OPENROUTER_FREE_READY').ok) 'openrouter_free_cost_zero_accept'
  Assert-True ((Test-OpenRouterFreeResponse $nonFree 'TIGERIQ_OPENROUTER_FREE_READY').error -eq 'OPENROUTER_NONFREE_MODEL') 'openrouter_nonfree_reject'
  Assert-True ((Test-OpenRouterFreeResponse $missingCost 'TIGERIQ_OPENROUTER_FREE_READY').error -eq 'OPENROUTER_COST_UNPROVEN') 'openrouter_missing_cost_reject'
  Assert-True ((Test-OpenRouterFreeResponse $paid 'TIGERIQ_OPENROUTER_FREE_READY').error -eq 'OPENROUTER_COST_NONZERO') 'openrouter_nonzero_cost_reject'

  Assert-True (Test-ClaudeSubscriptionStatus '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}') 'claude_subscription_accept'
  Assert-True (-not(Test-ClaudeSubscriptionStatus '{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty","subscriptionType":"max"}')) 'claude_api_auth_reject'
  Assert-True (Test-GeminiConfigHasBillingRoute '{"security":{"auth":{"selectedType":"gemini-api-key"}}}') 'gemini_config_api_route_detect'
  Assert-True (Test-GeminiConfigHasBillingRoute '{"security":{"auth":{"selectedType":"vertex-ai"}}}') 'gemini_config_vertex_route_detect'
  Assert-True (-not(Test-GeminiConfigHasBillingRoute '{"security":{"auth":{"selectedType":"oauth-personal"}}}')) 'gemini_account_route_allow'
  Assert-True (-not [bool]$ClaudeNoUsageCreditsVerified) 'claude_usage_credits_unverified_by_default'

  $oldGeminiKey=[Environment]::GetEnvironmentVariable('GEMINI_API_KEY','Process')
  $oldAnthropicKey=[Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','Process')
  try {
    [Environment]::SetEnvironmentVariable('GEMINI_API_KEY','SELFTEST_BLOCK','Process')
    $geminiBlocked=Invoke-GeminiSubscriptionProbe 'SHOULD_NOT_EXECUTE.exe'
    Assert-True ($geminiBlocked.exitCode -eq 2 -and $geminiBlocked.error -match '^BILLING_ROUTE_BLOCKED') 'gemini_billing_route_refusal'

    [Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY','SELFTEST_BLOCK','Process')
    $claudeBlocked=Invoke-ClaudeSubscriptionProbe 'SHOULD_NOT_EXECUTE.exe'
    Assert-True ($claudeBlocked.exitCode -eq 2 -and $claudeBlocked.error -match '^BILLING_ROUTE_BLOCKED') 'claude_billing_route_refusal'
  } finally {
    [Environment]::SetEnvironmentVariable('GEMINI_API_KEY',$oldGeminiKey,'Process')
    [Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY',$oldAnthropicKey,'Process')
  }

  $shell=Resolve-Tool @('powershell.exe','pwsh.exe','pwsh')
  if($shell){
    $timed=Invoke-External -Exe $shell -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 2') -Timeout 1
    Assert-True ([bool]$timed.timeout) 'bounded_timeout_kill'
  }

  [ordered]@{selfTest='PASS';billingRouteDenial='PASS';timeoutKill='PASS';openRouterModel='openrouter/free';openRouterResponseCostMustBeZero=$true;geminiApiPaidFallback=$false;claudeUsageCreditsRequiredProof=$true;timestampUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json
}

if($SelfTest){ Run-SelfTest; exit 0 }

$gemini=New-StaticResult -Name 'gemini' -CommandNames @('gemini.cmd','gemini.exe','gemini') -VersionArgs @('--version')
$claude=New-StaticResult -Name 'claude' -CommandNames @('claude.exe','claude.cmd','claude') -VersionArgs @('--version')
$ollama=New-StaticResult -Name 'ollama' -CommandNames @('ollama.exe','ollama') -VersionArgs @('--version')
$git=New-StaticResult -Name 'git' -CommandNames @('git.exe','git') -VersionArgs @('--version')
$openrouter=[ordered]@{name='openrouter';installed=$true;versionOk=$true;liveTested=$false;liveOk=$false;status=if([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','Process'))){'KEY_MISSING'}else{'CONFIGURED_FREE_ONLY'};model='openrouter/free'}

if($Live -and $gemini.installed -and $gemini.versionOk){ Set-LiveResult -Result $gemini -LiveResult (Invoke-GeminiSubscriptionProbe $gemini.path) -ExpectedMarker 'TIGERIQ_GEMINI_READY' }
if($Live -and $claude.installed -and $claude.versionOk){ Set-LiveResult -Result $claude -LiveResult (Invoke-ClaudeSubscriptionProbe $claude.path) -ExpectedMarker 'TIGERIQ_CLAUDE_READY' }
if($Live -and $openrouter.status -eq 'CONFIGURED_FREE_ONLY'){ Set-LiveResult -Result $openrouter -LiveResult (Invoke-OpenRouterFreeProbe) -ExpectedMarker 'TIGERIQ_OPENROUTER_FREE_READY' }

$readyProviders=@(@($gemini,$claude,$openrouter)|Where-Object{$_.status -eq 'READY'})
$summary=[ordered]@{
  probeCompleted=$true
  live=[bool]$Live
  subscriptionReady=([bool]$Live -and $readyProviders.Count -gt 0)
  timestampUtc=[DateTime]::UtcNow.ToString('o')
  tools=@($gemini,$claude,$openrouter,$ollama,$git)
  readyCount=$readyProviders.Count
  policy=[ordered]@{ billingMode='ZERO_COST_ONLY'; openRouterModel='openrouter/free'; openRouterResponseCostMustBeZero=$true; geminiApiKeyRoute='DISABLED'; claudeUsageCredits='REQUIRE_EXTERNAL_DISABLED_PROOF'; paidFallback=$false }
  note=if($Live){'Live mode allows Gemini Google-account login and OpenRouter openrouter/free only; OpenRouter is READY only when the returned model is :free and response usage.cost is exactly 0. Claude is blocked unless no-usage-credit status was externally verified and the explicit switch is supplied. Any metered/provider route fails closed. Local Ollama remains zero-cost fallback.'}else{'Static probe only. Real provider calls require PC01/runtime credentials; unknown billing routes fail closed.'}
}
$summary | ConvertTo-Json -Depth 7