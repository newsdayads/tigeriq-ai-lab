import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('App Chrome NV02 V2 boundary', () => {
  const server = readFileSync('apps/chrome-controller/src/server.ts', 'utf8');
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs', 'utf8');
  const supervisor = readFileSync('apps/chrome-controller/runtime/Start-Unified-AppChrome.ps1', 'utf8');

  it('keeps backlog selection and GitHub credentials out of App Chrome runtime', () => {
    expect(server).toContain('const selfRunEnabled=false;');
    expect(supervisor).toContain("$env:TIGERIQ_APP_CHROME_SELF_RUN='0'");
    expect(supervisor).toContain('Remove-Item Env:TIGERIQ_GITHUB_TOKEN');
    expect(supervisor).toContain('Remove-Item Env:GITHUB_TOKEN');
    expect(server).toContain("const selfRunGithubToken='';");
    expect(server).toContain('const githubTerminalReconcileEnabled=false;');
    expect(server).toContain('if(selfRunEnabled)scheduleSelfRunTick(5000);');
    expect(server).toContain('if(githubTerminalReconcileEnabled)setInterval(()=>void reconcileGithubTerminalUiJobs(),30_000).unref();');
    expect(supervisor).not.toContain('github-command-center.token');
    expect(supervisor).not.toContain('gh.exe');
  });

  it('uses one bounded idle wake while NV02 chooses and claims its own work', () => {
    expect(bridge).toContain('NV02_SELF_PULL_WAKE_PROMPT');
    expect(bridge).toContain('App Chrome không chọn việc');
    expect(bridge).toContain('toàn bộ Work Order P1-P5');
    expect(bridge).toContain('CAPABILITY không phải tiêu chí loại việc khỏi tầm nhìn');
    expect(bridge).toContain('điều phối/handoff đúng resource');
    expect(bridge).toContain('không chiếm mutation/review ownership của specialist');
    expect(bridge).toContain('Review độc lập không được tự duyệt phần NV02 đã thực thi');
    expect(bridge).toContain('App Chrome self-maintenance');
    expect(bridge).toContain('owner/lease/resource-scope conflict');
    expect(bridge).toContain('không còn P1-P5 nào NV02 có thể trực tiếp xử lý hoặc điều phối/handoff hợp lệ');
    expect(bridge).toContain('Loại P0/hard-gate');
    expect(bridge).toContain('NV02_IDLE_SELF_PULL_WAKE_DISPATCHED');
    expect(bridge).toContain("assistantTerminal=assistantText.includes('READY_NO_ELIGIBLE_WORK')");
    expect(bridge).toContain('lastIdleMarkerSignature');
    expect(bridge).toContain('NV02_IDLE_WAKE_MIN_MS=5*60*1000');
    expect(bridge).toContain('NV02_IDLE_WAKE_MAX_MS=10*60*1000');
  });

  it('treats capability as execution routing rather than self-pull visibility filtering', () => {
    const doc = readFileSync('docs/app-chrome/APP_CHROME_NV02_V2.md', 'utf8');
    expect(doc).toContain('`CAPABILITY` is routing metadata, not a pre-filter that hides work from NV02');
    expect(doc).toContain('`coding`, `pc_operator`/device work, and `review` remain visible to NV02');
    expect(doc).toContain('NV02 must not self-review work it implemented');
    expect(doc).toContain('no P1-P5 Work Order can be directly executed or validly coordinated/handoff by NV02');
  });

  it('keeps the approved short continue pool scoped to NV02 only', () => {
    expect(bridge).toContain('const NV02_CONTINUE_PROMPTS=Object.freeze([');
    expect(bridge).toContain("workerId==='NV02'?pickNv02ContinuePrompt(state?.lastPrompt):pickWorkerContinuePrompt(workerId,state?.lastPrompt)");
    expect(bridge).toContain("'Làm tiếp, không đổi việc'");
  });

  it('locks NV02 F5 to 5-10 minutes and preserves worker isolation', () => {
    expect(bridge).toContain('const NV02_F5_MIN_MS=5*60*1000');
    expect(bridge).toContain('const NV02_F5_MAX_MS=10*60*1000');
    expect(supervisor).toContain("foreach($id in @('NV03','NV04'))");
    expect(supervisor).toContain('Ensure-UtilityPaused');
  });
});

describe('NV02 independent F5/reset contract', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('preserves F5 and reset timers across Auto/dispatch', () => {
    const start=bridge.indexOf('async function noteNv02CommandDispatch()');
    const end=bridge.indexOf('async function maybeNv02Continuity',start);
    const block=bridge.slice(start,end);
    expect(block).toContain('const preservedPeriodicF5At=state.nextPeriodicF5At');
    expect(block).toContain('const preservedRefreshAt=state.nextRefreshAt');
    expect(block).toContain("DISPATCH_TIMERS_PRESERVED");
    expect(block).not.toContain('state.nextPeriodicF5At=nextRandomAt');
    expect(block).not.toContain('state.nextRefreshAt=');
  });

  it('runs periodic F5 while WORKING and does not alter reset timer', () => {
    const resetGate=bridge.indexOf('if(now>=Number(state.nextRefreshAt||0))');
    const f5Gate=bridge.indexOf('if(now>=Number(state.nextPeriodicF5At||0))',resetGate);
    const workingGate=bridge.indexOf("if(phase==='WORKING')",f5Gate);
    expect(resetGate).toBeGreaterThan(-1);
    expect(f5Gate).toBeGreaterThan(resetGate);
    const f5Block=bridge.slice(f5Gate,workingGate);
    expect(f5Block).toContain('const result=await reloadTarget(target)');
    expect(f5Block).toContain("PERIODIC_F5_REFRESH");
    expect(f5Block).not.toContain('PERIODIC_F5_DEFERRED_WORKING');
    expect(f5Block).not.toContain("freshPhase==='WORKING'");
    expect(f5Block).not.toContain('nextRefreshAt');
  });

  it('runs 2-4h reset while WORKING and preserves the F5 timestamp through reopen', () => {
    const resetGate=bridge.indexOf('if(now>=Number(state.nextRefreshAt||0))');
    const f5Gate=bridge.indexOf('if(now>=Number(state.nextPeriodicF5At||0))',resetGate);
    const resetBlock=bridge.slice(resetGate,f5Gate);
    expect(resetGate).toBeGreaterThan(-1);
    expect(resetBlock).toContain("'PERIODIC_PREPARE_RESTART',120000");
    expect(resetBlock).toContain("PERIODIC_2_4H_RESET");
    expect(resetBlock).toContain('nextRefreshAt:nextRandomAt(now,REFRESH_MIN_MS,REFRESH_MAX_MS)');
    expect(resetBlock).not.toContain("phase!=='WORKING'");
    expect(resetBlock).not.toContain('nextPeriodicF5At');
    expect(bridge).toContain("nextPeriodicF5At:w.id==='NV02'?Number(state.nextPeriodicF5At||0):nextRandomAt(now,WORKER_F5_MIN_MS,WORKER_F5_MAX_MS)");
  });

  it('checkpoints WORKING NV02 and requires durable #788 receipt before Archive', () => {
    const start=bridge.indexOf('async function prepareWorkerForPlannedRestart');
    const end=bridge.indexOf('function archiveMenuPointExpr',start);
    const block=bridge.slice(start,end);
    expect(block).toContain("if(w.id!=='NV02')return{ok:false,status:'MAINTENANCE_DEFERRED_WORKING'}");
    expect(block).toContain('const stopped=await stopStalledWorking(target)');
    expect(block).toContain('TIGERIQ_SAVE_TOKEN=');
    expect(block).toContain('verifyNv02SaveReceipt(token,dispatchedAt)');
    expect(block).toContain("if(!saveReceipt?.ok)return{ok:false,status:'SAVE_NOT_DURABLE',token}");
    expect(block.indexOf('verifyNv02SaveReceipt(token,dispatchedAt)')).toBeLessThan(block.indexOf('const archived=await archiveChat(target)'));
  });

  it('keeps previous reset backoff + idle self-pull hardening', () => {
    const resetGate=bridge.indexOf('if(now>=Number(state.nextRefreshAt||0))');
    const f5Gate=bridge.indexOf('if(now>=Number(state.nextPeriodicF5At||0))',resetGate);
    const resetBlock=bridge.slice(resetGate,f5Gate);
    expect(resetBlock).toContain('PERIODIC_RESTART_PREPARE_BACKOFF');
    expect(resetBlock).toContain('PERIODIC_RESTART_LEASE_BUSY_BACKOFF');
    expect(resetBlock).toContain('PERIODIC_RESTART_REOPEN_BACKOFF');
    expect(resetBlock).toContain('nextRefreshAt:now+5*60*1000');
    expect(resetBlock).toContain('skipPeriodicReset=true');
    expect(bridge).toContain('const f5WindowVersion=3;');
    expect(bridge).toContain("NV02_IDLE_SELF_PULL_WAKE_UNCERTAIN");
  });
});
