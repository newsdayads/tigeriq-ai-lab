param(
  [switch]$Live,
  [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Sanitize([string]$Text) {
  if ($null -eq $Text) { return '' }
  $safe = $Text -replace '(?i)(api[_-]?key|token|secret|authorization)\s*[:=]\s*[^\s]+', '$1=REDACTED'
  $safe = $safe.Trim()
  if ($safe.Length -gt 600) { $safe = $safe.Substring(0, 600) + '…' }
  return $safe
}

function Resolve-Tool([string[]]$Names) {
  foreach ($name in $Names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  return $null
}

function Invoke-External([string]$Exe, [string[]]$Args, [int]$Timeout) {
  $stdout = Join-Path $env:TEMP ("tigeriq-probe-out-{0}.txt" -f [guid]::NewGuid().ToString('N'))
  $stderr = Join-Path $env:TEMP ("tigeriq-probe-err-{0}.txt" -f [guid]::NewGuid().ToString('N'))
  try {
    $p = Start-Process -FilePath $Exe -ArgumentList $Args -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
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

function Probe-Tool([string]$Name, [string[]]$CommandNames, [string[]]$VersionArgs, [string[]]$LiveArgs, [string]$ExpectedMarker) {
  $exe = Resolve-Tool $CommandNames
  if (-not $exe) {
    return [ordered]@{ name = $Name; installed = $false; versionOk = $false; liveTested = [bool]$Live; liveOk = $false; status = 'NOT_INSTALLED' }
  }

  $version = Invoke-External $exe $VersionArgs ([Math]::Min($TimeoutSeconds, 15))
  $result = [ordered]@{
    name = $Name
    installed = $true
    path = $exe
    versionOk = (-not $version.timeout -and $version.exitCode -eq 0)
    version = if ($version.output) { $version.output } else { $version.error }
    liveTested = [bool]$Live
    liveOk = $false
    status = if ($version.timeout) { 'VERSION_TIMEOUT' } elseif ($version.exitCode -eq 0) { 'INSTALLED' } else { 'VERSION_ERROR' }
  }

  if ($Live) {
    $liveResult = Invoke-External $exe $LiveArgs $TimeoutSeconds
    $combined = (([string]$liveResult.output) + "`n" + ([string]$liveResult.error)).Trim()
    $markerOk = $combined -match [regex]::Escape($ExpectedMarker)
    $result.liveOk = (-not $liveResult.timeout -and $liveResult.exitCode -eq 0 -and $markerOk)
    $result.status = if ($liveResult.timeout) {
      'LIVE_TIMEOUT'
    } elseif ($result.liveOk) {
      'READY'
    } elseif ($liveResult.exitCode -ne 0) {
      'AUTH_OR_INVOCATION_ERROR'
    } else {
      'UNEXPECTED_RESPONSE'
    }
    $result.liveOutput = Sanitize $combined
  }

  return $result
}

$gemini = Probe-Tool 'gemini' @('gemini.cmd','gemini.exe','gemini') @('--version') @('-p','"Return exactly TIGERIQ_GEMINI_READY"') 'TIGERIQ_GEMINI_READY'
$claude = Probe-Tool 'claude' @('claude.exe','claude.cmd','claude') @('--version') @('-p','"Return exactly TIGERIQ_CLAUDE_READY"') 'TIGERIQ_CLAUDE_READY'
$ollamaExe = Resolve-Tool @('ollama.exe','ollama')
$ollama = if ($ollamaExe) {
  $v = Invoke-External $ollamaExe @('--version') ([Math]::Min($TimeoutSeconds, 15))
  [ordered]@{ name='ollama'; installed=$true; versionOk=(-not $v.timeout -and $v.exitCode -eq 0); version=if($v.output){$v.output}else{$v.error}; liveTested=$false; liveOk=$false; status=if($v.exitCode -eq 0){'INSTALLED'}else{'VERSION_ERROR'} }
} else {
  [ordered]@{ name='ollama'; installed=$false; versionOk=$false; liveTested=$false; liveOk=$false; status='NOT_INSTALLED' }
}
$git = Probe-Tool 'git' @('git.exe','git') @('--version') @('--version') 'git version'

$summary = [ordered]@{
  ok = $true
  live = [bool]$Live
  timestampUtc = [DateTime]::UtcNow.ToString('o')
  tools = @($gemini, $claude, $ollama, $git)
  readyCount = @($gemini, $claude | Where-Object { $_.status -eq 'READY' }).Count
  note = if ($Live) { 'Live probe consumes a minimal Gemini/Claude request only when the CLI is installed. No credential values are printed.' } else { 'Static probe only. Re-run with -Live on PC01 to verify cached login without exposing credentials.' }
}

$summary | ConvertTo-Json -Depth 6
