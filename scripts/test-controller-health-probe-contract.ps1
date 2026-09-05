$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'pc-worker/controller-health-probe.ps1')

function Assert-Equal($Actual, $Expected, [string]$Name) {
  if ($Actual -ne $Expected) {
    throw "ASSERT_FAILED $Name expected=[$Expected] actual=[$Actual]"
  }
}

$genericRequest = {
  param([string]$Uri, [int]$TimeoutSec)
  if ($Uri.EndsWith('/api/workforce/status')) {
    return [pscustomobject]@{ transport_ok = $true; status_code = 200; body = [pscustomobject]@{ ok = $true } }
  }
  return [pscustomobject]@{ transport_ok = $false; status_code = 404; body = $null }
}

$v1Request = {
  param([string]$Uri, [int]$TimeoutSec)
  if ($Uri.EndsWith('/api/v1/status')) {
    return [pscustomobject]@{ transport_ok = $true; status_code = 200; body = [pscustomobject]@{ ok = $true } }
  }
  return [pscustomobject]@{ transport_ok = $false; status_code = 404; body = $null }
}

$v1UnhealthyRequest = {
  param([string]$Uri, [int]$TimeoutSec)
  if ($Uri.EndsWith('/api/v1/status')) {
    return [pscustomobject]@{ transport_ok = $false; status_code = 503; body = $null }
  }
  return [pscustomobject]@{ transport_ok = $false; status_code = 404; body = $null }
}

$unknownRequest = {
  param([string]$Uri, [int]$TimeoutSec)
  return [pscustomobject]@{ transport_ok = $false; status_code = 404; body = $null }
}

$generic = Invoke-TigerIQControllerHealthProbe -BaseUri 'http://100.64.0.1:8790' -ExpectedContract auto -Request $genericRequest
Assert-Equal $generic.controller_contract 'generic' 'auto-generic-contract'
Assert-Equal $generic.health_path '/api/workforce/status' 'auto-generic-path'
Assert-Equal $generic.health_ok $true 'auto-generic-health'
Assert-Equal $generic.health_error $null 'auto-generic-error'

$v1 = Invoke-TigerIQControllerHealthProbe -BaseUri 'http://100.64.0.1:8790' -ExpectedContract auto -Request $v1Request
Assert-Equal $v1.controller_contract 'v1' 'auto-v1-contract'
Assert-Equal $v1.health_path '/api/v1/status' 'auto-v1-path'
Assert-Equal $v1.health_ok $true 'auto-v1-health'
Assert-Equal $v1.health_error $null 'auto-v1-error'

$mismatch = Invoke-TigerIQControllerHealthProbe -BaseUri 'http://100.64.0.1:8790' -ExpectedContract generic -Request $v1Request
Assert-Equal $mismatch.controller_contract 'v1' 'mismatch-detected-contract'
Assert-Equal $mismatch.health_path '/api/v1/status' 'mismatch-detected-path'
Assert-Equal $mismatch.health_ok $true 'mismatch-health'
Assert-Equal $mismatch.health_error 'CONTROLLER_CONTRACT_MISMATCH' 'mismatch-classification'

$unhealthy = Invoke-TigerIQControllerHealthProbe -BaseUri 'http://100.64.0.1:8790' -ExpectedContract auto -Request $v1UnhealthyRequest
Assert-Equal $unhealthy.controller_contract 'v1' 'unhealthy-detected-contract'
Assert-Equal $unhealthy.health_path '/api/v1/status' 'unhealthy-detected-path'
Assert-Equal $unhealthy.health_ok $false 'unhealthy-health'
Assert-Equal $unhealthy.health_error 'CONTROLLER_HEALTH_UNAVAILABLE' 'unhealthy-classification'

$unknown = Invoke-TigerIQControllerHealthProbe -BaseUri 'http://100.64.0.1:8790' -ExpectedContract auto -Request $unknownRequest
Assert-Equal $unknown.controller_contract $null 'unknown-contract'
Assert-Equal $unknown.health_path $null 'unknown-path'
Assert-Equal $unknown.health_ok $false 'unknown-health'
Assert-Equal $unknown.health_error 'CONTROLLER_CONTRACT_MISMATCH' 'unknown-classification'

Write-Output 'CONTROLLER_HEALTH_PROBE_CONTRACT_PASS cases=5'
