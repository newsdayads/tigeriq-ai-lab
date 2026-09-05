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

  $hasNotFound = @($attempts | Where-Object { $_.status_code -eq 404 }).Count -gt 0
  $fallbackContract = if ($ExpectedContract -eq 'auto') { $null } else { $ExpectedContract }
  $fallbackPath = if ($fallbackContract) { $contracts[$fallbackContract] } else { $null }
  $failureError = if ($hasNotFound) { 'CONTROLLER_CONTRACT_MISMATCH' } else { 'CONTROLLER_HEALTH_UNAVAILABLE' }

  [pscustomobject]@{
    controller_contract = $fallbackContract
    health_path = $fallbackPath
    health_ok = $false
    health_error = $failureError
    response = $null
    attempts = $attempts
  }
}
