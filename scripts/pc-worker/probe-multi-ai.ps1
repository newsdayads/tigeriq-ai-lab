param(
  [switch]$Live,
  [switch]$SelfTest,
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
      return [ordered]@{ exitCode = $null; timeout = $true; output = ''; error = 'TIMEOUT' }
    }
    $outText = if (Test-Path $stdout) { [IO.File]::ReadAllText($stdout) } else { '' }
    $errText = if (Test-Path $stderr) { [IO.File]::ReadAllText($stderr) } else { '' }
    return [ordered]@{
      exitCode = $p.ExitCode
      timeout = $false
      output = (Sanitize $outText)
      error = (Sanitize $errText)
    }
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
  if (-not $exe) {
    return [ordered]@{ name=$Name; installed=$false; versionOk=$false; liveTested=$false; liveOk=$false; status='NOT_INSTALLED' }
  }
  $version = Invoke-External -Exe $exe -ArgumentList $VersionArgs -Timeout ([Math]::Min($TimeoutSeconds, 15))
  return [ordered]@{
    name = $Name
    installed = $true
    path = $exe
    versionOk = (-not $version.timeout -and $version.exitCode -eq 0)
    version = if ($version.output) { $version.output } else { $version.error }
    liveTested = $false
    liveOk = $false
    status = if ($version.timeout) { 'VERSION_TIMEOUT' } elseif ($version.exitCode -eq 0) { 'INSTALLED' } else { 'VERSION_ERROR' }
  }
}

function Set-LiveResult([System.Collections.IDictionary]$Result, [System.Collections.IDictionary]$LiveResult, [string]$ExpectedMarker) {
  $Result.liveTested = $true
  $combined = (([string]$LiveResult.output) + "`n" + ([string]$LiveResult.error)).Trim()
  $markerOk = $combined -match [regex]::Escape($ExpectedMarker)
  $Result.liveOk = (-not $LiveResult.timeout -and $LiveResult.exitCode -eq 0 -and $markerOk)
  $Result.status = if ($LiveResult.timeout) {
    'LIVE_TIMEOUT'
  } elseif ($Result.liveOk) {
    'READY'
  } elseif ($LiveResult.exitCode -ne 0) {
    if ($combined -match '^BILLING_ROUTE_BLOCKED|CLAUDE_SUBSCRIPTION_AUTH_UNPROVEN') { 'BILLING_ROUTE_BLOCKED' } else { 'AUTH_OR_INVOCATION_ERROR' }
  } else {
    'UNEXPECTED_RESPONSE'
  }
  $Result.liveOutput = Sanitize $combined
}

function Get-ClaudeBillingRouteBlockers {
  $blockedEnv = @(
    'ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL',
    'ANTHROPIC_BEDROCK_BASE_URL','ANTHROPIC_VERTEX_BASE_URL',
    'CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'
  )
  $hits = @()
  foreach ($name in $blockedEnv) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) { $hits += "ENV:$name" }
  }

  $activeConfig = Join-Path $HOME '.config\anthropic\active_config'
  if (Test-Path $activeConfig) { $hits += 'CONFIG:ANTHROPIC_ACTIVE_PROFILE' }

  $settingsPaths = @(
    (Join-Path $HOME '.claude\settings.json'),
    (Join-Path (Get-Location).Path '.claude\settings.json'),
    (Join-Path (Get-Location).Path '.claude\settings.local.json')
  ) | Select-Object -Unique
  foreach ($path in $settingsPaths) {
    if (-not (Test-Path $path)) { continue }
    $text = [IO.File]::ReadAllText($path)
    if ($text -match '(?i)"apiKeyHelper"|ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)') {
      $hits += 'CONFIG:CLAUDE_NON_SUBSCRIPTION_ROUTE'
    }
  }
  return @($hits | Select-Object -Unique)
}

function Test-ClaudeSubscriptionStatus([string]$JsonText) {
  try {
    $status = $JsonText | ConvertFrom-Json
    $loggedIn = [bool]$status.loggedIn
    $provider = [string]$status.apiProvider
    $authMethod = [string]$status.authMethod
    $subscription = [string]$status.subscriptionType
    return ($loggedIn -and $provider -eq 'firstParty' -and $authMethod -match '^(claude\.ai|oauth_token)$' -and $subscription -match '^(pro|max)$')
  } catch {
    return $false
  }
}

function Invoke-GeminiSubscriptionProbe([string]$Exe) {
  $set = @{ 'GOOGLE_GENAI_USE_GCA' = 'true' }
  $clear = @(
    'GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_GENAI_USE_VERTEXAI','GEMINI_CLI_USE_COMPUTE_ADC',
    'GOOGLE_GEMINI_BASE_URL','GOOGLE_VERTEX_BASE_URL','GOOGLE_APPLICATION_CREDENTIALS'
  )
  return Invoke-WithTemporaryEnvironment -SetValues $set -ClearNames $clear -Action {
    Invoke-External -Exe $Exe -ArgumentList @('-p','"Return exactly TIGERIQ_GEMINI_READY"') -Timeout $TimeoutSeconds
  }
}

function Invoke-ClaudeSubscriptionProbe([string]$Exe) {
  $blockers = @(Get-ClaudeBillingRouteBlockers)
  if ($blockers.Count -gt 0) {
    return [ordered]@{ exitCode=2; timeout=$false; output=''; error=('BILLING_ROUTE_BLOCKED ' + ($blockers -join ',')); subscriptionAuth=$false }
  }

  $auth = Invoke-External -Exe $Exe -ArgumentList @('auth','status') -Timeout ([Math]::Min($TimeoutSeconds, 15))
  if ($auth.timeout -or $auth.exitCode -ne 0 -or -not (Test-ClaudeSubscriptionStatus $auth.output)) {
    return [ordered]@{ exitCode=3; timeout=$false; output=''; error='CLAUDE_SUBSCRIPTION_AUTH_UNPROVEN'; subscriptionAuth=$false }
  }

  $clear = @(
    'ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL',
    'ANTHROPIC_BEDROCK_BASE_URL','ANTHROPIC_VERTEX_BASE_URL',
    'CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'
  )
  $result = Invoke-WithTemporaryEnvironment -SetValues @{} -ClearNames $clear -Action {
    Invoke-External -Exe $Exe -ArgumentList @('-p','"Return exactly TIGERIQ_CLAUDE_READY"') -Timeout $TimeoutSeconds
  }
  $result.subscriptionAuth = $true
  return $result
}

function Assert-True([bool]$Condition, [string]$Name) {
  if (-not $Condition) { throw "SELFTEST_FAIL:$Name" }
}

function Run-SelfTest {
  $samples = @(
    'Authorization: Bearer abc.def.ghi',
    'password: supersecret',
    'https://user:pass@example.com/path',
    '{"private_key":"DO_NOT_PRINT"}',
    "-----BEGIN PRIVATE KEY-----`nABCDEF`n-----END PRIVATE KEY-----"
  )
  foreach ($sample in $samples) {
    $safe = Sanitize $sample
    Assert-True (-not ($safe -match 'abc\.def\.ghi|supersecret|user:pass|DO_NOT_PRINT|ABCDEF')) 'redaction'
  }

  Assert-True (Test-ClaudeSubscriptionStatus '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}') 'claude_subscription_accept'
  Assert-True (-not (Test-ClaudeSubscriptionStatus '{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","subscriptionType":null}')) 'claude_subscription_missing_reject'
  Assert-True (-not (Test-ClaudeSubscriptionStatus '{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty","subscriptionType":"max"}')) 'claude_api_auth_reject'

  $old = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY', 'Process')
  try {
    [Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY', 'SELFTEST_VALUE_NOT_SECRET', 'Process')
    Assert-True (@(Get-ClaudeBillingRouteBlockers) -contains 'ENV:ANTHROPIC_API_KEY') 'billing_env_block'
  } finally {
    [Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY', $old, 'Process')
  }

  $shell = Resolve-Tool @('powershell.exe','pwsh.exe','pwsh')
  if ($shell) {
    $timed = Invoke-External -Exe $shell -ArgumentList @('-NoProfile','-Command','"Start-Sleep -Seconds 2"') -Timeout 1
    Assert-True ([bool]$timed.timeout) 'timeout'
  }

  [ordered]@{ selfTest='PASS'; timestampUtc=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
}

if ($SelfTest) {
  Run-SelfTest
  exit 0
}

$gemini = New-StaticResult -Name 'gemini' -CommandNames @('gemini.cmd','gemini.exe','gemini') -VersionArgs @('--version')
$claude = New-StaticResult -Name 'claude' -CommandNames @('claude.exe','claude.cmd','claude') -VersionArgs @('--version')
$ollama = New-StaticResult -Name 'ollama' -CommandNames @('ollama.exe','ollama') -VersionArgs @('--version')
$git = New-StaticResult -Name 'git' -CommandNames @('git.exe','git') -VersionArgs @('--version')

if ($Live -and $gemini.installed -and $gemini.versionOk) {
  Set-LiveResult -Result $gemini -LiveResult (Invoke-GeminiSubscriptionProbe $gemini.path) -ExpectedMarker 'TIGERIQ_GEMINI_READY'
}
if ($Live -and $claude.installed -and $claude.versionOk) {
  Set-LiveResult -Result $claude -LiveResult (Invoke-ClaudeSubscriptionProbe $claude.path) -ExpectedMarker 'TIGERIQ_CLAUDE_READY'
}

$readyProviders = @(@($gemini, $claude) | Where-Object { $_.status -eq 'READY' })
$summary = [ordered]@{
  probeCompleted = $true
  live = [bool]$Live
  subscriptionReady = ([bool]$Live -and $readyProviders.Count -gt 0)
  timestampUtc = [DateTime]::UtcNow.ToString('o')
  tools = @($gemini, $claude, $ollama, $git)
  readyCount = $readyProviders.Count
  note = if ($Live) {
    'Live mode permits only forced Gemini Google-account auth and independently proven Claude Pro/Max first-party subscription auth. Metered/API/gateway routes fail closed.'
  } else {
    'Static probe only. Re-run with -Live on PC01; live mode fails closed before any provider request when subscription-only auth cannot be proven.'
  }
}

$summary | ConvertTo-Json -Depth 6