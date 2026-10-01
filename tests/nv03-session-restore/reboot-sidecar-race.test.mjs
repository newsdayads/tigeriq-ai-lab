import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyNv03Session, planNv03SessionRecovery, NV03_SESSION_STATES } from '../../scripts/nv03-session-restore/session-policy.mjs';

describe('NV03 reboot sidecar race regression',()=>{
  it('preserves interactive Chrome when only sidecar is missing',()=>{
    const snapshot={
      activeSessionId:1,
      chrome:{listening:true,sessionId:1,scopeMatched:true},
      sidecar:{listening:false,sessionId:null,scopeMatched:true},
    };
    expect(classifyNv03Session(snapshot).state).toBe(NV03_SESSION_STATES.CHROME_INTERACTIVE_SIDECAR_MISSING);
    expect(planNv03SessionRecovery(snapshot).actions).toEqual([
      'START_NV03_SIDECAR_INTERACTIVE',
      'VERIFY_NV03_INTERACTIVE',
    ]);
  });

  it('contains the preserve-Chrome restore branch',()=>{
    const restore=readFileSync('scripts/nv03-session-restore/Start-NV03-InteractiveRestore.ps1','utf8');
    expect(restore).toContain('CHROME_INTERACTIVE_SIDECAR_MISSING');
    expect(restore).toContain('$preserveInteractiveChrome');
  });
});
