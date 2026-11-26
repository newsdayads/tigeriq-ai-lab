param(
  [Parameter(Mandatory=$true)]
  [string]$ZipPath
)

$ErrorActionPreference = 'Stop'
$ExpectedZipSha256 = 'e245d610f3218c95c6433a7636fcb95130001ad4d28d571546b59a57e4328baf'
$ExpectedSourceHead = '0e0528a382d8199d4faca79a680d6c3da8e05bb6'
$ExpectedExeSha256 = '9A0EDE593DA2D2289C13A99532D2E11140BE349E90C9401AD7337662437CEE3B'

if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
  throw "Portable ZIP not found: $ZipPath"
}

$zip = (Resolve-Path -LiteralPath $ZipPath).Path
$actualZip = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualZip -ne $ExpectedZipSha256) {
  throw "Portable ZIP SHA-256 mismatch. Expected $ExpectedZipSha256, got $actualZip"
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ("TigerIQ-PhoneFarm-verify-" + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $temp | Out-Null
  Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force

  $manifestPath = Join-Path $temp 'BUILD_MANIFEST.json'
  $exePath = Join-Path $temp 'TigerIQPhoneFarm.exe'
  $appPath = Join-Path $temp 'app.mjs'

  foreach ($required in @($manifestPath,$exePath,$appPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
      throw "Portable package missing required file: $required"
    }
  }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.schema -ne 'TIGERIQ_PHONE_FARM_BUILD_V1') {
    throw "Unexpected build manifest schema: $($manifest.schema)"
  }
  if ($manifest.sourceHead -ne $ExpectedSourceHead) {
    throw "Source head mismatch. Expected $ExpectedSourceHead, got $($manifest.sourceHead)"
  }
  if ($manifest.localOnly -ne $true) {
    throw "Portable runtime must remain localOnly=true"
  }

  $actualExe = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualExe -ne $ExpectedExeSha256) {
    throw "TigerIQPhoneFarm.exe SHA-256 mismatch. Expected $ExpectedExeSha256, got $actualExe"
  }
  if ($manifest.tigeriqExeSha256.ToUpperInvariant() -ne $ExpectedExeSha256) {
    throw "BUILD_MANIFEST.json EXE SHA-256 does not match pinned value"
  }

  $app = Get-Content -LiteralPath $appPath -Raw
  if (-not $app.Contains("line.match(/^(\S+)\s+_adb-tls-connect\._tcp\.?\s+/i)")) {
    throw "Official whitespace-separated ADB mDNS parser was not found"
  }
  if (-not $app.Contains("line.match(/^(\S+?)\._adb-tls-connect\._tcp\.?\s+/i)")) {
    throw "Compact ADB mDNS compatibility parser was not found"
  }
  if ($app.Contains("'tcpip'") -or $app.Contains('"tcpip"')) {
    throw "Forbidden adb tcpip mutation token detected"
  }
  if ($app -match 'setprop\s+service\.adb\.tcp\.port') {
    throw "Forbidden service.adb.tcp.port setprop mutation detected"
  }

  [pscustomobject]@{
    Result = 'PASS'
    ZipSha256 = $actualZip
    SourceHead = $manifest.sourceHead
    ExeSha256 = $actualExe
    LocalOnly = $manifest.localOnly
  } | Format-List
}
finally {
  if (Test-Path -LiteralPath $temp) {
    Remove-Item -LiteralPath $temp -Recurse -Force
  }
}
