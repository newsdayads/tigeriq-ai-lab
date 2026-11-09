$ErrorActionPreference='Stop'
$ExpectedUser='pc01\wdragons12x'
$RequestPath='D:\TigerIQ\State\pc-operator-admin\verify-request.json'
$StateRoot='D:\TigerIQ\State\pc-operator-admin'
$EvidenceRoot=[IO.Path]::GetFullPath('D:\TigerIQ\Evidence') + '\'
$DnsBackupPath=Join-Path $StateRoot 'gh5648-news-dns-backup.json'
$CredentialStore='D:\TigerIQ\Rebuild\credential-store.ps1'
$NewsZone='tigeriq.io.vn'
$NewsHostname='news.tigeriq.io.vn'
$NewsHealthUrl='https://news.tigeriq.io.vn/healthz'
$TunnelTarget='6e1b0f48-cf73-420b-ba3e-9fbb0efc4e61.cfargotunnel.com'

function Write-BrokerReceipt {
  param(
    [string]$Path,
    [hashtable]$Data
  )
  $Data.timestamp=(Get-Date).ToUniversalTime().ToString('o')
  $Data | ConvertTo-Json -Compress -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-CloudflareContext {
  if(-not (Test-Path -LiteralPath $CredentialStore -PathType Leaf)){throw 'NEWS_DNS_CREDENTIAL_STORE_MISSING'}
  . $CredentialStore
  if(-not (Get-Command Get-TigerIQSecret -ErrorAction SilentlyContinue)){throw 'NEWS_DNS_SECRET_HELPER_MISSING'}
  $Token=Get-TigerIQSecret 'cloudflare-auth-token' 'TigerIQ-Cloudflare-PC01-v1'
  if([string]::IsNullOrWhiteSpace($Token)){throw 'NEWS_DNS_TOKEN_MISSING'}
  $Headers=@{Authorization='Bearer '+$Token}
  $ZoneResponse=Invoke-RestMethod -Method Get -Uri ('https://api.cloudflare.com/client/v4/zones?name='+$NewsZone+'&status=active&per_page=50') -Headers $Headers -TimeoutSec 20
  if(-not $ZoneResponse.success -or @($ZoneResponse.result).Count -ne 1){throw 'NEWS_DNS_ZONE_LOOKUP_FAILED'}
  [pscustomobject]@{
    headers=$Headers
    zoneId=[string]$ZoneResponse.result[0].id
  }
}

function Get-NewsDnsRecord {
  param($Context)
  $Uri='https://api.cloudflare.com/client/v4/zones/'+$Context.zoneId+'/dns_records?name='+$NewsHostname+'&per_page=100'
  $Response=Invoke-RestMethod -Method Get -Uri $Uri -Headers $Context.headers -TimeoutSec 20
  if(-not $Response.success){throw 'NEWS_DNS_RECORD_READ_FAILED'}
  $Records=@($Response.result | Where-Object { [string]$_.name -ieq $NewsHostname })
  if($Records.Count -ne 1){throw 'NEWS_DNS_RECORD_COUNT_INVALID'}
  $Record=$Records[0]
  if([string]$Record.type -ine 'CNAME'){throw 'NEWS_DNS_RECORD_TYPE_NOT_CNAME'}
  $Record
}

function ConvertTo-SafeDnsSnapshot {
  param($Record)
  [ordered]@{
    id=[string]$Record.id
    type=[string]$Record.type
    name=[string]$Record.name
    content=[string]$Record.content
    proxied=[bool]$Record.proxied
    ttl=[int]$Record.ttl
    comment=if($null -eq $Record.comment){$null}else{[string]$Record.comment}
    modifiedOn=if($null -eq $Record.modified_on){$null}else{[string]$Record.modified_on}
  }
}

function Assert-RecordMatchesSnapshot {
  param($Record,$Snapshot)
  if([string]$Record.id -ne [string]$Snapshot.id){throw 'NEWS_DNS_PRECONDITION_ID_CHANGED'}
  if([string]$Record.type -ine [string]$Snapshot.type){throw 'NEWS_DNS_PRECONDITION_TYPE_CHANGED'}
  if([string]$Record.name -ine [string]$Snapshot.name){throw 'NEWS_DNS_PRECONDITION_NAME_CHANGED'}
  if([string]$Record.content -ine [string]$Snapshot.content){throw 'NEWS_DNS_PRECONDITION_CONTENT_CHANGED'}
  if([bool]$Record.proxied -ne [bool]$Snapshot.proxied){throw 'NEWS_DNS_PRECONDITION_PROXY_CHANGED'}
  if([int]$Record.ttl -ne [int]$Snapshot.ttl){throw 'NEWS_DNS_PRECONDITION_TTL_CHANGED'}
}

function Set-NewsDnsRecord {
  param($Context,[string]$RecordId,[string]$Content,[bool]$Proxied,[int]$Ttl)
  if($RecordId -notmatch '^[A-Fa-f0-9]{32}$'){throw 'NEWS_DNS_RECORD_ID_INVALID'}
  if([string]::IsNullOrWhiteSpace($Content)){throw 'NEWS_DNS_RECORD_CONTENT_INVALID'}
  if($Ttl -lt 1){throw 'NEWS_DNS_RECORD_TTL_INVALID'}
  $Body=@{
    content=$Content
    proxied=$Proxied
    ttl=$Ttl
  } | ConvertTo-Json -Compress
  $Uri='https://api.cloudflare.com/client/v4/zones/'+$Context.zoneId+'/dns_records/'+$RecordId
  $Response=Invoke-RestMethod -Method Patch -Uri $Uri -Headers ($Context.headers + @{'Content-Type'='application/json'}) -Body $Body -TimeoutSec 20
  if(-not $Response.success){throw 'NEWS_DNS_RECORD_PATCH_FAILED'}
  $Response.result
}

function Test-NewsPublicPc01 {
  $Deadline=(Get-Date).AddSeconds(60)
  $LastStatus=0
  $LastVercel=''
  do {
    try {
      $Response=Invoke-WebRequest -Uri $NewsHealthUrl -UseBasicParsing -TimeoutSec 10 -Headers @{'Cache-Control'='no-cache'}
      $LastStatus=[int]$Response.StatusCode
      $LastVercel=[string]$Response.Headers['x-vercel-id']
      if($LastStatus -eq 200 -and [string]::IsNullOrWhiteSpace($LastVercel)){
        return [pscustomobject]@{ok=$true;status=$LastStatus;vercelHeader=$false}
      }
    } catch {
      $LastStatus=0
      $LastVercel=''
    }
    Start-Sleep -Seconds 2
  } while((Get-Date) -lt $Deadline)
  [pscustomobject]@{ok=$false;status=$LastStatus;vercelHeader=(-not [string]::IsNullOrWhiteSpace($LastVercel))}
}

$Identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$Principal=[Security.Principal.WindowsPrincipal]$Identity
$Elevated=$Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$IsSystem=$Identity.User.Value -eq 'S-1-5-18'
if($Identity.Name -ine $ExpectedUser){throw 'ADMIN_VERIFY_BROKER_IDENTITY_MISMATCH'}
if(-not $Elevated){throw 'ADMIN_VERIFY_BROKER_NOT_ELEVATED'}
if($IsSystem){throw 'ADMIN_VERIFY_BROKER_SYSTEM_NOT_ALLOWED'}
if(-not (Test-Path -LiteralPath $RequestPath -PathType Leaf)){throw 'ADMIN_VERIFY_REQUEST_MISSING'}

$Request=Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
$Schema=[string]$Request.schema
$Action=[string]$Request.action
if($Schema -eq 'TIGERIQ_PC_OPERATOR_ADMIN_REQUEST_V1'){
  if($Action -ne 'verify_elevation'){throw 'ADMIN_VERIFY_REQUEST_ACTION_INVALID'}
}
elseif($Schema -eq 'TIGERIQ_PC_OPERATOR_ADMIN_REQUEST_V2'){
  if(@('news_dns_snapshot','news_dns_cutover','news_dns_rollback') -notcontains $Action){throw 'ADMIN_VERIFY_REQUEST_ACTION_INVALID'}
}
else { throw 'ADMIN_VERIFY_REQUEST_SCHEMA_INVALID' }

if([string]$Request.requestUser -ine $ExpectedUser){throw 'ADMIN_VERIFY_REQUEST_USER_INVALID'}
$Nonce=[string]$Request.nonce
if($Nonce -notmatch '^[A-Za-z0-9-]{16,64}$'){throw 'ADMIN_VERIFY_REQUEST_NONCE_INVALID'}
$RequestedAt=[DateTimeOffset]::Parse([string]$Request.requestedAt)
$Age=((Get-Date).ToUniversalTime()-$RequestedAt.UtcDateTime).TotalSeconds
if($Age -lt -30 -or $Age -gt 120){throw 'ADMIN_VERIFY_REQUEST_STALE'}

$Full=[IO.Path]::GetFullPath([string]$Request.receiptPath)
if(-not $Full.StartsWith($EvidenceRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'ADMIN_VERIFY_RECEIPT_PATH_NOT_ALLOWED'}
if([IO.Path]::GetExtension($Full) -ine '.json'){throw 'ADMIN_VERIFY_RECEIPT_EXTENSION_NOT_ALLOWED'}
if($Action -eq 'verify_elevation'){
  if(-not [IO.Path]::GetFileName($Full).StartsWith('gh5365-admin-verify-',[StringComparison]::OrdinalIgnoreCase)){throw 'ADMIN_VERIFY_RECEIPT_NAME_NOT_ALLOWED'}
}
else {
  if(-not [IO.Path]::GetFileName($Full).StartsWith('gh5648-news-dns-',[StringComparison]::OrdinalIgnoreCase)){throw 'NEWS_DNS_RECEIPT_NAME_NOT_ALLOWED'}
}
if(Test-Path -LiteralPath $Full){throw 'ADMIN_VERIFY_RECEIPT_ALREADY_EXISTS'}

Remove-Item -LiteralPath $RequestPath -Force -ErrorAction Stop

if($Action -eq 'verify_elevation'){
  & "$env:SystemRoot\System32\fltmc.exe" *> $null
  $FltmcExitCode=$LASTEXITCODE
  $Accepted=($Elevated -eq $true -and $IsSystem -eq $false -and $FltmcExitCode -eq 0)
  $Receipt=[ordered]@{
    schema='TIGERIQ_PC_OPERATOR_ADMIN_VERIFY_V1'
    action='verify_elevation'
    nonce=$Nonce
    user=$Identity.Name
    elevated=$Elevated
    isSystem=$IsSystem
    fltmcExitCode=$FltmcExitCode
    accepted=$Accepted
  }
  Write-BrokerReceipt -Path $Full -Data $Receipt
  if(-not $Accepted){exit 5}
  exit 0
}

try {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  $Context=Get-CloudflareContext
  $Current=Get-NewsDnsRecord -Context $Context

  if($Action -eq 'news_dns_snapshot'){
    $Snapshot=[ordered]@{
      schema='TIGERIQ_NEWS_DNS_BACKUP_V1'
      zone=$NewsZone
      hostname=$NewsHostname
      tunnelTarget=$TunnelTarget
      capturedAt=(Get-Date).ToUniversalTime().ToString('o')
      record=(ConvertTo-SafeDnsSnapshot -Record $Current)
    }
    $Temp=$DnsBackupPath+'.'+$PID+'.tmp'
    $Snapshot | ConvertTo-Json -Compress -Depth 8 | Set-Content -LiteralPath $Temp -Encoding UTF8
    Move-Item -LiteralPath $Temp -Destination $DnsBackupPath -Force -ErrorAction Stop
    Write-BrokerReceipt -Path $Full -Data ([ordered]@{
      schema='TIGERIQ_NEWS_DNS_ACTION_V1'
      action=$Action
      nonce=$Nonce
      accepted=$true
      backupPath=$DnsBackupPath
      record=$Snapshot.record
    })
    exit 0
  }

  if(-not (Test-Path -LiteralPath $DnsBackupPath -PathType Leaf)){throw 'NEWS_DNS_BACKUP_MISSING'}
  $Backup=Get-Content -LiteralPath $DnsBackupPath -Raw | ConvertFrom-Json
  if($Backup.schema -ne 'TIGERIQ_NEWS_DNS_BACKUP_V1'){throw 'NEWS_DNS_BACKUP_SCHEMA_INVALID'}
  if([string]$Backup.zone -ine $NewsZone -or [string]$Backup.hostname -ine $NewsHostname){throw 'NEWS_DNS_BACKUP_SCOPE_INVALID'}
  if([string]$Backup.tunnelTarget -ine $TunnelTarget){throw 'NEWS_DNS_BACKUP_TUNNEL_INVALID'}

  if($Action -eq 'news_dns_cutover'){
    Assert-RecordMatchesSnapshot -Record $Current -Snapshot $Backup.record
    $Updated=Set-NewsDnsRecord -Context $Context -RecordId ([string]$Backup.record.id) -Content $TunnelTarget -Proxied $true -Ttl 1
    $Readback=Get-NewsDnsRecord -Context $Context
    if([string]$Readback.id -ne [string]$Backup.record.id -or [string]$Readback.content -ine $TunnelTarget -or [bool]$Readback.proxied -ne $true){
      throw 'NEWS_DNS_CUTOVER_READBACK_FAILED'
    }
    $Public=Test-NewsPublicPc01
    if(-not $Public.ok){
      Set-NewsDnsRecord -Context $Context -RecordId ([string]$Backup.record.id) -Content ([string]$Backup.record.content) -Proxied ([bool]$Backup.record.proxied) -Ttl ([int]$Backup.record.ttl) | Out-Null
      $RollbackReadback=Get-NewsDnsRecord -Context $Context
      Assert-RecordMatchesSnapshot -Record $RollbackReadback -Snapshot $Backup.record
      throw 'NEWS_DNS_CUTOVER_HEALTH_FAILED_ROLLED_BACK'
    }
    Write-BrokerReceipt -Path $Full -Data ([ordered]@{
      schema='TIGERIQ_NEWS_DNS_ACTION_V1'
      action=$Action
      nonce=$Nonce
      accepted=$true
      backupPath=$DnsBackupPath
      before=$Backup.record
      after=(ConvertTo-SafeDnsSnapshot -Record $Readback)
      publicHealth=$Public
    })
    exit 0
  }

  if([string]$Current.id -ne [string]$Backup.record.id){throw 'NEWS_DNS_ROLLBACK_ID_CHANGED'}
  if([string]$Current.name -ine $NewsHostname -or [string]$Current.type -ine 'CNAME'){throw 'NEWS_DNS_ROLLBACK_SCOPE_INVALID'}
  Set-NewsDnsRecord -Context $Context -RecordId ([string]$Backup.record.id) -Content ([string]$Backup.record.content) -Proxied ([bool]$Backup.record.proxied) -Ttl ([int]$Backup.record.ttl) | Out-Null
  $Restored=Get-NewsDnsRecord -Context $Context
  Assert-RecordMatchesSnapshot -Record $Restored -Snapshot $Backup.record
  Write-BrokerReceipt -Path $Full -Data ([ordered]@{
    schema='TIGERIQ_NEWS_DNS_ACTION_V1'
    action=$Action
    nonce=$Nonce
    accepted=$true
    backupPath=$DnsBackupPath
    restored=(ConvertTo-SafeDnsSnapshot -Record $Restored)
  })
  exit 0
}
catch {
  $Message=[string]$_.Exception.Message
  Write-BrokerReceipt -Path $Full -Data ([ordered]@{
    schema='TIGERIQ_NEWS_DNS_ACTION_V1'
    action=$Action
    nonce=$Nonce
    accepted=$false
    error=$Message
    backupPath=$DnsBackupPath
  })
  throw
}
