param(
  [string]$Branch = 'wo196/pc01-command-center-ui-v2',
  [int]$Port = 8787,
  [string]$CommandHost = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = 'newsdayads/tigeriq-ai-lab'
$runtimeDir = 'F:\TigerIQ\CommandCenter'
$releaseRoot = Join-Path $runtimeDir 'releases'
$secretDir = 'F:\TigerIQ\Secrets'
$githubTokenPath = Join-Path $secretDir 'github-command-center.token'
$statePath = Join-Path $runtimeDir 'auto-update-state.json'
$mutexName = 'Global\TigerIQCommandCenterUpdaterV1'
$mutex = New-Object System.Threading.Mutex($false,$mutexName)
$locked = $false

function Read-StateHashtable {
  $result = @{}
  if(-not (Test-Path -LiteralPath $statePath)){ return $result }
  try {
    $object = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    if($null -ne $object){
      foreach($property in $object.PSObject.Properties){
        $result[$property.Name] = $property.Value
      }
    }
  } catch {}
  return $result
}

function Save-State([hashtable]$Data) {
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  $current = Read-StateHashtable
  foreach($key in $Data.Keys){ $current[$key] = $Data[$key] }
  $current['updatedAt'] = (Get-Date).ToUniversalTime().ToString('o')
  $tmp = "$statePath.tmp"
  [IO.File]::WriteAllText($tmp,($current | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
  Move-Item -Force -LiteralPath $tmp -Destination $statePath
}

try {
  $locked = $mutex.WaitOne(0)
  if(-not $locked){ exit 0 }
  if($Port -lt 1024 -or $Port -gt 65535){ throw 'INVALID_PORT' }
  if(-not (Test-Path $githubTokenPath)){ throw 'GITHUB_TOKEN_FILE_MISSING' }
  $token = [IO.File]::ReadAllText($githubTokenPath).Trim()
  if(-not $token){ throw 'GITHUB_TOKEN_EMPTY' }
  $env:GH_TOKEN = $token
  Remove-Variable token -ErrorAction SilentlyContinue

  $encodedBranch = [uri]::EscapeDataString($Branch)
  $head = (& gh api "repos/$repo/commits/$encodedBranch" --jq .sha 2>$null | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$'){ throw 'REMOTE_HEAD_UNAVAILABLE' }

  $state = Read-StateHashtable
  $installedSha = if($state.ContainsKey('installedSha')){ [string]$state['installedSha'] } else { $null }
  if($installedSha -eq $head){
    Save-State @{ lastResult='NO_CHANGE'; lastSeenSha=$head; branch=$Branch }
    exit 0
  }

  $runsRaw = (& gh api "repos/$repo/actions/runs?head_sha=$head&status=completed&per_page=30" 2>$null | Out-String)
  if($LASTEXITCODE -ne 0 -or -not $runsRaw){ throw 'CI_STATUS_UNAVAILABLE' }
  $runs = $runsRaw | ConvertFrom-Json
  $ciPass = @($runs.workflow_runs | Where-Object { $_.name -eq 'CI' -and $_.conclusion -eq 'success' }) | Select-Object -First 1
  if(-not $ciPass){
    Save-State @{ lastResult='WAIT_CI_PASS'; lastSeenSha=$head; branch=$Branch }
    exit 0
  }

  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $short = $head.Substring(0,12)
  $releaseDir = Join-Path $releaseRoot "$short-$stamp"
  New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
  if(Test-Path $releaseDir){ throw 'RELEASE_PATH_EXISTS' }

  $sourcePath = 'scripts/pc-worker/install-command-center.ps1'
  $payload = (& gh api "repos/$repo/contents/$sourcePath`?ref=$head" --jq .content 2>$null | Out-String) -replace '\s',''
  if($LASTEXITCODE -ne 0 -or -not $payload){ throw 'INSTALLER_FETCH_FAILED' }
  $bytes = [Convert]::FromBase64String($payload)
  $text = [Text.Encoding]::UTF8.GetString($bytes)
  $needle = "`$workspace = 'F:\TigerIQ\Workspace\tigeriq-ai-lab'"
  $replacement = "`$workspace = '$releaseDir'"
  if(-not $text.Contains($needle)){ throw 'INSTALLER_LAYOUT_CHANGED' }
  $text = $text.Replace($needle,$replacement)
  $inner = Join-Path $env:TEMP "tigeriq-command-center-update-$short.ps1"
  [IO.File]::WriteAllText($inner,$text,(New-Object Text.UTF8Encoding($false)))

  Save-State @{ lastResult='INSTALLING'; lastSeenSha=$head; branch=$Branch; releaseDir=$releaseDir; ciRunId=$ciPass.id }
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $inner -Branch $Branch -Commit $head -Port $Port -CommandHost $CommandHost
  if($LASTEXITCODE -ne 0){ throw "INSTALL_FAILED_$LASTEXITCODE" }

  Save-State @{ lastResult='UPDATED'; installedSha=$head; lastSeenSha=$head; branch=$Branch; releaseDir=$releaseDir; ciRunId=$ciPass.id }
  exit 0
}
catch {
  try { Save-State @{ lastResult='FAILED'; errorType=$_.Exception.GetType().Name; errorMessage=$_.Exception.Message; branch=$Branch } } catch {}
  exit 1
}
finally {
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  if($locked){ $mutex.ReleaseMutex() | Out-Null }
  $mutex.Dispose()
}
