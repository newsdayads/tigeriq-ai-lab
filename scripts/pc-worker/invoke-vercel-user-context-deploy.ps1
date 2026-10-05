$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$ExpectedUser='pc01\wdragons12x'
$TaskName='TigerIQ Vercel LIVE OneShot Deploy'
$RepoRoot='D:\TigerIQ\Runtime\CoreSource'
$RequestPath='D:\TigerIQ\Evidence\Vercel\live-r7-request.json'
$ReceiptPath='D:\TigerIQ\Evidence\Vercel\live-r7-receipt.json'
$DeployScript=Join-Path $RepoRoot 'scripts\pc-worker\vercel-tigeriq-live-3150-deploy.mjs'
$identity=''

function Resolve-AccountSid([string]$account){try{return (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value}catch{return ''}}
function Write-SafeReceipt($value){
  $dir=Split-Path -Parent $ReceiptPath
  New-Item -ItemType Directory -Force -Path $dir|Out-Null
  [IO.File]::WriteAllText($ReceiptPath,($value|ConvertTo-Json -Compress -Depth 6),(New-Object Text.UTF8Encoding($false)))
}
function Fail([string]$code){throw $code}

try{
  $expectedSid=Resolve-AccountSid $ExpectedUser
  $current=[Security.Principal.WindowsIdentity]::GetCurrent()
  $identity=[string]$current.Name
  if(-not $expectedSid -or [string]$current.User.Value-ne$expectedSid){Fail 'VERCEL_USER_CONTEXT_IDENTITY_MISMATCH'}
  if(-not(Test-Path -LiteralPath $RequestPath -PathType Leaf)){Fail 'VERCEL_USER_CONTEXT_REQUEST_MISSING'}
  if(-not(Test-Path -LiteralPath $DeployScript -PathType Leaf)){Fail 'VERCEL_USER_CONTEXT_DEPLOY_SCRIPT_MISSING'}
  try{$request=Get-Content -LiteralPath $RequestPath -Raw|ConvertFrom-Json -ErrorAction Stop}catch{Fail 'VERCEL_USER_CONTEXT_REQUEST_INVALID'}
  if([string]$request.taskName-ne$TaskName){Fail 'VERCEL_USER_CONTEXT_TASK_NAME_MISMATCH'}
  if([string]$request.expectedUser-ine$ExpectedUser){Fail 'VERCEL_USER_CONTEXT_REQUEST_USER_MISMATCH'}
  if([string]$request.releaseClass-ne'WEB_LIVE'){Fail 'VERCEL_USER_CONTEXT_RELEASE_CLASS_INVALID'}
  if(-not([bool]$request.ownerAuthorized)){Fail 'VERCEL_USER_CONTEXT_OWNER_AUTH_REQUIRED'}
  if([string]::IsNullOrWhiteSpace([string]$request.releaseReason)){Fail 'VERCEL_USER_CONTEXT_RELEASE_REASON_REQUIRED'}
  if([string]$request.expectedSha-notmatch'^[0-9a-fA-F]{40}$'){Fail 'VERCEL_USER_CONTEXT_SHA_INVALID'}
  if([string]$request.releaseIssue-notmatch'^\d+$'){Fail 'VERCEL_USER_CONTEXT_ISSUE_INVALID'}

  $node=(Get-Command node.exe -ErrorAction SilentlyContinue)
  if(-not $node){Fail 'VERCEL_CLI_MISSING'}
  $output=& $node.Source $DeployScript '--sha' ([string]$request.expectedSha) '--issue' ([string]$request.releaseIssue) '--release-class' 'WEB_LIVE' '--owner-authorized' 'true' '--release-reason' ([string]$request.releaseReason) 2>&1
  $exit=$LASTEXITCODE
  $lines=@($output|ForEach-Object{[string]$_}|Where-Object{-not[string]::IsNullOrWhiteSpace($_)})
  if($exit-ne0){
    $code=($lines|Select-Object -Last 1).Trim()
    if($code-notmatch'^VERCEL_[A-Z0-9_]+$'){$code='VERCEL_DEPLOY_FAILED'}
    Fail $code
  }
  $receipt=$null
  for($i=$lines.Count-1;$i-ge0;$i--){
    try{$parsed=$lines[$i]|ConvertFrom-Json -ErrorAction Stop;if([string]$parsed.status-eq'TIGERIQ_LIVE_3150_PRODUCTION_DEPLOYED'){$receipt=$parsed;break}}catch{}
  }
  if(-not $receipt){Fail 'VERCEL_USER_CONTEXT_DEPLOY_RECEIPT_MISSING'}
  $safe=[ordered]@{
    status=[string]$receipt.status;deploymentUrl=[string]$receipt.deploymentUrl
    projectId=[string]$receipt.projectId;teamId=[string]$receipt.teamId;repo=[string]$receipt.repo
    branch=[string]$receipt.branch;target=[string]$receipt.target;exactSha=[string]$receipt.exactSha
    issue=[string]$receipt.issue;releaseClass=[string]$receipt.releaseClass;maxAttempts=[int]$receipt.maxAttempts
    secretsPrinted=$false;executionIdentity=$identity;taskName=$TaskName;taskPrincipal=$ExpectedUser
    taskLogonType='InteractiveToken';taskRunLevel='Highest'
  }
  Write-SafeReceipt $safe
  $safe|ConvertTo-Json -Compress
  exit 0
}catch{
  $code=[string]$_.Exception.Message
  if($code-notmatch'^VERCEL_[A-Z0-9_]+$'){$code='VERCEL_USER_CONTEXT_DEPLOY_FAILED'}
  Write-SafeReceipt ([ordered]@{status='FAILED';failure=$code;executionIdentity=$identity;taskName=$TaskName;taskPrincipal=$ExpectedUser;secretsPrinted=$false})
  [Console]::Error.WriteLine($code)
  exit 1
}
