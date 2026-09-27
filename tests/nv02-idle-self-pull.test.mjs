import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('NV02 idle self-pull continuity', () => {
  it('durably idles without local continue/model-loop dispatch', () => {
    const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs', 'utf8');
    expect(bridge).toContain("stateBefore.idleState==='READY_NO_ELIGIBLE_WORK'");
    expect(bridge).toContain("status:'READY_NO_ELIGIBLE_WORK_IDLE'");
    expect(bridge).toContain("action==='NV02_IDLE'");
  });
  it('keeps backlog selection outside App Chrome', () => {
    const server = readFileSync('apps/chrome-controller/src/server.ts', 'utf8');
    expect(server).toContain("action==='idle'");
    expect(server).not.toContain('github/issues');
    expect(readFileSync('apps/tigeriq-core/work-routing-policy.mjs', 'utf8')).toContain('Core không assign/route NV02');
  });
});
