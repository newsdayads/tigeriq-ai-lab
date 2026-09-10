$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProvisionerPath = Join-Path $PSScriptRoot 'Ensure-PC01PostgresRuntime.ps1'
function Assert-RejectedAsUnmanaged([string]$DatabaseUrl) {
  $testRoot = Join-Path ([IO.Path]::GetTempPath()) ("tigeriq-postgres-guard-" + [Guid]::NewGuid().ToString('N'))
  try {
    try {
      & $ProvisionerPath -DatabaseUrl $DatabaseUrl -SecretsRoot (Join-Path $testRoot 'secrets') -EvidenceDir (Join-Path $testRoot 'evidence')
      throw "Expected POSTGRES_EXISTING_UNMANAGED for $DatabaseUrl"
    } catch {
      if ($_.Exception.Message -notmatch 'POSTGRES_EXISTING_UNMANAGED') { throw }
    }
  } finally {
    Remove-Item $testRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

foreach ($url in @(
  'postgresql://tigeriq_runtime@localhost:5432/tigeriq',
  'postgresql://tigeriq_runtime@127.0.0.1:5433/tigeriq',
  'postgresql://tigeriq_runtime@127.0.0.1:5432/otherdb',
  'postgresql://other_role@127.0.0.1:5432/tigeriq',
  'postgresql://tigeriq_runtime@127.0.0.1:5432/tigeriq?application_name=other'
)) { Assert-RejectedAsUnmanaged $url }

Write-Host 'PC01_POSTGRES_REUSE_GUARD_PASS'
