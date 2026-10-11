#requires -Version 5.1
<#
.SYNOPSIS
  Read-only PC01 NTFS boundary preflight for TigerIQ portfolio audit #4661.
.DESCRIPTION
  Reports broad ALLOW write permissions (Everyone, Authenticated Users,
  builtin Users) on the selected root, its parent, and selected descendants.
  NO Set-Acl, icacls grant/restore, file content access, secret collection,
  logging of raw paths, restart, network traffic, or persistent output.
  A broad allow ACE is a risk indicator, NOT an effective-access or intrusion proof.
.EXITCODES
  0 = no broad ALLOW write ACE found; 2 = at least one risk; 3 = audit error.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateNotNullOrEmpty()]
  [string]$RootPath,
  [string[]]$RelativePaths=@('.')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:UnmappedAceCount = 0

function Get-BroadWriteAces {
  param([Parameter(Mandatory=$true)]$Acl)
  $principalMap = @{
    'S-1-1-0'      = 'EVERYONE'
    'S-1-5-11'     = 'AUTHENTICATED_USERS'
    'S-1-5-32-545' = 'BUILTIN_USERS'
  }
  # WRITE_DATA / APPEND_DATA / WRITE_EA / DELETE_CHILD / WRITE_ATTRIBUTES /
  # DELETE / WRITE_DAC / WRITE_OWNER. This is an over-approximation of
  # broad write grants; deny ACEs and share-level rights are not evaluated.
  [int64]$writeMask = 0x2 -bor 0x4 -bor 0x10 -bor 0x40 -bor 0x100 -bor 0x10000 -bor 0x40000 -bor 0x80000
  $found = @()
  foreach ($ace in $Acl.Access) {
    if ($ace.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
    try {
      $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch {
      # Orphaned/unmapped local SIDs are not evidence of a well-known broad group.
      # Preserve an incomplete-audit signal instead of a false safe result.
      $identityValue = [string]$ace.IdentityReference.Value
      if ($principalMap.ContainsKey($identityValue)) {
        $sid = $identityValue
      } else {
        $script:UnmappedAceCount++
        continue
      }
    }
    if (-not $principalMap.ContainsKey($sid)) { continue }
    if (([int64]$ace.FileSystemRights -band $writeMask) -eq 0) { continue }
    $found += [pscustomobject]@{
      principal = $principalMap[$sid]
      inherited = [bool]$ace.IsInherited
      rights = [string]$ace.FileSystemRights
    }
  }
  return $found
}

function Get-ScopedAclRecord {
  param([string]$Path, [string]$Scope)
  $a = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $matches = @(Get-BroadWriteAces -Acl $a)
  return [pscustomobject]@{
    scope = $Scope
    inheritance_enabled = -not [bool]$a.AreAccessRulesProtected
    broad_allow_write = ($matches.Count -gt 0)
    broad_aces = $matches
  }
}

try {
  if ($RelativePaths.Count -lt 1 -or $RelativePaths.Count -gt 50) {
    throw 'INVALID_TARGET_COUNT'
  }
  $root = [System.IO.Path]::GetFullPath($RootPath).TrimEnd('\')
  if ($root -match '^[A-Za-z]:$') { $root += '\' }
  if ([string]::IsNullOrWhiteSpace($root)) { throw 'INVALID_ROOT' }
  if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'ROOT_NOT_DIRECTORY' }

  $records = @()
  $parent = [System.IO.Directory]::GetParent($root)
  if ($null -ne $parent) {
    $records += Get-ScopedAclRecord -Path $parent.FullName -Scope 'PARENT'
  }
  $records += Get-ScopedAclRecord -Path $root -Scope 'ROOT'

  $prefix = $root.TrimEnd('\') + '\'
  $i = 0
  foreach ($rel in $RelativePaths) {
    $i++
    if ([string]::IsNullOrWhiteSpace($rel)) { throw 'EMPTY_TARGET' }
    $candidate = [System.IO.Path]::GetFullPath((Join-Path -Path $root -ChildPath $rel))
    if (
      -not [string]::Equals($candidate.TrimEnd('\'), $root, [System.StringComparison]::OrdinalIgnoreCase) -and
      -not $candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
      throw 'TARGET_OUTSIDE_ROOT'
    }
    if (-not (Test-Path -LiteralPath $candidate)) { throw 'TARGET_NOT_FOUND' }
    $records += Get-ScopedAclRecord -Path $candidate -Scope ('TARGET_' + $i)
  }

  $riskCount = @($records | Where-Object { $_.broad_allow_write }).Count
  [pscustomobject]@{
    schema = 'TIGERIQ_NTFS_BOUNDARY_AUDIT_V1'
    mode = 'READ_ONLY'
    status = $(if ($riskCount -gt 0) { 'BROAD_WRITE_RISK' } elseif ($script:UnmappedAceCount -gt 0) { 'INCONCLUSIVE_UNMAPPED_SID' } else { 'NO_BROAD_WRITE_ACE_DETECTED' })
    scopes_checked = $records.Count
    scopes_at_risk = $riskCount
    unmapped_ace_count = $script:UnmappedAceCount
    mutation_performed = $false
    authorization_e2e_verified = $false
    records = $records
  } | ConvertTo-Json -Depth 6
  if ($riskCount -gt 0) { exit 2 }
  if ($script:UnmappedAceCount -gt 0) { exit 3 }
  exit 0
} catch {
  [pscustomobject]@{
    schema = 'TIGERIQ_NTFS_BOUNDARY_AUDIT_V1'
    mode = 'READ_ONLY'
    status = 'AUDIT_ERROR'
    mutation_performed = $false
    authorization_e2e_verified = $false
    error_code = $(if ($_.Exception.Message -match '^(ACL_IDENTITY_TRANSLATION_FAILED|INVALID_TARGET_COUNT|INVALID_ROOT|ROOT_NOT_DIRECTORY|EMPTY_TARGET|TARGET_OUTSIDE_ROOT|TARGET_NOT_FOUND)$') { $_.Exception.Message } else { 'UNCLASSIFIED_READ_ERROR' })
  } | ConvertTo-Json -Depth 3
  exit 3
}
