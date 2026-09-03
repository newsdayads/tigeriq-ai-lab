param(
  [string]$Branch = 'wo196/pc01-command-center-ui-v2',
  [Parameter(Mandatory=$true)][string]$Commit,
  [int]$Port = 8787,
  [Parameter(Mandatory=$true)][string]$CommandHost
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = 'newsdayads/tigeriq-ai-lab'
$runtimeDir = 'F:\TigerIQ\CommandCenter'
$releaseRoot = Join-Path $runtimeDir 'releases'
$secretPath = 'F:\TigerIQ\Secrets\command-center.secret'
$githubTokenPath = 'F:\TigerIQ\Secrets\github-command-center.token'
$startScript = Join-Path $runtimeDir 'start-command-center.ps1'
$stdout = Join-Path $runtimeDir 'command-center.log'
$stderr = Join-Path $runtimeDir 'command-center.err.log'
$taskName = 'TigerIQ Command Center'

function Fail([string]$Code,[string]$Message){ Write-Error "$Code`: $Message"; exit 1 }
function Test-TailscaleIPv4([string]$Address){
  if($Address -notmatch '^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$'){ return $false }
  $parts = $Address.Split('.') | ForEach-Object { [int]$_ }
  return $parts[1] -ge 64 -and $parts[1] -le 127 -and @($parts | Where-Object { $_ -lt 0 -or $_ -gt 255 }).Count -eq 0
}

Write-Host '[10%] PRECHECK' -ForegroundColor Cyan
$id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($id)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){ Fail 'ADMIN_REQUIRED' 'Administrator permission is required.' }
if($Commit -notmatch '^[0-9a-fA-F]{40}$'){ Fail 'INVALID_COMMIT' $Commit }
if(-not (Test-TailscaleIPv4 $CommandHost)){ Fail 'UNSAFE_COMMAND_HOST' $CommandHost }
foreach($path in @($secretPath,$githubTokenPath)){ if(-not(Test-Path -LiteralPath $path)){ Fail 'REQUIRED_PATH_MISSING' $path } }
$git=(Get-Command git.exe -ErrorAction Stop).Source;$gh=(Get-Command gh.exe -ErrorAction Stop).Source;$node=(Get-Command node.exe -ErrorAction Stop).Source;$npm=(Get-Command npm.cmd -ErrorAction Stop).Source;$powershell=(Get-Command powershell.exe -ErrorAction Stop).Source
$null=& $gh auth status;if($LASTEXITCODE -ne 0){ Fail 'GH_AUTH_MISSING' 'GitHub CLI is not authenticated.' }

Write-Host '[20%] EXACT SHA + CI GATE' -ForegroundColor Cyan
$encodedBranch=[uri]::EscapeDataString($Branch)
$remoteHead=(& $gh api "repos/$repo/commits/$encodedBranch" --jq .sha 2>$null | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $remoteHead -ne $Commit){ Fail 'BRANCH_HEAD_MISMATCH' "Expected $Commit; got $remoteHead" }
$runsRaw=(& $gh api "repos/$repo/actions/runs?head_sha=$Commit&status=completed&per_page=30" 2>$null | Out-String)
if($LASTEXITCODE -ne 0 -or -not $runsRaw){ Fail 'CI_STATUS_UNAVAILABLE' 'Could not read CI status.' }
$runs=$runsRaw|ConvertFrom-Json;$ciPass=@($runs.workflow_runs|Where-Object{$_.name -eq 'CI' -and $_.conclusion -eq 'success'})|Select-Object -First 1
if(-not $ciPass){ Fail 'CI_NOT_PASS' "Exact SHA $Commit has no successful CI run." }

Write-Host '[35%] FRESH IMMUTABLE RELEASE' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $releaseRoot,$runtimeDir | Out-Null
$stamp=(Get-Date).ToString('yyyyMMdd-HHmmss');$short=$Commit.Substring(0,12);$releaseDir=Join-Path $releaseRoot "$short-$stamp-ui"
if(Test-Path $releaseDir){ Fail 'RELEASE_PATH_EXISTS' $releaseDir }
& $git clone --no-checkout "https://github.com/$repo.git" $releaseDir
if($LASTEXITCODE -ne 0){ Fail 'CLONE_FAILED' $releaseDir }
& $git config --global --add safe.directory ($releaseDir -replace '\\','/')
if($LASTEXITCODE -ne 0){ Fail 'SAFE_DIRECTORY_FAILED' $releaseDir }
& $git -C $releaseDir fetch origin $Branch --prune
if($LASTEXITCODE -ne 0){ Fail 'FETCH_FAILED' $Branch }
$fetched=(& $git -C $releaseDir rev-parse "origin/$Branch").Trim();if($fetched -ne $Commit){ Fail 'FETCHED_HEAD_MISMATCH' "Expected $Commit; got $fetched" }
& $git -C $releaseDir checkout --detach $Commit
if($LASTEXITCODE -ne 0){ Fail 'CHECKOUT_FAILED' $Commit }

Write-Host '[55%] INSTALL + BUILD' -ForegroundColor Cyan
Push-Location $releaseDir
try {
  & $npm ci --no-audit --no-fund
  if($LASTEXITCODE -ne 0){ Fail 'NPM_CI_FAILED' 'npm ci failed.' }
  & $npm run build
  if($LASTEXITCODE -ne 0){ Fail 'BUILD_FAILED' 'npm run build failed.' }
} finally { Pop-Location }
$entry=Join-Path $releaseDir 'dist\apps\dashboard\src\standalone.js';if(-not(Test-Path $entry)){ Fail 'BUILD_ARTIFACT_MISSING' $entry }

Write-Host '[70%] ATOMIC COMMAND CENTER SWITCH' -ForegroundColor Cyan
$repoEsc=$releaseDir.Replace("'","''");$secretEsc=$secretPath.Replace("'","''");$githubEsc=$githubTokenPath.Replace("'","''");$nodeEsc=$node.Replace("'","''");$outEsc=$stdout.Replace("'","''");$errEsc=$stderr.Replace("'","''")
$launcher=@"
`$ErrorActionPreference='Stop'
`$env:TIGERIQ_COMMAND_SECRET=[IO.File]::ReadAllText('$secretEsc').Trim()
`$env:GH_TOKEN=[IO.File]::ReadAllText('$githubEsc').Trim()
`$env:TIGERIQ_COMMAND_HOST='$CommandHost'
`$env:TIGERIQ_COMMAND_PORT='$Port'
`$env:TIGERIQ_JOURNAL='F:\TigerIQ\State\control-plane.jsonl'
`$env:TIGERIQ_REPO_ROOT='$repoEsc'
`$env:TIGERIQ_REPO='$repo'
Set-Location '$repoEsc'
& '$nodeEsc' 'dist/apps/dashboard/src/standalone.js' 1>> '$outEsc' 2>> '$errEsc'
exit `$LASTEXITCODE
"@
$tmp="$startScript.new";[IO.File]::WriteAllText($tmp,$launcher,(New-Object Text.UTF8Encoding($false)));Move-Item -Force -LiteralPath $tmp -Destination $startScript
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action=New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$startScript`""
$trigger=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$taskPrincipal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal|Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host '[85%] PHYSICAL VERIFY' -ForegroundColor Cyan
$deadline=(Get-Date).AddSeconds(60);$root=$null
do { Start-Sleep -Seconds 2; try{$root=Invoke-WebRequest -UseBasicParsing -Uri "http://$CommandHost`:$Port/" -TimeoutSec 5}catch{$root=$null}; if($root -and $root.StatusCode -eq 200){break} } while((Get-Date)-lt $deadline)
if(-not $root -or $root.StatusCode -ne 200){ Fail 'WEB_NOT_200' "http://$CommandHost`:$Port/" }
if($root.Content -notlike '*OWNER COCKPIT V3*VISUAL REBUILD*'){ Fail 'V3_MARKER_MISSING' 'Physical page is not Owner Cockpit V3.' }
$api=Invoke-RestMethod -Uri "http://$CommandHost`:$Port/api/server" -TimeoutSec 10
$task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if($task.State -ne 'Running'){ Fail 'COMMAND_CENTER_NOT_RUNNING' $task.State.ToString() }

Write-Host '[100%] OWNER COCKPIT V3 PHYSICAL PASS' -ForegroundColor Green
[ordered]@{status='PASS';web="http://$CommandHost`:$Port/";commit=$Commit;releaseDir=$releaseDir;commandCenter=$task.State.ToString();telemetryAvailable=$api.available;autoUpdaterTouched=$false;mainProductionTouched=$false}|ConvertTo-Json -Depth 5 -Compress
