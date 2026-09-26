param(
  [bool]$ActiveMode = $false,
  [int]$Cycles = 3,
  [int]$PollSeconds = 5,
  [string]$HealthUri = 'http://127.0.0.1:8798/api/utility/workers/NV02/health',
  [string]$JobUri = 'http://127.0.0.1:8798/api/utility/workers/NV02/job',
  [string]$ContinuityStatePath = 'D:\TigerIQ\Apps\ChromeController\Runtime\nv02-continuity-state.json',
  [string]$LogPath = 'D:\TigerIQ\Evidence\pad-nv02-watchdog-r1.jsonl',
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NV02Decision {
  param($Health, $Job)

  $hb = $Health.state.lastHeartbeat
  $active = $Job.active
  $state = [string]$Health.state.status
  $identityOk = $false

  if ($active -and $active.issueRef -match '/issues/(\d+)') {
    $expectedPrefix = 'APP-GH-' + $matches[1] + '-NV02-'
    $identityOk =
      ([string]$active.source -eq 'APP_CHROME_SELF_RUN') -and
      ([string]$active.jobId).StartsWith($expectedPrefix)
  }

  $decision = 'READY_NOT_CONTINUABLE'
  $reason = 'identity/state/gate'

  if (-not $Health.ok -or -not $Health.controller -or -not $Health.bridgeOk -or -not $Health.interactiveSession) {
    $decision = 'INFRA_BLOCKED'
    $reason = 'controller/bridge/session'
  } elseif ($Health.state.blocked -or $hb.securityBlock -or $hb.chatLoadError) {
    $decision = 'SAFETY_BLOCKED'
    $reason = 'worker/security/chat'
  } elseif (
    [string]$hb.modelName -ne 'GPT-5.6 Sol' -or
    [string]$hb.reasoningEffort -ne 'High' -or
    $hb.modelExact -ne $true -or
    $hb.modelReady -ne $true
  ) {
    $decision = 'MODEL_BLOCKED'
    $reason = 'exact-model-profile-required'
  } elseif ($state -eq 'WORKING' -or $hb.uiBusy -eq $true -or $hb.stopVisible -eq $true) {
    $decision = 'WORKING_NO_ACTION'
    $reason = ''
  } elseif (
    $state -eq 'READY' -and
    $hb.uiBusy -eq $false -and
    $hb.sendReady -eq $true -and
    $identityOk -and
    @('SUBMITTED','WORKING','WAITING_EVIDENCE','VERIFY') -contains [string]$active.stage
  ) {
    $decision = 'READY_CONTINUABLE'
    $reason = ''
  }

  [pscustomobject]@{
    state = $state
    heartbeat = $hb
    active = $active
    identityOk = $identityOk
    decision = $decision
    reason = $reason
  }
}

function Set-NV02ContinuationDue {
  param($Decision)

  if (-not (Test-Path -LiteralPath $ContinuityStatePath)) {
    throw "CONTINUITY_STATE_MISSING:$ContinuityStatePath"
  }

  $state = Get-Content -LiteralPath $ContinuityStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  $heartbeatUrl = [string]$Decision.heartbeat.url
  $verifiedChatUrl = [string]$state.verifiedChatUrl

  if (-not $heartbeatUrl -or -not $verifiedChatUrl -or $heartbeatUrl -ne $verifiedChatUrl) {
    throw 'CONTINUITY_CHAT_IDENTITY_MISMATCH'
  }

  $state.nextContinueAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - 1000
  $dir = Split-Path -Parent $ContinuityStatePath
  $tmp = Join-Path $dir ('nv02-continuity-state.pad-' + [guid]::NewGuid().ToString('N') + '.tmp')
  $state | ConvertTo-Json -Depth 12 -Compress | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $ContinuityStatePath -Force
}

function Write-Event {
  param($Decision, [int]$Cycle, [string]$Action, [string]$ActionResult)

  $dir = Split-Path -Parent $LogPath
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $hb = $Decision.heartbeat
  $active = $Decision.active
  [ordered]@{
    ts = (Get-Date).ToString('o')
    cycle = $Cycle
    activeMode = $ActiveMode
    state = $Decision.state
    uiBusy = $hb.uiBusy
    sendReady = $hb.sendReady
    stopVisible = $hb.stopVisible
    model = $hb.modelName
    reasoning = $hb.reasoningEffort
    jobId = $active.jobId
    issueRef = $active.issueRef
    jobStage = $active.stage
    identityOk = $Decision.identityOk
    decision = $Decision.decision
    reason = $Decision.reason
    action = $Action
    actionResult = $ActionResult
  } | ConvertTo-Json -Compress | Add-Content -LiteralPath $LogPath -Encoding UTF8
}

if ($SelfTest) {
  $hbWorking = [pscustomobject]@{
    uiBusy=$true; stopVisible=$true; sendReady=$false; securityBlock=$null; chatLoadError=$false
    modelName='GPT-5.6 Sol'; reasoningEffort='High'; modelExact=$true; modelReady=$true
    url='https://chatgpt.com/g/example/c/test'
  }
  $hWorking = [pscustomobject]@{
    ok=$true; controller=$true; bridgeOk=$true; interactiveSession=$true
    state=[pscustomobject]@{status='WORKING';blocked=$false;lastHeartbeat=$hbWorking}
  }
  $job = [pscustomobject]@{
    active=[pscustomobject]@{
      source='APP_CHROME_SELF_RUN';jobId='APP-GH-1528-NV02-deadbeef'
      issueRef='https://github.com/newsdayads/tigeriq-ai-lab/issues/1528';stage='WAITING_EVIDENCE'
    }
  }
  $d1 = Get-NV02Decision $hWorking $job
  if ($d1.decision -ne 'WORKING_NO_ACTION') { throw "SELFTEST_WORKING_FAILED:$($d1.decision)" }

  $hbReady = $hbWorking.PSObject.Copy()
  $hbReady.uiBusy=$false; $hbReady.stopVisible=$false; $hbReady.sendReady=$true
  $hReady = [pscustomobject]@{
    ok=$true; controller=$true; bridgeOk=$true; interactiveSession=$true
    state=[pscustomobject]@{status='READY';blocked=$false;lastHeartbeat=$hbReady}
  }
  $d2 = Get-NV02Decision $hReady $job
  if ($d2.decision -ne 'READY_CONTINUABLE') { throw "SELFTEST_READY_FAILED:$($d2.decision)" }

  $badJob = [pscustomobject]@{
    active=[pscustomobject]@{
      source='APP_CHROME_SELF_RUN';jobId='APP-GH-9999-NV02-deadbeef'
      issueRef='https://github.com/newsdayads/tigeriq-ai-lab/issues/1528';stage='WAITING_EVIDENCE'
    }
  }
  $d3 = Get-NV02Decision $hReady $badJob
  if ($d3.decision -eq 'READY_CONTINUABLE') { throw 'SELFTEST_IDENTITY_FAILED' }

  Write-Output 'SELFTEST_PASS'
  exit 0
}

for ($i = 1; $i -le $Cycles; $i++) {
  try {
    $health = Invoke-RestMethod -Method Get -Uri $HealthUri -TimeoutSec 3
    $job = Invoke-RestMethod -Method Get -Uri $JobUri -TimeoutSec 3
    $d = Get-NV02Decision $health $job
    $action = 'NONE'
    $actionResult = ''

    if ($d.decision -eq 'READY_CONTINUABLE') {
      if ($ActiveMode) {
        Set-NV02ContinuationDue $d
        $action = 'CONTINUITY_DUE_SET'
        $actionResult = 'BRIDGE_GUARDRAILS_RETAINED'
      } else {
        $action = 'WOULD_SET_CONTINUITY_DUE'
        $actionResult = 'DRY_RUN'
      }
    }

    Write-Event $d $i $action $actionResult
  } catch {
    $fallback = [pscustomobject]@{
      state='ERROR'; heartbeat=[pscustomobject]@{}; active=[pscustomobject]@{}
      identityOk=$false; decision='ERROR'; reason=$_.Exception.Message
    }
    Write-Event $fallback $i 'NONE' 'ERROR'
  }

  if ($i -lt $Cycles) { Start-Sleep -Seconds $PollSeconds }
}

Write-Output 'PAD_NV02_WATCHDOG_DONE'