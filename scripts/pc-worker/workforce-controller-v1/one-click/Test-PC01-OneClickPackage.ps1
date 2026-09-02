$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\..')).Path
$ManifestPath = Join-Path $PSScriptRoot 'bootstrap-manifest.json'
$BootstrapPath = Join-Path $PSScriptRoot 'Invoke-PC01-OneClickGoLive.ps1'
$RollbackPath = Join-Path $PSScriptRoot 'Invoke-PC01-OneClickRollback.ps1'
$RestartPath = Join-Path $PSScriptRoot 'verify-controller-restart.ps1'
$LauncherPath = Join-Path $PSScriptRoot 'PC01-GO-LIVE.cmd'
$InstallerPath = Join-Path $RepoRoot 'scripts\pc-worker\workforce-controller-v1\install-workforce-controller-v1.ps1'
$HealthPath = Join-Path $RepoRoot 'scripts\pc-worker\workforce-controller-v1\health-workforce-controller-v1.ps1'

function Assert-True([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Parse-PowerShell([string]$Path) {
  $errors = $null
  $tokens = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $Path),[ref]$tokens,[ref]$errors) | Out-Null
  if ($errors.Count -gt 0) { throw "$Path :: $($errors[0].Message)" }
}

foreach ($path in @($ManifestPath,$BootstrapPath,$RollbackPath,$RestartPath,$LauncherPath,$InstallerPath,$HealthPath)) { Assert-True (Test-Path $path) "Missing package file: $path" }
foreach ($path in @($BootstrapPath,$RollbackPath,$RestartPath,$InstallerPath,$HealthPath)) { Parse-PowerShell $path }

$manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
Assert-True ($manifest.controllerBasis.sha -eq 'c0632bc110ea0d26925d3657ac485cb90b5ee010') 'Controller basis SHA drifted.'
Assert-True ($manifest.postgresBasis.sha -eq '6f12d3c5f3da1616041fa48fadf8a4e8b41e7ad9') 'PostgreSQL basis SHA drifted.'
Assert-True ($manifest.postgresBasis.migration001BlobSha -eq '33445fd07133b5e58f2b33ee3996bf49e6547fa3') 'Migration 001 blob drifted.'
Assert-True ($manifest.migration002BlobSha -eq '90e842318f3cf47caf671890e4bbe435cd35e8b6') 'Migration 002 blob drifted.'
Assert-True ($manifest.network.host -eq '100.97.23.87') 'Controller bind host drifted.'
Assert-True ([int]$manifest.network.port -eq 8790) 'Controller port drifted.'
Assert-True ($manifest.network.tailscaleRemoteCidr -eq '100.64.0.0/10') 'Tailscale firewall CIDR drifted.'
Assert-True ($manifest.forbiddenMigration -eq '003_business_state_v2') 'Forbidden migration guard drifted.'

Push-Location $RepoRoot
try {
  $git = (Get-Command git -ErrorAction Stop).Source
  $blob001 = (& $git rev-parse 'HEAD:db/migrations/001_operational_state_v1.sql').Trim()
  $blob002 = (& $git rev-parse 'HEAD:db/migrations/002_device_proof_replay_v1.sql').Trim()
  Assert-True ($blob001 -eq $manifest.postgresBasis.migration001BlobSha) 'HEAD migration 001 is not the reviewed PR #141 blob.'
  Assert-True ($blob002 -eq $manifest.migration002BlobSha) 'HEAD migration 002 is not the reviewed Controller blob.'
  & $git merge-base --is-ancestor $manifest.controllerBasis.sha HEAD
  Assert-True ($LASTEXITCODE -eq 0) 'Bootstrap branch does not descend from the reviewed Controller basis.'
  & $git diff --quiet $manifest.controllerBasis.sha HEAD -- apps/workforce-controller packages/work-state db/migrations/001_operational_state_v1.sql db/migrations/002_device_proof_replay_v1.sql tests/pc01-android-postgres-integration.test.ts
  Assert-True ($LASTEXITCODE -eq 0) 'Runtime implementation drifted from reviewed PR #116 basis.'
} finally { Pop-Location }

Assert-True (-not (Test-Path (Join-Path $RepoRoot 'db\migrations\003_business_state_v2.sql'))) 'Forbidden physical migration 003 exists.'
$bootstrap = Get-Content -Raw $BootstrapPath
$installer = Get-Content -Raw $InstallerPath
$health = Get-Content -Raw $HealthPath
$rollback = Get-Content -Raw $RollbackPath
$launcher = Get-Content -Raw $LauncherPath
$allScripts = $bootstrap + "`n" + $installer + "`n" + $health + "`n" + $rollback

Assert-True ($bootstrap -match '001_operational_state_v1' -and $bootstrap -match '002_device_proof_replay_v1') 'Bootstrap does not explicitly require migrations 001+002.'
Assert-True ($installer -match '001_operational_state_v1' -and $installer -match '002_device_proof_replay_v1') 'Installer does not explicitly require migrations 001+002.'
Assert-True ($health -match '003_business_state_v2' -and $health -match 'forbidden003Applied') 'Health gate does not reject migration 003.'
Assert-True ($health -match '100\.97\.23\.87' -and $health -match '100\.64\.0\.0/10' -and $health -match '8790') 'Health gate network contract drifted.'
Assert-True ($launcher -match 'Invoke-PC01-OneClickGoLive\.ps1' -and $launcher -match 'ExecutePhysical') 'One-click launcher does not invoke the canonical wrapper.'
Assert-True ($allScripts -notmatch '(?i)winget\s+uninstall|Uninstall-Package|DROP\s+(TABLE|DATABASE)|Remove-WindowsFeature|git\s+(checkout|switch)\s+main') 'Destructive or MAIN mutation command detected.'
Assert-True ($allScripts -notmatch '(?i)openclaw\s+(connect|login|auth|enable|start)') 'OpenClaw reconnect/enable command detected.'
Assert-True ($allScripts -notmatch '(?i)/v1/android/sessions|/v1/android/jobs/pull|/v1/android/jobs/submit') 'Retired Android route detected.'
Assert-True ($rollback -match 'databaseRollback.*NOT_PERFORMED_NON_DESTRUCTIVE' -or $rollback -match 'NOT_PERFORMED_NON_DESTRUCTIVE') 'Rollback must remain non-destructive for PostgreSQL.'

Write-Host 'PC01_ONE_CLICK_STATIC_CONTRACT_PASS'
