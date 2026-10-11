import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const ntfs = readFileSync('scripts/security/audit-pc01-ntfs-boundary.ps1', 'utf8');
const smb = readFileSync('scripts/security/audit-pc01-smb-boundary.ps1', 'utf8');
const ciParser = readFileSync('scripts/verify-powershell.ps1', 'utf8');

function executablePowerShell(source: string): string {
  // Exclude documentation blocks and full-line comments so declarations
  // such as "NO Set-Acl" do not falsely look like mutations.
  return source.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '');
}

describe('PC01 NTFS and SMB boundary preflight source safety gate (#4661)', () => {
  it('keeps both audit scripts explicitly read-only, with no mutation commands', () => {
    const mutation = /\b(?:Set-Acl|Set-SmbShare|New-SmbShare|Remove-SmbShare|Grant-SmbShareAccess|Revoke-SmbShareAccess|Block-SmbShareAccess|Set-NetFirewallRule|New-NetFirewallRule|Remove-NetFirewallRule|Stop-Service|Restart-Service|Start-Service|Remove-Item|Set-Content|Add-Content|Out-File|icacls|netsh)\b/i;
    for (const source of [ntfs, smb]) {
      expect(executablePowerShell(source)).not.toMatch(mutation);
      expect(source).toContain('mutation_performed = $false');
      expect(source).toContain('mode = \'READ_ONLY\'');
    }
  });

  it('keeps the CI PowerShell parser covering the security audit directory', () => {
    expect(ciParser).toContain("(Join-Path $PSScriptRoot 'security')");
    expect(ciParser).toContain('Parser]::ParseFile');
  });

  it('checks broad NTFS write rights before attempting SID translation', () => {
    const iMask = ntfs.indexOf('if (([int64]$ace.FileSystemRights -band $writeMask) -eq 0) { continue }');
    const iTranslate = ntfs.indexOf('.Translate([System.Security.Principal.SecurityIdentifier])');
    expect(iMask).toBeGreaterThan(0);
    expect(iTranslate).toBeGreaterThan(iMask);
    for (const sid of ['S-1-1-0', 'S-1-5-11', 'S-1-5-32-545']) {
      expect(ntfs).toContain(sid);
    }
    expect(ntfs).toContain('INCONCLUSIVE_UNMAPPED_SID');
    expect(ntfs).toContain('if ($script:UnmappedAceCount -gt 0) { exit 3 }');
  });

  it('fails closed on lexical NTFS path escape and reparse point traversal', () => {
    expect(ntfs).toContain('TARGET_OUTSIDE_ROOT');
    expect(ntfs).toContain('Assert-NoReparseSegments -Path $Path');
    expect(ntfs).toContain('[System.IO.FileAttributes]::ReparsePoint');
    expect(ntfs).toContain('REPARSE_PATH_NOT_ALLOWED');
    expect(ntfs).toContain('REPARSE_ANCESTOR_DEPTH_EXCEEDED');
  });

  it('checks only allowed SMB grant classes on non-special shares', () => {
    expect(smb).toContain('Get-SmbShare -ErrorAction Stop');
    expect(smb).toContain('Get-SmbShareAccess -Name $share.Name -ErrorAction Stop');
    expect(smb).toContain('if ([bool]$share.Special) { $special++; continue }');
    expect(smb).toContain("if ($ace.AccessRight -notin @('Full','Change')) { continue }");
    expect(smb).toContain("if ($ace.AccessControlType -ne 'Allow') { continue }");
    expect(smb).toContain('BROAD_SMB_WRITE_GRANT');
  });

  it('rejects SMB root junctions and does not confuse lexical paths with ACL security', () => {
    expect(smb).toContain('Assert-NoRootReparse -Path $root');
    expect(smb).toContain('[System.IO.FileAttributes]::ReparsePoint');
    expect(smb).toContain('REPARSE_ROOT_NOT_ALLOWED');
    expect(smb).toContain('Test-PathScopeOverlap -Root $root -SharePath $sharePath');
    expect(smb).toContain('LOCAL_DRIVE_PATH_REQUIRED');
    expect(smb).toContain('INCONCLUSIVE_UNMAPPED_SHARE_ACCOUNT');
  });

  it('fails closed on SMB share junction aliases before lexical scope filtering', () => {
    // A share at C:\\alias can be a junction to D:\\TigerIQ even when the
    // share path has no lexical overlap with RootPath=D:\\TigerIQ.
    const inspectShare = smb.indexOf('Assert-NoRootReparse -Path $sharePath');
    const lexicalFilter = smb.indexOf('if (-not (Test-PathScopeOverlap -Root $root -SharePath $sharePath)) { continue }');
    expect(inspectShare).toBeGreaterThan(0);
    expect(lexicalFilter).toBeGreaterThan(inspectShare);
    expect(smb).toContain('unresolvedSharePaths++');
    expect(smb).toContain("INCONCLUSIVE_SHARE_PATH");
    expect(smb).toContain('unresolved_share_path_count = $unresolvedSharePaths');
    expect(smb).toContain('if ($unresolvedSharePaths -gt 0 -or $unknown -gt 0) { exit 3 }');
    // Read-only source check: Windows junction behavior requires a separate
    // real-Windows negative fixture; no cross-project E2E PASS is inferred.
  });

  it('does not claim either audit establishes effective or remote authorization', () => {
    expect(ntfs).toContain('authorization_e2e_verified = $false');
    expect(smb).toContain('effective_access_verified = $false');
    expect(smb).toContain('remote_reachability_verified = $false');
    expect(smb).toContain('principal_classes');
    // The public output is classes + counts, not raw share identifiers.
    expect(smb).not.toMatch(/^\s+share_name\s*=/m);
    expect(smb).not.toMatch(/^\s+share_path\s*=/m);
    expect(smb).not.toMatch(/^\s+unc_path\s*=/m);
  });

  it('preserves distinct safe, risk and inconclusive exit codes', () => {
    for (const src of [ntfs, smb]) {
      expect(src).toContain('exit 0');
      expect(src).toContain('exit 2');
      expect(src).toContain('exit 3');
      expect(src).toContain("status = 'AUDIT_ERROR'");
    }
  });
});
