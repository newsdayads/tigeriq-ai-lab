# TIGERIQ_COMMAND_CENTER_UPDATER_V3
param(
  [string]$Repo = 'newsdayads/tigeriq-ai-lab',
  [string]$Branch = 'wo250/command-center-artifact-updater-v3',
  [string]$HostIp = '100.97.23.87',
  [int]$Port = 8787
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$runtimeDir = 'F:\TigerIQ\CommandCenter'
$releaseRoot = Join-Path $runtimeDir 'releases-v3'
$currentPath = Join-Path $runtimeDir 'current-release.txt'
$statePath = Join-Path $runtimeDir 'updater-v3-state.json'
$secretPath = 'F:\TigerIQ\Secrets\command-center.secret'
$tokenPath = 'F:\TigerIQ\Secrets\github-command-center.token'
$taskName = 'TigerIQ Command Center'
$mutex = New-Object Threading.Mutex($false,'Global\TigerIQCommandCenterUpdaterV3')
$locked = $false

function Save-State([hashtable]$data) {
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  $data.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  $tmp = "$statePath.tmp"
  [IO.File]::WriteAllText($tmp,($data | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
  Move-Item -Force -LiteralPath $tmp -Destination $statePath
}
function Resolve-Tool([string]$name,[string[]]$candidates=@()) {
  $found = Get-Command $name -ErrorAction SilentlyContinue
  if($found){ return $found.Source }
  foreach($candidate in $candidates){ if(Test-Path -LiteralPath $candidate){ return $candidate } }
  throw "TOOL_MISSING:$name"
}
function Wait-Health([string]$url,[int]$seconds=40) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5
      if($r.StatusCode -eq 200){ return $true }
    } catch {}
    Start-Sleep -Seconds 2
  } while((Get-Date) -lt $deadline)
  return $false
}
function Free-Port {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
  $listener.Start(); $p = ([Net.IPEndPoint]$listener.LocalEndpoint).Port; $listener.Stop(); return $p
}

try {
  $locked = $mutex.WaitOne(0)
  if(-not $locked){ exit 0 }
  if(-not (Test-Path -LiteralPath $secretPath)){ throw 'COMMAND_SECRET_MISSING' }
  if(-not (Test-Path -LiteralPath $tokenPath)){ throw 'GITHUB_TOKEN_MISSING' }
  $gh = Resolve-Tool 'gh.exe' @('C:\Program Files\GitHub CLI\gh.exe')
  $node = Resolve-Tool 'node.exe' @('C:\Program Files\nodejs\node.exe')
  $npm = Resolve-Tool 'npm.cmd' @('C:\Program Files\nodejs\npm.cmd')

  $env:GH_TOKEN = [IO.File]::ReadAllText($tokenPath).Trim()
  if(-not $env:GH_TOKEN){ throw 'GITHUB_TOKEN_EMPTY' }
  $encoded = [uri]::EscapeDataString($Branch)
  $runsRaw = (& $gh api "repos/$Repo/actions/workflows/command-center-release.yml/runs?branch=$encoded&status=success&per_page=1" | Out-String)
  if($LASTEXITCODE -ne 0 -or -not $runsRaw){ throw 'RELEASE_RUN_QUERY_FAILED' }
  $runs = $runsRaw | ConvertFrom-Json
  $run = @($runs.workflow_runs)[0]
  if(-not $run){ Save-State @{result='WAIT_RELEASE'; branch=$Branch}; exit 0 }
  $sha = [string]$run.head_sha
  $runId = [string]$run.id
  if($sha -notmatch '^[0-9a-f]{40}$'){ throw 'INVALID_RELEASE_SHA' }

  $current = if(Test-Path -LiteralPath $currentPath){ [IO.File]::ReadAllText($currentPath).Trim() } else { '' }
  if($current -and (Split-Path -Leaf $current) -eq $sha){ Save-State @{result='NO_CHANGE'; installedSha=$sha; runId=$runId}; exit 0 }

  $stage = Join-Path $env:TEMP ("TigerIQ-CC-v3-" + $sha.Substring(0,12) + '-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $stage,$releaseRoot | Out-Null
  & $gh run download $runId --repo $Repo --name 'command-center-bundle' --dir $stage
  if($LASTEXITCODE -ne 0){ throw 'ARTIFACT_DOWNLOAD_FAILED' }
  $manifestPath = Join-Path $stage 'manifest.json'
  $bundlePath = Join-Path $stage 'command-center.zip'
  if(-not (Test-Path $manifestPath) -or -not (Test-Path $bundlePath)){ throw 'ARTIFACT_INCOMPLETE' }
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  if([string]$manifest.sourceSha -ne $sha){ throw 'MANIFEST_SHA_MISMATCH' }
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundlePath).Hash.ToLowerInvariant()
  if($actualHash -ne ([string]$manifest.bundleSha256).ToLowerInvariant()){ throw 'BUNDLE_HASH_MISMATCH' }

  $releaseDir = Join-Path $releaseRoot $sha
  if(Test-Path -LiteralPath $releaseDir){ Remove-Item -Recurse -Force -LiteralPath $releaseDir }
  New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
  Expand-Archive -LiteralPath $bundlePath -DestinationPath $releaseDir -Force
  $entry = Join-Path $releaseDir ([string]$manifest.entry)
  if(-not (Test-Path -LiteralPath $entry)){ throw 'ENTRY_MISSING' }
  Push-Location $releaseDir
  try {
    & $npm ci --omit=dev --ignore-scripts --no-audit --no-fund
    if($LASTEXITCODE -ne 0){ throw 'RUNTIME_DEPENDENCY_INSTALL_FAILED' }
  } finally { Pop-Location }

  $testPort = Free-Port
  $env:TIGERIQ_COMMAND_SECRET = [IO.File]::ReadAllText($secretPath).Trim()
  $env:TIGERIQ_COMMAND_HOST = '127.0.0.1'
  $env:TIGERIQ_COMMAND_PORT = [string]$testPort
  $env:TIGERIQ_JOURNAL = 'F:\TigerIQ\State\control-plane.jsonl'
  $env:TIGERIQ_REPO_ROOT = $releaseDir
  $env:TIGERIQ_REPO = $Repo
  $candidateOut = Join-Path $stage 'candidate.out.log'
  $candidateErr = Join-Path $stage 'candidate.err.log'
  $candidate = Start-Process -FilePath $node -ArgumentList @($entry) -WorkingDirectory $releaseDir -PassThru -WindowStyle Hidden -RedirectStandardOutput $candidateOut -RedirectStandardError $candidateErr
  $candidateOk = Wait-Health "http://127.0.0.1:$testPort/api/status" 45
  if(-not $candidate.HasExited){ Stop-Process -Id $candidate.Id -Force -ErrorAction SilentlyContinue }
  if(-not $candidateOk){ throw 'CANDIDATE_HEALTH_FAILED' }

  $previous = $current
  $tmpPointer = "$currentPath.tmp"
  [IO.File]::WriteAllText($tmpPointer,$releaseDir,(New-Object Text.UTF8Encoding($false)))
  Move-Item -Force -LiteralPath $tmpPointer -Destination $currentPath
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if(-not (Wait-Health "http://$HostIp`:$Port/api/status" 50)) {
    if($previous){ [IO.File]::WriteAllText($currentPath,$previous,(New-Object Text.UTF8Encoding($false))) }
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    throw 'LIVE_HEALTH_FAILED_ROLLED_BACK'
  }

  $keep = @(Get-ChildItem -LiteralPath $releaseRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 3 | ForEach-Object FullName)
  Get-ChildItem -LiteralPath $releaseRoot -Directory | Where-Object { $keep -notcontains $_.FullName -and $_.FullName -ne $releaseDir -and $_.FullName -ne $previous } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Save-State @{result='UPDATED'; installedSha=$sha; releaseDir=$releaseDir; previous=$previous; runId=$runId; deployment='artifact-pull-atomic-switch'; gitUsed=$false}
  exit 0
}
catch {
  try { Save-State @{result='FAILED'; error=$_.Exception.Message; deployment='artifact-pull-atomic-switch'; gitUsed=$false} } catch {}
  exit 1
}
finally {
  Remove-Item Env:GH_TOKEN,Env:TIGERIQ_COMMAND_SECRET -ErrorAction SilentlyContinue
  if($locked){ $mutex.ReleaseMutex() | Out-Null }
  $mutex.Dispose()
}
