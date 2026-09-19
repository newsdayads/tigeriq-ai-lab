import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTINUE_PROMPTS, deriveNv02Phase, hasActiveNv02Work, pickContinuePrompt,
  randomDelay, shouldRotateChat,
} from '../apps/chrome-controller/extension/continuity.js';

describe('NV02 continuity policy', () => {
  it('keeps exactly the approved 25 natural continue prompts', () => {
    expect(CONTINUE_PROMPTS).toHaveLength(25);
    expect(new Set(CONTINUE_PROMPTS).size).toBe(25);
    expect(CONTINUE_PROMPTS).toContain('02');
    expect(CONTINUE_PROMPTS).toContain('Làm tiếp');
  });

  it('classifies DOM-backed UI state fail closed', () => {
    expect(deriveNv02Phase({securityBlock:'BLOCKED_CAPTCHA'})).toBe('BLOCKED');
    expect(deriveNv02Phase({stopVisible:true,composerReady:true})).toBe('WORKING');
    expect(deriveNv02Phase({uiBusy:true,composerReady:true})).toBe('WORKING');
    expect(deriveNv02Phase({composerReady:true,uiBusy:false})).toBe('READY');
    expect(deriveNv02Phase({composerReady:true,uiBusy:false,modelReady:false})).toBe('STALLED');
    expect(deriveNv02Phase({composerReady:true,uiBusy:false,uiPhase:'STALLED'})).toBe('STALLED');
    expect(deriveNv02Phase({composerReady:false,uiBusy:false})).toBe('STALLED');
    expect(deriveNv02Phase({composerReady:true},{heartbeatStale:true})).toBe('STALLED');
  });

  it('detects controller work that forbids overlapping continue dispatch', () => {
    expect(hasActiveNv02Work({jobs:[{workerId:'NV02',stage:'WORKING'}],autopilot:{}})).toBe(true);
    expect(hasActiveNv02Work({jobs:[],autopilot:{pendingJobId:'GH-1'}})).toBe(true);
    expect(hasActiveNv02Work({jobs:[],autopilot:{phase:'IDLE'}})).toBe(false);
    expect(hasActiveNv02Work({jobs:[],autopilot:{phase:'BUSY',lastDispatchedJobId:'GH-1',lastCompletedJobId:'GH-1'}})).toBe(false);
    expect(hasActiveNv02Work({jobs:[],autopilot:{phase:'BUSY',lastDispatchedJobId:'GH-2',lastCompletedJobId:'GH-1'}})).toBe(true);
    expect(hasActiveNv02Work({jobs:[{workerId:'NV02',stage:'BLOCKED',completedAt:'2026-09-18T23:07:35.468Z'}],autopilot:{phase:'IDLE'}})).toBe(false);
  });

  it('keeps random timing inside requested windows', () => {
    expect(randomDelay(300000,600000,()=>0)).toBe(300000);
    expect(randomDelay(300000,600000,()=>0.999999)).toBeGreaterThanOrEqual(599999);
  });

  it('avoids immediate prompt repetition when alternatives exist', () => {
    expect(pickContinuePrompt('02',()=>0)).not.toBe('02');
  });

  it('wires continuity into the live direct CDP bridge used by NV02', () => {
    execFileSync(process.execPath,['--check','apps/chrome-controller/direct-cdp-bridge.mjs'],{stdio:'pipe'});
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(source).toContain("if(w.id==='NV02')await maybeNv02Continuity");
    expect(source).toContain("w.enabled!==false&&w.id==='NV02'");
    expect(source).toContain("CONTINUE_DISPATCHED");
    expect(source).toContain("REFRESH_SCHEDULED");
    expect(source).toContain("CHAT_ROTATED");
    expect(source).toContain("ARCHIVE_CURRENT_ROW_COUNT_");
    expect(source).toContain("data-selected-reasoning-effort");
    expect(source).toContain("MUTATION_LEASE_BUSY");
    expect(source).toContain("dispatchNaturalContinueLocked");
    expect(source).toContain("return dispatchNaturalContinueLocked(target,next,now)");
    expect(source).not.toContain("return dispatchNaturalContinue(target,next,now)");
    expect(source).toContain("ROTATE_MODEL_PROFILE_NOT_READY");
    expect(source).toContain("freshUi?.modelReady!==true");
    expect(source).toContain("const SEND_BUTTON_WAIT_MS=10000");
    expect(source).toContain("until=Date.now()+SEND_BUTTON_WAIT_MS");
    expect(source).toContain("activityBusyVisible:Boolean(activityBusy)");
    expect(source).toContain("đang suy nghĩ|thinking|generating|đang tạo");
    expect(source).toContain("/(^|\\\\s)(đang suy nghĩ|thinking|generating|đang tạo)(\\\\s|$)/i");
    expect(source).toContain(".replace(/\\\\s+/g,' ')");
    expect(source).toContain("phase==='READY'&&!active&&now>=state.nextContinueAt&&shouldRotateChat(state,now)");
    expect(source).toContain("WORKING_NO_PROGRESS_CHECK");
    expect(source).toContain("WORKING_STALE_RELOAD");
    expect(source).toContain("WORKING_NO_PROGRESS_3_CHECKS");
    expect(source).toContain("activitySignature");
    expect(source).toContain("workingUnchangedChecks");
  });

  it('rotates chat by bounded count or age instead of every job', () => {
    const now=1_000_000_000;
    expect(shouldRotateChat({chatStartedAt:now,dispatchesInChat:7},now)).toBe(false);
    expect(shouldRotateChat({chatStartedAt:now,dispatchesInChat:8},now)).toBe(true);
    expect(shouldRotateChat({chatStartedAt:now-46*60*1000,dispatchesInChat:1},now)).toBe(true);
  });
  it('ships one-shot NV02 continuity installer with exact-head deploy and rollback',()=>{
    const installer=readFileSync('apps/chrome-controller/runtime/Install-NV02-Continuity.ps1','utf8');
    expect(installer).toContain('[Parameter(Mandatory=$true)][string]$ExpectedHead');
    expect(installer).toContain("fetch','origin','p0/nv02-continuous-liveness");
    expect(installer).toContain("tests/chrome-controller-autonomy-hardening.test.ts");
    expect(installer).toContain("Invoke-Native -File 'npm' -ArgumentList @('run','typecheck')");
    expect(installer).toContain("Invoke-Native -File 'npm' -ArgumentList @('run','build')");
    expect(installer).toContain("Deploy-1122-");
    expect(installer).toContain("apps\\chrome-controller\\direct-cdp-bridge.mjs");
    expect(installer).toContain("NV02_PACKAGE_FAILED_ROLLBACK_APPLIED");
    expect(installer).toContain("CONTROLLER_NOT_RUNNING_DEPLOY_HEAD");
    expect(installer).toContain("BRIDGE_NOT_RUNNING_DEPLOY_HEAD");
    expect(installer).toContain("NV02_MODEL_NOT_READY");
    expect(installer).toContain("NV02_REASONING_NOT_HIGH");
    expect(installer).toContain("Invoke-Native -File 'git' -ArgumentList");
    expect(installer).toContain("Invoke-Native -File 'npm' -ArgumentList");
    expect(installer).not.toContain("Invoke-Native 'git' @(");
  });

});
