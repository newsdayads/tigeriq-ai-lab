$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$VerifierPath = Join-Path $PSScriptRoot 'Assert-PC01ApprovedHead.ps1'
if (-not (Test-Path $VerifierPath)) { throw 'APPROVED_HEAD_VERIFIER_MISSING' }
$git = (Get-Command git -ErrorAction Stop).Source
$root = Join-Path ([IO.Path]::GetTempPath()) ("tigeriq-approved-head-test-" + [guid]::NewGuid().ToString('N'))
$remote = Join-Path $root 'remote.git'
$source = Join-Path $root 'source'
$client = Join-Path $root 'client'
$branch = 'wo056/pc01-one-click-bootstrap'

function Invoke-Git([string]$Path,[Parameter(ValueFromRemainingArguments=$true)][string[]]$GitArgs) {
  & $git -C $Path @GitArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git failed: $($GitArgs -join ' ')" }
}
function Assert-Fails([scriptblock]$Action,[string]$Code) {
  try { & $Action } catch { if ($_.Exception.Message -match "^$Code`:") { return }; throw }
  throw "Expected fail-closed code $Code."
}

try {
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  & $git init --bare $remote | Out-Null
  & $git init $source | Out-Null
  Invoke-Git $source @('config','user.email','pc01-test@invalid')
  Invoke-Git $source @('config','user.name','PC01 test')
  Invoke-Git $source @('checkout','-b',$branch)
  Set-Content -Path (Join-Path $source 'state.txt') -Value 'approved' -NoNewline
  Invoke-Git $source @('add','state.txt'); Invoke-Git $source @('commit','-m','approved')
  $approved = (& $git -C $source rev-parse HEAD).Trim()
  Invoke-Git $source @('remote','add','origin',$remote); Invoke-Git $source @('push','origin',$branch)
  & $git clone --branch $branch $remote $client | Out-Null
  & $VerifierPath -RepoPath $client -GitExecutable $git -ExpectedBranch $branch -ApprovedHeadSha $approved -ApprovedRemoteRef "refs/heads/$branch" | Out-Null

  Set-Content -Path (Join-Path $client 'local.txt') -Value 'unreviewed' -NoNewline
  Invoke-Git $client @('add','local.txt'); Invoke-Git $client @('commit','-m','local unreviewed')
  Assert-Fails { & $VerifierPath -RepoPath $client -GitExecutable $git -ExpectedBranch $branch -ApprovedHeadSha $approved -ApprovedRemoteRef "refs/heads/$branch" | Out-Null } 'APPROVED_LOCAL_HEAD_MISMATCH'

  Set-Content -Path (Join-Path $source 'state.txt') -Value 'advanced' -NoNewline
  Invoke-Git $source @('add','state.txt'); Invoke-Git $source @('commit','-m','advanced'); Invoke-Git $source @('push','origin',$branch)
  Assert-Fails { & $VerifierPath -RepoPath $client -GitExecutable $git -ExpectedBranch $branch -ApprovedHeadSha $approved -ApprovedRemoteRef "refs/heads/$branch" | Out-Null } 'APPROVED_LOCAL_HEAD_MISMATCH'
  Invoke-Git $client @('reset','--hard',$approved)
  Assert-Fails { & $VerifierPath -RepoPath $client -GitExecutable $git -ExpectedBranch $branch -ApprovedHeadSha $approved -ApprovedRemoteRef "refs/heads/$branch" | Out-Null } 'APPROVED_REMOTE_HEAD_MISMATCH'
  Write-Host 'PC01_APPROVED_HEAD_PINNING_REGRESSION_PASS'
} finally {
  if (Test-Path $root) { Remove-Item -Recurse -Force $root }
}
