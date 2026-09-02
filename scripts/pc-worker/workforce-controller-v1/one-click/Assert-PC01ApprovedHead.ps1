param(
  [Parameter(Mandatory=$true)][string]$RepoPath,
  [Parameter(Mandatory=$true)][string]$GitExecutable,
  [Parameter(Mandatory=$true)][string]$ExpectedBranch,
  [Parameter(Mandatory=$true)][string]$ApprovedHeadSha,
  [Parameter(Mandatory=$true)][string]$ApprovedRemoteRef
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string]$Code,[string]$Message) { throw "$Code`: $Message" }
function Git-Text([string[]]$GitArgs) {
  $global:LASTEXITCODE = 0
  $result = (& $GitExecutable @GitArgs 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { Fail 'GIT_COMMAND_FAILED' "git $($GitArgs -join ' ') failed." }
  return $result
}

if ($ApprovedHeadSha -notmatch '^[0-9a-fA-F]{40}$') { Fail 'APPROVED_HEAD_INVALID' 'Approved bootstrap SHA must be a full immutable 40-character commit SHA.' }
if ($ApprovedRemoteRef -ne "refs/heads/$ExpectedBranch") { Fail 'APPROVED_REMOTE_REF_INVALID' 'Approved remote ref must be the configured bootstrap branch ref.' }
if (-not (Test-Path (Join-Path $RepoPath '.git'))) { Fail 'REPO_MISSING' "TigerIQ repository not found at $RepoPath." }

$branch = Git-Text -GitArgs @('-C',$RepoPath,'branch','--show-current')
if ($branch -ne $ExpectedBranch) { Fail 'WRONG_BRANCH' "Expected bootstrap branch $ExpectedBranch; current branch is $branch." }
$localHead = Git-Text -GitArgs @('-C',$RepoPath,'rev-parse','HEAD')
if ($localHead -ne $ApprovedHeadSha) { Fail 'APPROVED_LOCAL_HEAD_MISMATCH' "Local HEAD $localHead is not approved SHA $ApprovedHeadSha." }

$remoteLine = Git-Text -GitArgs @('-C',$RepoPath,'ls-remote','--exit-code','origin',$ApprovedRemoteRef)
$remoteParts = @($remoteLine -split "`t" | Where-Object { $_ })
if ($remoteParts.Count -lt 1 -or $remoteParts[0] -notmatch '^[0-9a-fA-F]{40}$') { Fail 'APPROVED_REMOTE_REF_MISSING' "Could not resolve approved remote ref $ApprovedRemoteRef." }
$remoteHead = $remoteParts[0].ToLowerInvariant()
if ($remoteHead -ne $ApprovedHeadSha.ToLowerInvariant()) { Fail 'APPROVED_REMOTE_HEAD_MISMATCH' "Remote ref $ApprovedRemoteRef moved to $remoteHead; approved SHA remains $ApprovedHeadSha." }

[ordered]@{ branch=$branch; head=$localHead; remoteHead=$remoteHead; approvedHead=$ApprovedHeadSha.ToLowerInvariant(); approvedRemoteRef=$ApprovedRemoteRef; exactMatch=$true }
