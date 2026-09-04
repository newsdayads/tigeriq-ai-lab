param(
  [string]$Branch = 'wo196/pc01-command-center-ui-v2',
  [string]$Commit = '',
  [int]$Port = 8787,
  [string]$CommandHost = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Compatibility anchors consumed by the already-installed V2 updater.
# They are intentionally inert in this migration bridge.
$workspace = 'F:\TigerIQ\Workspace\tigeriq-ai-lab'
$compatCiNeedle = 'cmd /c npm run ci'

$repo = 'newsdayads/tigeriq-ai-lab'
$targetBranch = 'wo250/command-center-artifact-updater-v3'
$hostIp = if([string]::IsNullOrWhiteSpace($CommandHost)) { '100.97.23.87' } else { $CommandHost.Trim() }
$runtimeDir = 'F:\TigerIQ\CommandCenter'
$tokenPath = 'F:\TigerIQ\Secrets\github-command-center.token'
$bootstrapPath = Join-Path $env:TEMP 'TigerIQ-install-command-center-updater-v3.ps1'
$statePath = Join-Path $runtimeDir 'updater-v3-state.json'
$evidenceIssue = 252
$updaterTaskName = 'TigerIQ Command Center Updater'

function Fail([string]$Code,[string]$Message) {
  Write-Error "$Code`: $Message"
  exit 1
}

function Resolve-Gh {
  $cmd = Get-Command gh.exe -ErrorAction SilentlyContinue
  if($cmd){ return $cmd.Source }
  $cmd = Get-Command gh -ErrorAction SilentlyContinue
  if($cmd){ return $cmd.Source }
  $candidate = 'C:\Program Files\GitHub CLI\gh.exe'
  if(Test-Path -LiteralPath $candidate){ return $candidate }
  Fail 'GH_MISSING' 'GitHub CLI is unavailable.'
}

Write-Host '[10%] ZERO-TOUCH MIGRATION PRECHECK' -ForegroundColor Cyan
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  Fail 'ADMIN_REQUIRED' 'Migration must run in the existing SYSTEM/elevated updater context.'
}
if($Port -lt 1024 -or $Port -gt 65535){ Fail 'INVALID_PORT' ([string]$Port) }
$gh = Resolve-Gh
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

if(-not $env:GH_TOKEN){
  if(-not (Test-Path -LiteralPath $tokenPath)){ Fail 'GITHUB_TOKEN_MISSING' $tokenPath }
  $env:GH_TOKEN = [IO.File]::ReadAllText($tokenPath).Trim()
}
if(-not $env:GH_TOKEN){ Fail 'GITHUB_TOKEN_EMPTY' 'Existing local GitHub token is empty.' }

# The V2 updater passes the exact old-channel SHA after CI. Refuse any drift.
$sourceEncoded = [uri]::EscapeDataString($Branch)
$head = (& $gh api "repos/$repo/commits/$sourceEncoded" --jq .sha 2>$null | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$'){
  Fail 'SOURCE_HEAD_UNAVAILABLE' $Branch
}
if(-not $Commit){ Fail 'EXACT_COMMIT_REQUIRED' 'Migration bridge requires the V2 updater exact SHA.' }
if($Commit -and $head -ne $Commit){
  Fail 'SOURCE_HEAD_MISMATCH' "Expected $Commit but branch head is $head"
}

Write-Host '[25%] VERIFY V3 RELEASE CHANNEL' -ForegroundColor Cyan
$encoded = [uri]::EscapeDataString($targetBranch)
$targetHead = (& $gh api "repos/$repo/commits/$encoded" --jq .sha 2>$null | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $targetHead -notmatch '^[0-9a-f]{40}$'){
  Fail 'V3_HEAD_UNAVAILABLE' $targetBranch
}
$runsRaw = (& $gh api "repos/$repo/actions/runs?head_sha=$targetHead&status=completed&per_page=30" 2>$null | Out-String)
if($LASTEXITCODE -ne 0 -or -not $runsRaw){ Fail 'V3_CI_QUERY_FAILED' $targetHead }
$runs = $runsRaw | ConvertFrom-Json
$ciPass = @($runs.workflow_runs | Where-Object { $_.name -eq 'CI' -and $_.conclusion -eq 'success' }) | Select-Object -First 1
$bundlePass = @($runs.workflow_runs | Where-Object { $_.name -eq 'Command Center Release Bundle' -and $_.conclusion -eq 'success' }) | Select-Object -First 1
if(-not $ciPass){ Fail 'V3_CI_NOT_PASS' $targetHead }
if(-not $bundlePass){ Fail 'V3_BUNDLE_NOT_PASS' $targetHead }

Write-Host '[40%] FETCH TRUSTED V3 BOOTSTRAP' -ForegroundColor Cyan
$payload = (& $gh api "repos/$repo/contents/scripts/pc-worker/install-command-center-updater-v3.ps1?ref=$targetHead" --jq .content 2>$null | Out-String) -replace '\s',''
if($LASTEXITCODE -ne 0 -or -not $payload){ Fail 'V3_BOOTSTRAP_FETCH_FAILED' $targetHead }
$bootstrapText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
if($bootstrapText -notmatch 'TIGERIQ_COMMAND_CENTER_UPDATER_V3_BOOTSTRAP'){
  Fail 'V3_BOOTSTRAP_MARKER_MISSING' $targetHead
}
[IO.File]::WriteAllText($bootstrapPath,$bootstrapText,(New-Object Text.UTF8Encoding($false)))
Remove-Variable bootstrapText -ErrorAction SilentlyContinue

Write-Host '[55%] INSTALL ARTIFACT UPDATER V3' -ForegroundColor Cyan
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$output = (& $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $bootstrapPath -Repo $repo -Branch $targetBranch -HostIp $hostIp -Port $Port 2>&1 | Out-String)
$bootstrapRc = $LASTEXITCODE
if($bootstrapRc -ne 0){
  $tail = if($output.Length -gt 3000){ $output.Substring($output.Length - 3000) } else { $output }
  Fail 'V3_BOOTSTRAP_FAILED' $tail
}

Write-Host '[80%] VERIFY LIVE V3 STATE' -ForegroundColor Cyan
if(-not (Test-Path -LiteralPath $statePath)){ Fail 'V3_STATE_MISSING' $statePath }
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
if($state.result -ne 'UPDATED' -and $state.result -ne 'NO_CHANGE'){
  Fail 'V3_NOT_READY' ([string]$state.result)
}
$installedSha = [string]$state.installedSha
if($installedSha -notmatch '^[0-9a-f]{40}$'){ Fail 'V3_INSTALLED_SHA_INVALID' $installedSha }

$healthUrl = "http://$hostIp`:$Port/api/status"
try {
  $health = Invoke-RestMethod -UseBasicParsing -Uri $healthUrl -TimeoutSec 15
} catch {
  Fail 'LIVE_HEALTH_FAILED' $healthUrl
}

# Retire the old polling task only after V3 has proved healthy.
Disable-ScheduledTask -TaskName $updaterTaskName -ErrorAction SilentlyContinue | Out-Null

Write-Host '[95%] POST RUNTIME EVIDENCE' -ForegroundColor Cyan
$evidence = @"
TIGERIQ_ZERO_TOUCH_DEPLOY_READY
mode=artifact-pull-v3
installedSha=$installedSha
targetBranch=$targetBranch
health=$healthUrl
v2UpdaterDisabled=true
gitRuntime=false
ownerAction=false
mainProductionChanged=false
"@
& $gh issue comment $evidenceIssue --repo $repo --body $evidence | Out-Null
if($LASTEXITCODE -ne 0){ Fail 'EVIDENCE_COMMENT_FAILED' "issue #$evidenceIssue" }
& $gh issue close $evidenceIssue --repo $repo --reason completed | Out-Null

Write-Host '[100%] ZERO-TOUCH WEB DEPLOY READY' -ForegroundColor Green
[ordered]@{
  status='READY'
  updater='artifact-pull-v3'
  installedSha=$installedSha
  trackedBranch=$targetBranch
  health=$healthUrl
  gitRuntime=$false
  ownerAction=$false
  evidenceIssue=$evidenceIssue
} | ConvertTo-Json -Compress
exit 0
