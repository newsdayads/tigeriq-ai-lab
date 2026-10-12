#requires -Version 5.1
<#
.SYNOPSIS
  Read-only SMB share boundary preflight for TigerIQ portfolio issue #4661.
.DESCRIPTION
  Detects broad write grants on non-special SMB shares whose local paths
  cover the inspected root (or sit inside it). Never returns share names,
  SMB UNC paths, usernames, credential values, or raw local paths.
  Does not test remote reachability or effective access. Does not mutate shares.
.EXITCODES
  0 = no broad non-special SMB write grant detected
  2 = broad non-special SMB share write grant detected
  3 = audit error or unresolved writable principal (fail closed)
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateNotNullOrEmpty()]
  [string]$RootPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Normalize-LocalPath {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { throw 'INVALID_PATH' }
  $resolved = [System.IO.Path]::GetFullPath($Value).TrimEnd('\')
  if ($resolved -match '^[A-Za-z]:$') { $resolved += '\' }
  if ($resolved -notmatch '^[A-Za-z]:\\') { throw 'LOCAL_DRIVE_PATH_REQUIRED' }
  return $resolved
}

function Assert-NoRootReparse {
  param([string]$Path)
  $cursor = [System.IO.Path]::GetFullPath($Path)
  for ($step=0; $step -lt 64; $step++) {
    $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'REPARSE_ROOT_NOT_ALLOWED'
    }
    $parent = [System.IO.Directory]::GetParent($cursor)
    if ($null -eq $parent) { return }
    $cursor = $parent.FullName
  }
  throw 'REPARSE_ANCESTOR_DEPTH_EXCEEDED'
}

function Test-PathScopeOverlap {
  param([string]$Root,[string]$SharePath)
  $r = $Root.TrimEnd('\')
  $s = $SharePath.TrimEnd('\')
  if ([string]::Equals($r,$s,[StringComparison]::OrdinalIgnoreCase)) { return $true }
  if ($r.StartsWith(($s+'\'),[StringComparison]::OrdinalIgnoreCase)) { return $true }
  if ($s.StartsWith(($r+'\'),[StringComparison]::OrdinalIgnoreCase)) { return $true }
  return $false
}

$principalMap = @{
  'S-1-1-0' = 'EVERYONE'
  'S-1-5-11' = 'AUTHENTICATED_USERS'
  'S-1-5-32-545' = 'BUILTIN_USERS'
}

try {
  $root = Normalize-LocalPath -Value $RootPath
  if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    throw 'ROOT_NOT_DIRECTORY'
  }
  Assert-NoRootReparse -Path $root
  $allShares = @(Get-SmbShare -ErrorAction Stop)
  $findings = @()
  $overlapping = 0
  $special = 0
  $unknown = 0
  $unresolvedSharePaths = 0
  $counter = 0
  foreach ($share in $allShares) {
    # Special shares are not security assertions about non-special exports.
    # Unknown/non-drive paths on non-special shares may hide volume aliases.
    # Never silently omit them from the audit and return a false safe result.
    $rawSharePath = [string]$share.Path
    if ($rawSharePath -notmatch '^[A-Za-z]:\\') {
      if (-not [bool]$share.Special) { $unresolvedSharePaths++ }
      continue
    }
    $sharePath = Normalize-LocalPath -Value $rawSharePath
    # A share outside RootPath may alias into it via a junction/symlink.
    # Check every share path and its ancestors BEFORE lexical overlap filtering.
    # Unresolvable paths remain INCONCLUSIVE, never a false safe result.
    try {
      Assert-NoRootReparse -Path $sharePath
    } catch {
      $unresolvedSharePaths++
      continue
    }
    if (-not (Test-PathScopeOverlap -Root $root -SharePath $sharePath)) { continue }
    $overlapping++
    if ([bool]$share.Special) { $special++; continue }
    $counter++
    $aces = @(Get-SmbShareAccess -Name $share.Name -ErrorAction Stop)
    $principals = @()
    foreach ($ace in $aces) {
      if ($ace.AccessControlType -ne 'Allow') { continue }
      if ($ace.AccessRight -notin @('Full','Change')) { continue }
      try {
        $sid = ([System.Security.Principal.NTAccount]::new([string]$ace.AccountName)).Translate(
          [System.Security.Principal.SecurityIdentifier]
        ).Value
      } catch {
        $identity = [string]$ace.AccountName
        if ($principalMap.ContainsKey($identity)) { $sid = $identity }
        else { $unknown++; continue }
      }
      if ($principalMap.ContainsKey($sid)) {
        $principals += $principalMap[$sid]
      }
    }
    if ($principals.Count -gt 0) {
      $findings += [pscustomobject]@{
        scope = ('NON_SPECIAL_SHARE_' + $counter)
        broad_write = $true
        principal_classes = @($principals | Sort-Object -Unique)
      }
    }
  }
  $risk = ($findings.Count -gt 0)
  $status = if ($risk) { 'BROAD_SMB_WRITE_GRANT' } elseif ($unresolvedSharePaths -gt 0) {
    'INCONCLUSIVE_SHARE_PATH'
  } elseif ($unknown -gt 0) { 'INCONCLUSIVE_UNMAPPED_SHARE_ACCOUNT' }
  else { 'NO_BROAD_NON_SPECIAL_SHARE_WRITE_GRANT' }
  [pscustomobject]@{
    schema = 'TIGERIQ_SMB_BOUNDARY_AUDIT_V1'
    mode = 'READ_ONLY'
    status = $status
    shares_inspected = $allShares.Count
    shares_overlapping_root = $overlapping
    special_shares_excluded = $special
    non_special_scopes_checked = $counter
    broad_write_share_count = $findings.Count
    unmapped_write_principal_count = $unknown
    unresolved_share_path_count = $unresolvedSharePaths
    findings = $findings
    mutation_performed = $false
    effective_access_verified = $false
    remote_reachability_verified = $false
  } | ConvertTo-Json -Depth 5
  if ($risk) { exit 2 }
  if ($unresolvedSharePaths -gt 0 -or $unknown -gt 0) { exit 3 }
  exit 0
} catch {
  [pscustomobject]@{
    schema = 'TIGERIQ_SMB_BOUNDARY_AUDIT_V1'
    mode = 'READ_ONLY'
    status = 'AUDIT_ERROR'
    error_code = if ($_.Exception.Message -match '^(INVALID_PATH|LOCAL_DRIVE_PATH_REQUIRED|ROOT_NOT_DIRECTORY|REPARSE_ROOT_NOT_ALLOWED|REPARSE_ANCESTOR_DEPTH_EXCEEDED)$') {
      $_.Exception.Message
    } else { 'UNCLASSIFIED_READ_ERROR' }
    mutation_performed = $false
    effective_access_verified = $false
    remote_reachability_verified = $false
  } | ConvertTo-Json -Depth 4
  exit 3
}
