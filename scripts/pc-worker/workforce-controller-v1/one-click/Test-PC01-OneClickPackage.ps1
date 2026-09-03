$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$ManifestPath = Join-Path $PSScriptRoot 'bootstrap-manifest.json'
$BootstrapPath = Join-Path $PSScriptRoot 'Invoke-PC01-OneClickGoLive.ps1'
$PostgresProvisionerPath = Join-Path $PSScriptRoot 'Ensure-PC01PostgresRuntime.ps1'
$PostgresReuseGuardTestPath = Join-Path $PSScriptRoot 'Test-PC01PostgresReuseGuard.ps1'
$RollbackPath = Join-Path $PSScriptRoot 'Invoke-PC01-OneClickRollback.ps1'
$RestartPath = Join-Path $PSScriptRoot 'verify-controller-restart.ps1'
$LauncherPath = Join-Path $PSScriptRoot 'PC01-GO-LIVE.cmd'
$ApprovedHeadVerifierPath = Join-Path $PSScriptRoot 'Assert-PC01ApprovedHead.ps1'
$ApprovedHeadRegressionPath = Join-Path $PSScriptRoot 'Test-PC01ApprovedHeadPinning.ps1'
$InstallerPath = Join-Path $RepoRoot 'scripts\pc-worker\workforce-controller-v1\install-workforce-controller-v1.ps1'
$HealthPath = Join-Path $RepoRoot 'scripts\pc-worker\workforce-controller-v1\health-workforce-controller-v1.ps1'

function Assert-True([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Parse-PowerShell([string]$Path) {
  $errors = $null; $tokens = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $Path),[ref]$tokens,[ref]$errors) | Out-Null
  if ($errors.Count -gt 0) { throw "$Path :: $($errors[0].Message)" }
}

function Test-LauncherChildExitCodePropagation {
  $testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tigeriq-pc01-launcher-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
  try {
    Copy-Item -LiteralPath $LauncherPath -Destination (Join-Path $testRoot 'PC01-GO-LIVE.cmd')
    Set-Content -LiteralPath (Join-Path $testRoot 'Invoke-PC01-OneClickGoLive.ps1') -Value '# test stub' -NoNewline
    $mockSource = @'
using System;
public static class Program {
  public static int Main(string[] args) {
    var command = string.Join(" ", args);
    return (command.Contains("Start-Process") && command.Contains("-PassThru") && command.Contains("-Wait") && command.Contains("ExitCode")) || command.Contains("-ExecutePhysical") ? 73 : 0;
  }
}
'@
    Add-Type -TypeDefinition $mockSource -OutputAssembly (Join-Path $testRoot 'powershell.exe') -OutputType ConsoleApplication -ErrorAction Stop
    Push-Location $testRoot
    try {
      & cmd.exe /d /c (Join-Path $testRoot 'PC01-GO-LIVE.cmd')
      Assert-True ($LASTEXITCODE -eq 73) 'Launcher did not propagate the elevated child PowerShell failure exit code.'
    } finally { Pop-Location }
  } finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

foreach ($path in @($ManifestPath,$BootstrapPath,$PostgresProvisionerPath,$RollbackPath,$RestartPath,$LauncherPath,$InstallerPath,$HealthPath,$ApprovedHeadVerifierPath,$ApprovedHeadRegressionPath)) { Assert-True (Test-Path $path) "Missing package file: $path" }
foreach ($path in @($BootstrapPath,$PostgresProvisionerPath,$RollbackPath,$RestartPath,$InstallerPath,$HealthPath,$ApprovedHeadVerifierPath,$ApprovedHeadRegressionPath)) { Parse-PowerShell $path }
foreach ($path in @($PostgresReuseGuardTestPath)) { Assert-True (Test-Path $path) "Missing package file: $path"; Parse-PowerShell $path }

$manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
Assert-True ($manifest.controllerBasis.sha -eq 'c0632bc110ea0d26925d3657ac485cb90b5ee010') 'Controller basis SHA drifted.'
Assert-True ($manifest.postgresBasis.sha -eq '6f12d3c5f3da1616041fa48fadf8a4e8b41e7ad9') 'PostgreSQL basis SHA drifted.'
Assert-True ($manifest.approvedBootstrap.sha -eq 'EXTERNAL_AFTER_REVIEW') 'Approved bootstrap SHA must remain external to the reviewed commit.'
Assert-True ($manifest.approvedBootstrap.remoteRef -eq 'refs/heads/wo056/pc01-one-click-bootstrap') 'Approved bootstrap remote ref drifted.'
Assert-True ($manifest.postgresBasis.migration001BlobSha -eq '33445fd07133b5e58f2b33ee3996bf49e6547fa3') 'Migration 001 blob drifted.'
Assert-True ($manifest.migration002BlobSha -eq '90e842318f3cf47caf671890e4bbe435cd35e8b6') 'Migration 002 blob drifted.'
Assert-True ($manifest.network.host -eq '100.97.23.87') 'Controller bind host drifted.'
Assert-True ([int]$manifest.network.port -eq 8790) 'Controller port drifted.'
Assert-True ($manifest.network.tailscaleRemoteCidr -eq '100.64.0.0/10') 'Tailscale firewall CIDR drifted.'
Assert-True ($manifest.forbiddenMigration -eq '003_business_state_v2') 'Forbidden migration guard drifted.'
Assert-True ($manifest.postgresRuntime.wingetPackage -eq 'PostgreSQL.PostgreSQL.16') 'PostgreSQL free package drifted.'
Assert-True ($manifest.postgresRuntime.canonicalService -eq 'TigerIQPostgreSQL16') 'Canonical PostgreSQL service drifted.'
Assert-True ($manifest.postgresRuntime.host -eq '127.0.0.1' -and [int]$manifest.postgresRuntime.port -eq 5432) 'Canonical PostgreSQL local endpoint drifted.'

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
$postgresProvisioner = Get-Content -Raw $PostgresProvisionerPath
$installer = Get-Content -Raw $InstallerPath
$health = Get-Content -Raw $HealthPath
$restart = Get-Content -Raw $RestartPath
$rollback = Get-Content -Raw $RollbackPath
$launcher = Get-Content -Raw $LauncherPath
$allScripts = $bootstrap + "`n" + $postgresProvisioner + "`n" + $installer + "`n" + $health + "`n" + $restart + "`n" + $rollback

Assert-True ($bootstrap -match '001_operational_state_v1' -and $bootstrap -match '002_device_proof_replay_v1') 'Bootstrap does not explicitly require migrations 001+002.'
Assert-True ($installer -match '001_operational_state_v1' -and $installer -match '002_device_proof_replay_v1') 'Installer does not explicitly require migrations 001+002.'
Assert-True ($installer -match 'PgPassFilePath' -and $installer -match 'PGPASSFILE') 'SYSTEM Controller runtime does not persist protected PostgreSQL auth.'
Assert-True ($postgresProvisioner -match 'PostgreSQL\.PostgreSQL\.16' -and $postgresProvisioner -match '--optionfile') 'Missing unattended free PostgreSQL install path with protected option file.'
Assert-True ($postgresProvisioner -match 'workforce-controller-v1\.pgpass' -and $postgresProvisioner -match 'DATABASE_CREDENTIAL_NOT_DURABLE') 'Durable SYSTEM PostgreSQL credential gate missing.'
Assert-True ($postgresProvisioner -match 'POSTGRES_EXISTING_UNMANAGED' -and $postgresProvisioner -match 'refusing to create a parallel datastore') 'Ambiguous existing PostgreSQL must fail closed instead of creating a second datastore.'
Assert-True ($postgresProvisioner -match '\$uri\.Host -ne \$CanonicalHost' -and $postgresProvisioner -match '\$database -ne \$CanonicalDatabase' -and $postgresProvisioner -match '\$role -ne \$CanonicalUser') 'Configured PostgreSQL reuse must require the exact canonical endpoint, database, and role.'
Assert-True ($postgresProvisioner -match 'Remove-Item \$InstallOptionFile' -and $postgresProvisioner -match 'Remove-Item \$BootstrapSqlFile') 'Temporary secret-bearing PostgreSQL files are not removed.'
Assert-True ($health -match '003_business_state_v2' -and $health -match 'forbidden003Applied') 'Health gate does not reject migration 003.'
Assert-True ($health -match 'migrationsVerifiedFromSamePostgres' -and $health -match 'controller-v1') 'Health gate does not cross-check HTTP and same PostgreSQL migration state.'
Assert-True ($health -match '100\.97\.23\.87' -and $health -match '100\.64\.0\.0/10' -and $health -match '8790') 'Health gate network contract drifted.'
Assert-True ($restart -match 'PGPASSFILE' -and $restart -match 'device_proof_replay_state') 'Restart verifier does not prove durable replay state with SYSTEM DB auth.'
Assert-True ($launcher -match 'Invoke-PC01-OneClickGoLive\.ps1' -and $launcher -match 'ExecutePhysical') 'One-click launcher does not invoke the canonical wrapper.'
Assert-True ($launcher -match 'Start-Process' -and $launcher -match 'PassThru' -and $launcher -match 'ExitCode') 'One-click launcher does not capture and return the elevated child exit code.'
Test-LauncherChildExitCodePropagation
$global:LASTEXITCODE = 0
Assert-True ($bootstrap -match 'Assert-PC01ApprovedHead\.ps1' -and $bootstrap -match 'ApprovedBootstrapHead') 'Bootstrap does not enforce immutable approved-head pinning.'
Assert-True ($allScripts -notmatch '(?i)winget\s+uninstall|Uninstall-Package|DROP\s+(TABLE|DATABASE)|Remove-WindowsFeature|git\s+(checkout|switch)\s+main') 'Destructive or MAIN mutation command detected.'
Assert-True ($allScripts -notmatch '(?i)openclaw\s+(connect|login|auth|enable|start)') 'OpenClaw reconnect/enable command detected.'
Assert-True ($allScripts -notmatch '(?i)/v1/android/sessions|/v1/android/jobs/pull|/v1/android/jobs/submit') 'Retired Android route detected.'
Assert-True ($allScripts -notmatch '(?i)://[^\s/@:]+:[^\s/@]+@') 'Inline URL credential pattern detected in one-click package.'
Assert-True ($rollback -match 'NOT_PERFORMED_NON_DESTRUCTIVE') 'Rollback must remain non-destructive for PostgreSQL.'

& $PostgresReuseGuardTestPath
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL reuse-guard regression failed.' }

& $ApprovedHeadRegressionPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'PC01_ONE_CLICK_STATIC_CONTRACT_PASS'
