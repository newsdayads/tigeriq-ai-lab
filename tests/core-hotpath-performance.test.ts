import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const core = readFileSync(new URL('../apps/tigeriq-core/core.mjs', import.meta.url), 'utf8');

describe('TigerIQ Core hot-path performance guard', () => {
  it('preserves manager/skill-loader structure after performance changes', () => {
    expect(core).toMatch(/async function managerTick\(\)/);
    expect(core).toMatch(/matchAndLoadSkills\(goal\)/);
    expect(core).toMatch(/async function invokeProvider\(/);
    expect(core).toMatch(/const resources = \[/);
  });

  it('keeps shell/process spawn out of the normal Core path', () => {
    expect(core).not.toMatch(/node:child_process|from ['\"]child_process|powershell\.exe|cmd\.exe/);
  });

  it('exposes live five-run read-only latency evidence on the existing Core queue', () => {
    expect(core).toContain("url.pathname==='/api/hotpath/sample'");
    expect(core).toContain("kind==='readonly'");
    expect(core).toContain("hotPathStage(row,'QUEUED')");
    expect(core).toContain("hotPathStage(claimed,'CLAIMED')");
    expect(core).toContain("hotPathStage(j,'WORKING')");
    expect(core).toContain("hotPathStage(j,'EVIDENCE'");
    expect(core).toContain("hotPathStage(j,'DONE')");
  });
});
