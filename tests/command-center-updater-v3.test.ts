import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/pc-worker/command-center-updater-v3.ps1', 'utf8');

describe('Command Center updater V3 rollback contract', () => {
  it('fails closed when the first live release has no previous pointer', () => {
    const liveFailure = source.match(/if\(-not \(Wait-Health "http:\/\/\$HostIp`:\$Port\/api\/status" 50\)\) \{([\s\S]*?)throw 'LIVE_HEALTH_FAILED_ROLLED_BACK'/)?.[1] ?? '';

    expect(liveFailure).toContain('Stop-ScheduledTask -TaskName $taskName');
    expect(liveFailure).toMatch(/if\(\$previous\)\{[\s\S]*?Start-ScheduledTask -TaskName \$taskName/);
    expect(liveFailure).toMatch(/else \{[\s\S]*?Remove-Item -Force -LiteralPath \$currentPath/);

    const noPreviousBranch = liveFailure.split('} else {')[1] ?? '';
    expect(noPreviousBranch).not.toContain('Start-ScheduledTask -TaskName $taskName');
  });
});
