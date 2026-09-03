param(
  [string]$Branch = 'wo-059-pc01-primary-command-center',
  [int]$Port = 8787,
  [string]$CommandHost = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = 'newsdayads/tigeriq-ai-lab'
$sourcePath = 'scripts/pc-worker/install-command-center.ps1'
$tempScript = Join-Path $env:TEMP 'tigeriq-install-command-center-isolated-inner.ps1'
$sharedWorkspace = "F:\TigerIQ\Workspace\tigeriq-ai-lab"
$isolatedWorkspace = "F:\TigerIQ\CommandCenter\source"

Write-Host '[5%] ISOLATED INSTALL PRECHECK' -ForegroundColor Cyan
if (-not (Get-Command gh.exe -ErrorAction SilentlyContinue)) { throw 'GH_MISSING: gh.exe is required.' }

gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'GH_AUTH_MISSING: GitHub CLI is not authenticated.' }

Write-Host '[8%] FETCH INSTALLER' -ForegroundColor Cyan
$payload = gh api "repos/$repo/contents/$sourcePath`?ref=$Branch" --jq .content
if ($LASTEXITCODE -ne 0 -or -not $payload) { throw 'INSTALLER_FETCH_FAILED: Could not fetch the Command Center installer.' }
$bytes = [Convert]::FromBase64String((($payload | Out-String) -replace '\s',''))
$text = [Text.Encoding]::UTF8.GetString($bytes)

$needle = "`$workspace = 'F:\TigerIQ\Workspace\tigeriq-ai-lab'"
$replacement = "`$workspace = 'F:\TigerIQ\CommandCenter\source'"
if (-not $text.Contains($needle)) { throw 'INSTALLER_LAYOUT_CHANGED: Expected workspace declaration was not found; refusing unsafe patch.' }
$text = $text.Replace($needle, $replacement)
if ($text.Contains($needle)) { throw 'ISOLATION_FAILED: Shared PC01 automation workspace reference is still present.' }

[IO.File]::WriteAllText($tempScript, $text, (New-Object Text.UTF8Encoding($false)))
Write-Host "[9%] ISOLATED SOURCE: $isolatedWorkspace" -ForegroundColor Green
Write-Host '[9%] PC01 automation workspace will not be checked out or modified by this install.' -ForegroundColor Green

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tempScript -Branch $Branch -Port $Port -CommandHost $CommandHost
exit $LASTEXITCODE
