param([string]$Model='qwen2.5-coder:14b')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repo
$env:TIGERIQ_OLLAMA_MODEL=$Model
$env:TIGERIQ_COMMIT_SHA=(git rev-parse HEAD).Trim()
if(-not ($env:TIGERIQ_COMMIT_SHA -match '^[0-9a-f]{7,64}$')){throw 'Cannot resolve git commit SHA'}
$steps=[ordered]@{repo=$false;ollama=$false;tasks=$false;build=$false;e2e=$false}
function Show-ProgressLine([string]$Name,[int]$Percent){Write-Host ("[{0,3}%] {1}" -f $Percent,$Name)}
Show-ProgressLine 'Repo/SHA' 10
$steps.repo=$true
Show-ProgressLine 'Ollama endpoint + model' 25
$ollama=& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'test-ollama.ps1') -Model $Model | Out-String
if(-not $ollama){throw 'Ollama smoke test returned no output'}
$steps.ollama=$true
Show-ProgressLine 'Worker/Watchdog Scheduled Tasks' 40
$tasks=@(Get-ScheduledTask -ErrorAction Stop | Where-Object {$_.TaskName -match 'TigerIQ' -and $_.TaskName -match '(Worker|Watchdog)'})
if($tasks.Count -lt 2){throw "Expected TigerIQ Worker + Watchdog tasks; found $($tasks.Count): $($tasks.TaskName -join ', ')"}
$steps.tasks=$true
Show-ProgressLine 'Build' 60
npm run build
if($LASTEXITCODE -ne 0){throw 'Build failed'}
$steps.build=$true
Show-ProgressLine 'Physical cloud-outage -> Ollama + durable restart recovery' 85
$e2e=node (Join-Path $PSScriptRoot 'e2e-wo007.mjs') | Out-String
if($LASTEXITCODE -ne 0){throw 'WO-007 E2E failed'}
$result=$e2e | ConvertFrom-Json
if(-not $result.ok -or $result.status -ne 'verified' -or $result.recoveredStatus -ne 'verified' -or $result.provider -ne 'ollama'){throw 'WO-007 E2E gate did not verify'}
$steps.e2e=$true
Show-ProgressLine 'PASS' 100
[ordered]@{ok=$true;timestamp=(Get-Date).ToString('o');commitSha=$env:TIGERIQ_COMMIT_SHA;model=$Model;scheduledTasks=@($tasks | Select-Object TaskName,State);steps=$steps;e2e=$result} | ConvertTo-Json -Depth 12
