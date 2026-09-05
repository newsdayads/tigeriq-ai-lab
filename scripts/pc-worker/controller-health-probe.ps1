function Invoke-TigerIQControllerHealthProbe {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUri,
    [ValidateSet('auto','generic','v1')]
    [string]$ExpectedContract = 'auto',
    [int]$TimeoutSec = 4,
    [scriptblock]$Request
  )

  if (-not $Request) {
    $Request = {
      param([string]$Uri, [int]$RequestTimeoutSec)
      try {
        $body = Invoke-RestMethod -Uri $Uri -TimeoutSec $RequestTimeoutSec -ErrorAction Stop
        [pscustomobject]@{
          transport_ok = $true
          status_code = 200
          body = $body
        }
      } catch {
        $statusCode = $null
        if ($_.Exception.Response) {
          try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
        }
        [pscustomobject]@{
          transport_ok = $false
          status_code = $statusCode
          body = $null
        }
      }
    }
  }

  $contracts = [ordered]@{
    generic = '/api/workforce/status'
    v1 = '/api/v1/status'
  }

  $order = if ($ExpectedContract -eq 'auto') {
    @('generic','v1')
  } else {
    @($ExpectedContract) + @($contracts.Keys | Where-Object { $_ -ne $ExpectedContract })
  }

  $attempts = @()
  $normalizedBase = $BaseUri.TrimEnd('/')

  foreach ($contract in $order) {
    $path = $contracts[$contract]
    $uri = "$normalizedBase$path"
    $result = & $Request $uri $TimeoutSec
    $transportOk = [bool]$result.transport_ok
    $statusCode = $result.status_code
    $body = $result.body
    $ok = $transportOk -and $null -ne $body -and [bool]$body.ok

    $attemptError = $null
    if (-not $ok) {
      if ($statusCode -eq 404) {
        $attemptError = 'CONTROLLER_CONTRACT_MISMATCH'
      } elseif (-not $transportOk) {
        $attemptError = 'CONTROLLER_HEALTH_REQUEST_FAILED'
      } else {
        $attemptError = 'CONTROLLER_HEALTH_NOT_OK'
      }
    }

    $attempts += [pscustomobject]@{
      controller_contract = $contract
      health_path = $path
      status_code = $statusCode
      health_ok = $ok
      error_class = $attemptError
    }

    if ($ok) {
      $healthError = $null
      if ($ExpectedContract -ne 'auto' -and $contract -ne $ExpectedContract) {
        $healthError = 'CONTROLLER_CONTRACT_MISMATCH'
      }
      return [pscustomobject]@{
        controller_contract = $contract
        health_path = $path
        health_ok = $true
        health_error = $healthError
        response = $body
        attempts = $attempts
      }
    }
  }

  $routeEvidence = @($attempts | Where-Object { $null -ne $_.status_code -and $_.status_code -ne 404 })
  $allNotFound = $attempts.Count -gt 0 -and @($attempts | Where-Object { $_.status_code -ne 404 }).Count -eq 0
  $detected = if ($routeEvidence.Count -gt 0) { $routeEvidence[0] } else { $null }
  $detectedContract = if ($detected) { $detected.controller_contract } else { $null }
  $detectedPath = if ($detected) { $detected.health_path } else { $null }

  $explicitMismatch = $ExpectedContract -ne 'auto' -and $detectedContract -and $detectedContract -ne $ExpectedContract
  $failureError = if ($explicitMismatch -or $allNotFound) {
    'CONTROLLER_CONTRACT_MISMATCH'
  } else {
    'CONTROLLER_HEALTH_UNAVAILABLE'
  }

  [pscustomobject]@{
    controller_contract = if ($detectedContract) { $detectedContract } elseif ($ExpectedContract -ne 'auto') { $ExpectedContract } else { $null }
    health_path = if ($detectedPath) { $detectedPath } elseif ($ExpectedContract -ne 'auto') { $contracts[$ExpectedContract] } else { $null }
    health_ok = $false
    health_error = $failureError
    response = $null
    attempts = $attempts
  }
}

function Get-TigerIQControllerProjection {
  [CmdletBinding()]
  param(
    $Health,
    [bool]$WildcardListener,
    [bool]$TaskExists
  )

  $contractHealthy = $null -ne $Health -and [bool]$Health.health_ok -and [string]::IsNullOrEmpty([string]$Health.health_error)
  if ($contractHealthy -and -not $WildcardListener) { return 'ONLINE' }
  if ($TaskExists) { return 'NOT_HEALTHY' }
  return 'NOT_INSTALLED'
}
