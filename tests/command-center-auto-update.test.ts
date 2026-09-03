import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const updater = readFileSync('scripts/pc-worker/auto-update-command-center.ps1', 'utf8');
const installer = readFileSync('scripts/pc-worker/install-command-center.ps1', 'utf8');

describe('Command Center automatic updater safety contract', () => {
  it('is Windows PowerShell 5.1 compatible and uses isolated immutable releases', () => {
    expect(updater).not.toContain('ConvertFrom-Json -AsHashtable');
    expect(updater).toContain("$releaseRoot = Join-Path $runtimeDir 'releases'");
    expect(updater).toContain("$releaseDir = Join-Path $releaseRoot");
    expect(updater).toContain("$needle = \"`$workspace = 'F:\\TigerIQ\\Workspace\\tigeriq-ai-lab'\"");
    expect(updater).toContain("$replacement = \"`$workspace = '$releaseDir'\"");
    expect(updater).not.toContain('git reset --hard');
    expect(updater).not.toContain('git clean -fd');
    expect(updater).not.toContain('Remove-Item -Recurse');
  });

  it('requires an exact branch head with successful CI before installing', () => {
    expect(updater).toContain("$head -notmatch '^[0-9a-f]{40}$'");
    expect(updater).toContain("head_sha=$head&status=completed");
    expect(updater).toContain("$_.name -eq 'CI' -and $_.conclusion -eq 'success'");
    expect(updater).toContain("-Commit $head");
    expect(installer).toContain("[string]$Commit = ''");
    expect(installer).toContain("if($Commit -and $head -ne $Commit)");
  });

  it('bootstraps a SYSTEM updater task without weakening the private runtime boundary', () => {
    expect(installer).toContain("$updaterTaskName = 'TigerIQ Command Center Updater'");
    expect(installer).toContain("-RepetitionInterval (New-TimeSpan -Minutes 5)");
    expect(installer).toContain("-MultipleInstances IgnoreNew");
    expect(installer).toContain("-RemoteAddress '100.64.0.0/10'");
    expect(installer).toContain("wildcardExposure = $false");
    expect(installer).toContain("ciGate='CI success + exact SHA'");
  });
});
