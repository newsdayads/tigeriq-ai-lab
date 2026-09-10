param(
  [string]$RuntimeDir = 'D:\TigerIQ\Runtime\ai-api-v1'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ([Environment]::MachineName -ne 'PC01') { throw 'AI_API_RUNTIME_WRONG_HOST' }
$sourceDir = $PSScriptRoot
$files = @(
  'ai-provider-scheduler.ps1',
  'ai-job-orchestrator.ps1',
  'run-ai-job001-mixed.ps1',
  'run-ai-job001-triprovider.ps1',
  'invoke-ai-job001-triprovider-runtime.ps1',
  'invoke-groq-runtime.ps1',
  'install-groq-runtime-secret.ps1',
  'invoke-gemini-runtime.ps1',
  'install-gemini-runtime-secret.ps1'
)
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
foreach ($file in $files) {
  $source = Join-Path $sourceDir $file
  if (-not (Test-Path -LiteralPath $source)) { throw "AI_API_RUNTIME_SOURCE_MISSING:$file" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $RuntimeDir $file) -Force
}$head='UNKNOWN'
try {
  $repoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $head=(git -C $repoRoot rev-parse HEAD 2>$null).Trim()
  $dirty=(git -C $repoRoot status --porcelain -- scripts/pc-worker .github/workflows/wo048-multi-ai-probe.yml 2>$null | Out-String).Trim()
  if (-not [string]::IsNullOrWhiteSpace($dirty)) { $head += ':DIRTY' }
} catch {}
[IO.File]::WriteAllText((Join-Path $RuntimeDir 'source-head.txt'),$head,(New-Object Text.UTF8Encoding($false)))
Write-Host ('AI_API_RUNTIME_DEPLOYED=' + $RuntimeDir)
Write-Host ('SOURCE_HEAD=' + $head)