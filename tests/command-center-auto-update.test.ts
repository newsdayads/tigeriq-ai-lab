import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const updater = readFileSync('scripts/pc-worker/auto-update-command-center.ps1', 'utf8');
const installer = readFileSync('scripts/pc-worker/install-command-center.ps1', 'utf8');

describe('Command Center automatic updater safety contract', () => {
  it('keeps the installed V2 updater isolated and non-destructive', () => {
    expect(updater).not.toContain('ConvertFrom-Json -AsHashtable');
    expect(updater).toContain("$releaseRoot = Join-Path $runtimeDir 'releases'");
    expect(updater).toContain("$releaseDir = Join-Path $releaseRoot");
    expect(updater).toContain("$needle = \"`$workspace = 'F:\\TigerIQ\\Workspace\\tigeriq-ai-lab'\"");
    expect(updater).toContain("$replacement = \"`$workspace = '$releaseDir'\"");
    expect(updater).not.toContain('git reset --hard');
    expect(updater).not.toContain('git clean -fd');
    expect(updater).not.toContain('Remove-Item -Recurse');
  });

  it('requires exact old-channel SHA and successful CI before invoking the bridge', () => {
    expect(updater).toContain("$head -notmatch '^[0-9a-f]{40}$'");
    expect(updater).toContain('head_sha=$head&status=completed');
    expect(updater).toContain("$_.name -eq 'CI' -and $_.conclusion -eq 'success'");
    expect(updater).toContain('-Commit $head');
    expect(installer).toContain("[string]$Commit = ''");
    expect(installer).toContain("if(-not $Commit){ Fail 'EXACT_COMMIT_REQUIRED'");
    expect(installer).toContain('if($Commit -and $head -ne $Commit)');
  });

  it('migrates only to a CI + bundle verified V3 release channel', () => {
    expect(installer).toContain("$targetBranch = 'wo250/command-center-artifact-updater-v3'");
    expect(installer).toContain("$_.name -eq 'CI' -and $_.conclusion -eq 'success'");
    expect(installer).toContain("$_.name -eq 'Command Center Release Bundle' -and $_.conclusion -eq 'success'");
    expect(installer).toContain('TIGERIQ_COMMAND_CENTER_UPDATER_V3_BOOTSTRAP');
    expect(installer).toContain("Disable-ScheduledTask -TaskName $updaterTaskName");
  });

  it('retires V2 only after live V3 health and posts physical runtime evidence', () => {
    const healthIndex = installer.indexOf('Invoke-RestMethod -UseBasicParsing -Uri $healthUrl');
    const disableIndex = installer.indexOf('Disable-ScheduledTask -TaskName $updaterTaskName');
    expect(healthIndex).toBeGreaterThan(-1);
    expect(disableIndex).toBeGreaterThan(healthIndex);
    expect(installer).toContain('TIGERIQ_ZERO_TOUCH_DEPLOY_READY');
    expect(installer).toContain('ownerAction=false');
    expect(installer).toContain('mainProductionChanged=false');
  });
});
