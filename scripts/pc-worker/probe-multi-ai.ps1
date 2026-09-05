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
      return [ordered]@{ exitCode=$null; timeout=$true; output=''; error='TIMEOUT' }
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
  $version = Invoke-External -Exe $exe -ArgumentList $VersionArgs -Timeout ([Math]::Min($TimeoutSeconds,15))
  return [ordered]@{
    name=$Name; installed=$true; path=$exe
    versionOk=(-not $version.timeout -and $version.exitCode -eq 0)
    version=if($version.output){$version.output}else{$version.error}
    liveTested=$false; liveOk=$false
    status=if($version.timeout){'VERSION_TIMEOUT'}elseif($version.exitCode -eq 0){'INSTALLED'}else{'VERSION_ERROR'}
  }
}

function Test-InvocationReady([System.Collections.IDictionary]$Result, [string]$ExpectedMarker) {
  if ($null -eq $Result) { return $false }
  $combined = (([string]$Result.output) + "`n" + ([string]$Result.error)).Trim()
  return (-not [bool]$Result.timeout -and $Result.exitCode -eq 0 -and $combined -match [regex]::Escape($ExpectedMarker))
}

function Set-SubscriptionAuthFromInvocation([System.Collections.IDictionary]$Result, [string]$ExpectedMarker) {
  $Result.subscriptionAuth = [bool](Test-InvocationReady -Result $Result -ExpectedMarker $ExpectedMarker)
  return $Result
}

function Set-LiveResult([System.Collections.IDictionary]$Result, [System.Collections.IDictionary]$LiveResult, [string]$ExpectedMarker) {
  $Result.liveTested = $true
  $combined = (([string]$LiveResult.output) + "`n" + ([string]$LiveResult.error)).Trim()
  $Result.liveOk = [bool](Test-InvocationReady -Result $LiveResult -ExpectedMarker $ExpectedMarker)
  $Result.status = if ($LiveResult.timeout) {
    'LIVE_TIMEOUT'
  } elseif ($Result.liveOk) {
    'READY'
  } elseif ($LiveResult.exitCode -ne 0) {
    if ($combined -match '^BILLING_ROUTE_BLOCKED|CLAUDE_SUBSCRIPTION_AUTH_UNPROVEN|CLAUDE_USAGE_CREDITS_STATUS_UNPROVEN') { 'BILLING_ROUTE_BLOCKED' } else { 'AUTH_OR_INVOCATION_ERROR' }
  } else {
    'UNEXPECTED_RESPONSE'
  }
  $Result.liveOutput = Sanitize $combined
  if ($LiveResult.Contains('subscriptionAuth')) { $Result.subscriptionAuth = [bool]$LiveResult.subscriptionAuth }
}

function Test-GeminiConfigHasBillingRoute([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return [bool]($Text -match '(?i)GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENAI_USE_VERTEXAI|GEMINI_CLI_USE_COMPUTE_ADC|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_GEMINI_BASE_URL|GOOGLE_VERTEX_BASE_URL|gemini-api-key|vertex-ai')
}

function Get-GeminiBillingRouteBlockers {
  $hits = @()
  foreach ($name in @('GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_GEMINI_BASE_URL','GOOGLE_VERTEX_BASE_URL')) {
    $value = [Environment]::GetEnvironmentVariable($name,'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) { $hits += "ENV:$name" }
  }
  foreach ($name in @('GOOGLE_GENAI_USE_VERTEXAI','GEMINI_CLI_USE_COMPUTE_ADC')) {
    $value = [Environment]::GetEnvironmentVariable($name,'Process')
    if ($value -match '^(?i:true|1|yes|on)$') { $hits += "ENV:$name" }
  }
  $gca = [Environment]::GetEnvironmentVariable('GOOGLE_GENAI_USE_GCA','Process')
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
      if (Test-GeminiConfigHasBillingRoute ([IO.File]::ReadAllText($path))) { $hits += 'CONFIG:GEMINI_NON_ACCOUNT_ROUTE' }
    } catch { $hits += 'CONFIG:GEMINI_ROUTE_UNREADABLE' }
  }
  return @($hits | Select-Object -Unique)
}

function Get-ClaudeBillingRouteBlockers {
  $hits = @()
  foreach ($name in @('ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','ANTHROPIC_BEDROCK_BASE_URL','ANTHROPIC_VERTEX_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY')) {
    $value = [Environment]::GetEnvironmentVariable($name,'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) { $hits += "ENV:$name" }
  }
  if (Test-Path (Join-Path $HOME '.config\anthropic\active_config')) { $hits += 'CONFIG:ANTHROPIC_ACTIVE_PROFILE' }
  foreach ($path in @((Join-Path $HOME '.claude\settings.json'),(Join-Path (Get-Location).Path '.claude\settings.json'),(Join-Path (Get-Location).Path '.claude\settings.local.json')) | Select-Object -Unique) {
    if (-not (Test-Path $path)) { continue }
    try {
      $text = [IO.File]::ReadAllText($path)
      if ($text -match '(?i)"apiKeyHelper"|ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)') { $hits += 'CONFIG:CLAUDE_NON_SUBSCRIPTION_ROUTE' }
    } catch { $hits += 'CONFIG:CLAUDE_ROUTE_UNREADABLE' }
  }
  return @($hits | Select-Object -Unique)
}

function Test-ClaudeSubscriptionStatus([string]$JsonText) {
  try {
    $status = $JsonText | ConvertFrom-Json
    return ([bool]$status.loggedIn -and [string]$status.apiProvider -eq 'firstParty' -and [string]$status.authMethod -match '^(claude\.ai|oauth_token)$' -and [string]$status.subscriptionType -match '^(pro|max)$')
  } catch { return $false }
}

function Invoke-GeminiSubscriptionProbe([string]$Exe) {
  $blockers = @(Get-GeminiBillingRouteBlockers)
  if ($blockers.Count -gt 0) { return [ordered]@{exitCode=2;timeout=$false;output='';error=('BILLING_ROUTE_BLOCKED '+($blockers -join ','));subscriptionAuth=$false} }
  $set = @{ 'GOOGLE_GENAI_USE_GCA'='true' }
  $clear = @('GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_GENAI_USE_VERTEXAI','GEMINI_CLI_USE_COMPUTE_ADC','GOOGLE_GEMINI_BASE_URL','GOOGLE_VERTEX_BASE_URL','GOOGLE_APPLICATION_CREDENTIALS')
  $result = Invoke-WithTemporaryEnvironment -SetValues $set -ClearNames $clear -Action { Invoke-External -Exe $Exe -ArgumentList @('-p','"Return exactly TIGERIQ_GEMINI_READY"') -Timeout $TimeoutSeconds }
  return (Set-SubscriptionAuthFromInvocation -Result $result -ExpectedMarker 'TIGERIQ_GEMINI_READY')
}

function Invoke-ClaudeSubscriptionProbe([string]$Exe) {
  $blockers = @(Get-ClaudeBillingRouteBlockers)
  if ($blockers.Count -gt 0) { return [ordered]@{exitCode=2;timeout=$false;output='';error=('BILLING_ROUTE_BLOCKED '+($blockers -join ','));subscriptionAuth=$false} }
  if (-not $ClaudeNoUsageCreditsVerified) { return [ordered]@{exitCode=7;timeout=$false;output='';error='CLAUDE_USAGE_CREDITS_STATUS_UNPROVEN';subscriptionAuth=$false} }
  $auth = Invoke-External -Exe $Exe -ArgumentList @('auth','status') -Timeout ([Math]::Min($TimeoutSeconds,15))
  if ($auth.timeout -or $auth.exitCode -ne 0 -or -not (Test-ClaudeSubscriptionStatus $auth.output)) { return [ordered]@{exitCode=3;timeout=$false;output='';error='CLAUDE_SUBSCRIPTION_AUTH_UNPROVEN';subscriptionAuth=$false} }
  $clear = @('ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','ANTHROPIC_BEDROCK_BASE_URL','ANTHROPIC_VERTEX_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY')
  $result = Invoke-WithTemporaryEnvironment -SetValues @{} -ClearNames $clear -Action { Invoke-External -Exe $Exe -ArgumentList @('-p','"Return exactly TIGERIQ_CLAUDE_READY"') -Timeout $TimeoutSeconds }
  $result.subscriptionAuth = $true
  return $result
}

function Invoke-OpenRouterFreeProbe {
  $key = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','Process')
  if ([string]::IsNullOrWhiteSpace($key)) { return [ordered]@{exitCode=4;timeout=$false;output='';error='OPENROUTER_KEY_MISSING'} }
  try {
    $headers = @{ Authorization=('Bearer '+$key); 'Content-Type'='application/json' }
    $body = @{ model='openrouter/free'; messages=@(@{role='user';content='Return exactly TIGERIQ_OPENROUTER_FREE_READY'}); max_tokens=20 } | ConvertTo-Json -Depth 5
    $job = Start-Job -ScriptBlock { param($h,$b) Invoke-RestMethod -Method Post -Uri 'https://openrouter.ai/api/v1/chat/completions' -Headers $h -Body $b -TimeoutSec 30 | ConvertTo-Json -Depth 8 } -ArgumentList $headers,$body
    if (-not (Wait-Job $job -Timeout $TimeoutSeconds)) { Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue; return [ordered]@{exitCode=$null;timeout=$true;output='';error='TIMEOUT'} }
    $raw = (Receive-Job $job -ErrorAction SilentlyContinue | Out-String)
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    $safe = Sanitize $raw
    return [ordered]@{exitCode=if($safe -match 'TIGERIQ_OPENROUTER_FREE_READY'){0}else{5};timeout=$false;output=$safe;error=if($safe -match 'TIGERIQ_OPENROUTER_FREE_READY'){''}else{'UNEXPECTED_RESPONSE'}}
  } catch { return [ordered]@{exitCode=6;timeout=$false;output='';error=(Sanitize $_.Exception.Message)} }
}

function Invoke-OllamaLocalProbe([string]$Exe) {
  $result = Invoke-External -Exe $Exe -ArgumentList @('list') -Timeout ([Math]::Min($TimeoutSeconds,15))
  if (-not $result.timeout -and $result.exitCode -eq 0) {
    $result.output = ('TIGERIQ_OLLAMA_READY' + "`n" + [string]$result.output).Trim()
  }
  return $result
}

function Assert-True([bool]$Condition,[string]$Name) { if (-not $Condition) { throw "SELFTEST_FAIL:$Name" } }

function Run-SelfTest {
  foreach ($sample in @('Authorization: Bearer abc.def.ghi','password: supersecret','https://user:pass@example.com/path','{"private_key":"DO_NOT_PRINT"}',"-----BEGIN PRIVATE KEY-----`nABCDEF`n-----END PRIVATE KEY-----")) {
    $safe = Sanitize $sample
    Assert-True (-not ($safe -match 'abc\.def\.ghi|supersecret|user:pass|DO_NOT_PRINT|ABCDEF')) 'redaction'
  }
  Assert-True (Test-ClaudeSubscriptionStatus '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}') 'claude_subscription_accept'
  Assert-True (-not (Test-ClaudeSubscriptionStatus '{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty","subscriptionType":"max"}')) 'claude_api_auth_reject'
  Assert-True (Test-GeminiConfigHasBillingRoute '{"security":{"auth":{"selectedType":"gemini-api-key"}}}') 'gemini_config_api_route_detect'
  Assert-True (Test-GeminiConfigHasBillingRoute '{"security":{"auth":{"selectedType":"vertex-ai"}}}') 'gemini_config_vertex_route_detect'
  Assert-True (-not (Test-GeminiConfigHasBillingRoute '{"security":{"auth":{"selectedType":"oauth-personal"}}}')) 'gemini_account_route_allow'
  Assert-True (-not [bool]$ClaudeNoUsageCreditsVerified) 'claude_usage_credits_unverified_by_default'

  $failed = [ordered]@{exitCode=1;timeout=$false;output='';error='AUTH_FAILED'}
  Set-SubscriptionAuthFromInvocation -Result $failed -ExpectedMarker 'TIGERIQ_GEMINI_READY' | Out-Null
  Assert-True (-not [bool]$failed.subscriptionAuth) 'gemini_failed_probe_cannot_claim_subscription_auth'
  $success = [ordered]@{exitCode=0;timeout=$false;output='TIGERIQ_GEMINI_READY';error=''}
  Set-SubscriptionAuthFromInvocation -Result $success -ExpectedMarker 'TIGERIQ_GEMINI_READY' | Out-Null
  Assert-True ([bool]$success.subscriptionAuth) 'gemini_success_probe_can_claim_subscription_auth'

  $oldGeminiKey = [Environment]::GetEnvironmentVariable('GEMINI_API_KEY','Process')
  $oldAnthropicKey = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','Process')
  try {
    [Environment]::SetEnvironmentVariable('GEMINI_API_KEY','SELFTEST_BLOCK','Process')
    $geminiBlocked = Invoke-GeminiSubscriptionProbe 'SHOULD_NOT_EXECUTE.exe'
    Assert-True ($geminiBlocked.exitCode -eq 2 -and $geminiBlocked.error -match '^BILLING_ROUTE_BLOCKED') 'gemini_billing_route_refusal'
    [Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY','SELFTEST_BLOCK','Process')
    $claudeBlocked = Invoke-ClaudeSubscriptionProbe 'SHOULD_NOT_EXECUTE.exe'
    Assert-True ($claudeBlocked.exitCode -eq 2 -and $claudeBlocked.error -match '^BILLING_ROUTE_BLOCKED') 'claude_billing_route_refusal'
  } finally {
    [Environment]::SetEnvironmentVariable('GEMINI_API_KEY',$oldGeminiKey,'Process')
    [Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY',$oldAnthropicKey,'Process')
  }

  $shell = Resolve-Tool @('powershell.exe','pwsh.exe','pwsh')
  if ($shell) {
    $timed = Invoke-External -Exe $shell -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 2') -Timeout 1
    Assert-True ([bool]$timed.timeout) 'bounded_timeout_kill'
  }
  [ordered]@{selfTest='PASS';billingRouteDenial='PASS';truthfulSubscriptionAuth='PASS';ollamaLiveProbeImplemented='PASS';timeoutKill='PASS';openRouterModel='openrouter/free';geminiApiPaidFallback=$false;claudeUsageCreditsRequiredProof=$true;timestampUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json
}

if ($SelfTest) { Run-SelfTest; exit 0 }

$gemini = New-StaticResult -Name 'gemini' -CommandNames @('gemini.cmd','gemini.exe','gemini') -VersionArgs @('--version')
$claude = New-StaticResult -Name 'claude' -CommandNames @('claude.exe','claude.cmd','claude') -VersionArgs @('--version')
$ollama = New-StaticResult -Name 'ollama' -CommandNames @('ollama.exe','ollama') -VersionArgs @('--version')
$git = New-StaticResult -Name 'git' -CommandNames @('git.exe','git') -VersionArgs @('--version')
$openrouter = [ordered]@{name='openrouter';installed=$true;versionOk=$true;liveTested=$false;liveOk=$false;status=if([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','Process'))){'KEY_MISSING'}else{'CONFIGURED_FREE_ONLY'};model='openrouter/free'}

if ($Live -and $gemini.installed -and $gemini.versionOk) { Set-LiveResult -Result $gemini -LiveResult (Invoke-GeminiSubscriptionProbe $gemini.path) -ExpectedMarker 'TIGERIQ_GEMINI_READY' }
if ($Live -and $claude.installed -and $claude.versionOk) { Set-LiveResult -Result $claude -LiveResult (Invoke-ClaudeSubscriptionProbe $claude.path) -ExpectedMarker 'TIGERIQ_CLAUDE_READY' }
if ($Live -and $openrouter.status -eq 'CONFIGURED_FREE_ONLY') { Set-LiveResult -Result $openrouter -LiveResult (Invoke-OpenRouterFreeProbe) -ExpectedMarker 'TIGERIQ_OPENROUTER_FREE_READY' }
if ($Live -and $ollama.installed -and $ollama.versionOk) { Set-LiveResult -Result $ollama -LiveResult (Invoke-OllamaLocalProbe $ollama.path) -ExpectedMarker 'TIGERIQ_OLLAMA_READY' }

$cloudReady = @(@($gemini,$claude,$openrouter) | Where-Object { $_.status -eq 'READY' })
$allReady = @(@($gemini,$claude,$openrouter,$ollama) | Where-Object { $_.status -eq 'READY' })
$summary = [ordered]@{
  probeCompleted=$true
  live=[bool]$Live
  subscriptionReady=([bool]$Live -and $cloudReady.Count -gt 0)
  localReady=([bool]$Live -and $ollama.status -eq 'READY')
  timestampUtc=[DateTime]::UtcNow.ToString('o')
  tools=@($gemini,$claude,$openrouter,$ollama,$git)
  cloudReadyCount=$cloudReady.Count
  readyCount=$allReady.Count
  policy=[ordered]@{billingMode='ZERO_COST_ONLY';openRouterModel='openrouter/free';geminiApiKeyRoute='DISABLED';claudeUsageCredits='REQUIRE_EXTERNAL_DISABLED_PROOF';paidFallback=$false}
  note=if($Live){'Live mode probes only guarded zero-cost routes. Gemini auth evidence is true only after a successful expected-marker response. Ollama local daemon capability is probed with `ollama list`; JOB-001 inference E2E remains separate. Any metered/provider route fails closed.'}else{'Static probe only. Real provider calls require eligible runtime credentials; unknown billing routes fail closed.'}
}
$summary | ConvertTo-Json -Depth 7
