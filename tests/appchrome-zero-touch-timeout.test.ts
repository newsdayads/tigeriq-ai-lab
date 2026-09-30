import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('App Chrome zero-touch NV02 wake timeout contract', () => {
  const helper=readFileSync('scripts/tigeriq-core/appchrome-zero-touch.ps1','utf8');
  const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
  const config=JSON.parse(readFileSync('apps/chrome-controller/chrome-controller.config.example.json','utf8'));

  it('keeps the helper HTTP timeout above the controller bounded LOCAL_CONTINUE_NOW budget', () => {
    const requestTimeoutSec=Number(helper.match(/\$nv02ResumeRequestTimeoutSec=(\d+)/)?.[1]);
    const wakeDeadlineSec=Number(helper.match(/\$nv02WakeDeadlineSec=(\d+)/)?.[1]);
    const resumeStart=server.indexOf("if(action==='resume')");
    const resumeEnd=server.indexOf("if(action==='idle')",resumeStart);
    const resumeBlock=server.slice(resumeStart,resumeEnd);
    const attempts=Number(resumeBlock.match(/attempt<=([0-9]+)/)?.[1]);
    const retryDelayMs=Number(resumeBlock.match(/await delay\((\d+)\)/)?.[1]);
    const commandTimeoutMs=Number(config.pacing.commandTimeoutMs);
    const worstCaseMs=attempts*commandTimeoutMs+(attempts-1)*retryDelayMs;

    expect(resumeStart).toBeGreaterThan(-1);
    expect(resumeEnd).toBeGreaterThan(resumeStart);
    expect(attempts).toBe(3);
    expect(commandTimeoutMs).toBeGreaterThanOrEqual(60_000);
    expect(requestTimeoutSec*1000).toBeGreaterThan(worstCaseMs);
    expect(wakeDeadlineSec).toBeGreaterThanOrEqual(requestTimeoutSec);
    expect(helper).toContain("-TimeoutSec $nv02ResumeRequestTimeoutSec");
  });
});
