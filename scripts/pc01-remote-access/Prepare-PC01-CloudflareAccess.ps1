[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$TunnelUuid,
  [Parameter(Mandatory=$true)][string]$CredentialsFile,
  [Parameter(Mandatory=$true)][string]$AiLabHostname,
  [int]$WebControlPort = 8788,
  [string]$CloudflaredPath = 'C:\Cloudflared\bin\cloudflared.exe',
  [string]$ConfigDirectory = 'C:\ProgramData\TigerIQ\Cloudflare',
  [switch]$AccessPolicyReady,
  [switch]$Apply,
  [string]$AuthorizationCode = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Message) { throw "TIGERIQ_CLOUDFLARE_BLOCKED: $Message" }
function Is-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Test-Hostname([string]$Value) {
  return $Value -match '^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$'
}
function Test-Uuid([string]$Value) {
  $parsed = [Guid]::Empty
  return [Guid]::TryParse($Value,[ref]$parsed) -and $parsed -ne [Guid]::Empty
}
function Assert-NoRawSecret([string]$Value,[string]$Name) {
  if ($Value -match 'eyJ[a-zA-Z0-9_-]{20,}\.' -or $Value -match 'Bearer\s+[A-Za-z0-9._-]{20,}' -or $Value -match '^[A-Za-z0-9_-]{80,}$') { Fail "$Name appears to contain raw secret material; provide a reference/path only" }
}
function Get-ConfigText {
  @"
tunnel: $TunnelUuid
credentials-file: $CredentialsFile

ingress:
  - hostname: $AiLabHostname
    service: http://127.0.0.1:$WebControlPort
  - service: http_status:404
"@
}
function Test-WebControlHealth {
  try {
    $result = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$WebControlPort/health" -TimeoutSec 3
    return ($result.ok -eq $true -and $result.service -eq 'tigeriq-web-control' -and $result.bind -eq 'loopback')
  } catch { return $false }
}

if (-not (Test-Uuid $TunnelUuid)) { Fail 'TunnelUuid must be a valid non-empty UUID' }
if (-not (Test-Hostname $AiLabHostname)) { Fail 'AiLabHostname is invalid' }
if ($WebControlPort -lt 1 -or $WebControlPort -gt 65535) { Fail 'WebControlPort is invalid' }
if ([IO.Path]::GetExtension($CredentialsFile) -ne '.json') { Fail 'CredentialsFile must be a .json reference' }
Assert-NoRawSecret $CredentialsFile 'CredentialsFile'
Assert-NoRawSecret $TunnelUuid 'TunnelUuid'

$configPath = Join-Path $ConfigDirectory 'config.yml'
$serviceImagePath = ('"{0}" --config="{1}" tunnel run' -f $CloudflaredPath,$configPath)
$healthReady = Test-WebControlHealth
$cloudflaredExists = Test-Path -LiteralPath $CloudflaredPath -PathType Leaf
$credentialsExist = Test-Path -LiteralPath $CredentialsFile -PathType Leaf

$plan = [ordered]@{
  version = 1
  mode = $(if($Apply){'apply'}else{'dry-run'})
  accessPolicyReady = [bool]$AccessPolicyReady
  tunnelUuid = $TunnelUuid
  credentialsReference = $CredentialsFile
  aiLabHostname = $AiLabHostname
  origin = "http://127.0.0.1:$WebControlPort"
  configPath = $configPath
  cloudflaredPath = $CloudflaredPath
  cloudflaredExists = $cloudflaredExists
  credentialsExist = $credentialsExist
  webControlHealth = $healthReady
  ingressFailClosed = $true
  requiresOwnerAuthorization = $true
  accountMutationsAutomated = $false
  productionMutation = $false
}

if (-not $Apply) {
  $plan | ConvertTo-Json -Depth 5
  exit 0
}

if (-not $AccessPolicyReady) { Fail 'Access application/policy must be created and verified before publishing the tunnel route' }
if ($AuthorizationCode -ne 'OWNER_AUTHORIZED_CLOUDFLARE_APPLY') { Fail 'explicit Owner authorization code required for Apply' }
if (-not (Is-Admin)) { Fail 'Apply requires elevated Administrator PowerShell' }
if (-not $cloudflaredExists) { Fail 'cloudflared.exe not found at configured path' }
if (-not $credentialsExist) { Fail 'tunnel credentials reference does not exist' }
if (-not $healthReady) { Fail 'TigerIQ Web Control loopback health check failed' }

New-Item -ItemType Directory -Path $ConfigDirectory -Force | Out-Null
$configText = Get-ConfigText
$tempPath = "$configPath.$PID.tmp"
[IO.File]::WriteAllText($tempPath,$configText,(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $tempPath -Destination $configPath -Force

& $CloudflaredPath --config $configPath tunnel ingress validate
if ($LASTEXITCODE -ne 0) { Fail 'cloudflared ingress validation failed' }

$service = Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue
if ($null -eq $service) {
  & $CloudflaredPath service install
  if ($LASTEXITCODE -ne 0) { Fail 'cloudflared service install failed' }
}

$serviceKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\Cloudflared'
if (-not (Test-Path $serviceKey)) { Fail 'Cloudflared service registry key missing after install' }
Set-ItemProperty -Path $serviceKey -Name ImagePath -Value $serviceImagePath

$service = Get-Service -Name 'Cloudflared' -ErrorAction Stop
if ($service.Status -eq 'Running') { Restart-Service -Name 'Cloudflared' -Force } else { Start-Service -Name 'Cloudflared' }
$service = Get-Service -Name 'Cloudflared' -ErrorAction Stop
if ($service.Status -ne 'Running') { Fail 'Cloudflared service did not reach Running state' }

[ordered]@{
  version = 1
  status = 'APPLIED_LOCAL_SERVICE_ONLY'
  aiLabHostname = $AiLabHostname
  origin = "http://127.0.0.1:$WebControlPort"
  ingressValidated = $true
  service = $service.Status.ToString()
  accessPolicyReady = [bool]$AccessPolicyReady
  note = 'DNS/Access/Tunnel account configuration remains external and is not changed by this script.'
} | ConvertTo-Json -Depth 5
