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

describe('NV02 V2 independent maintenance timers', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('keeps F5 5-10m independent from Auto dispatch', () => {
    const dispatchStart=bridge.indexOf('async function noteNv02CommandDispatch()');
    const dispatchEnd=bridge.indexOf('async function reopenNv02PeriodicWorker',dispatchStart);
    const dispatchBlock=bridge.slice(dispatchStart,dispatchEnd);
    expect(dispatchBlock).toContain('const preservedF5At=state.nextPeriodicF5At');
    expect(dispatchBlock).toContain('const preservedRefreshAt=state.nextRefreshAt');
    expect(dispatchBlock).toContain('state.nextPeriodicF5At=preservedF5At');
    expect(dispatchBlock).toContain('state.nextRefreshAt=preservedRefreshAt');
    expect(dispatchBlock).not.toContain('state.nextPeriodicF5At=nextRandomAt');
  });

  it('executes due F5 while WORKING instead of deferring it', () => {
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02Loop).not.toContain("if(phase==='WORKING'&&now>=Number(state.nextPeriodicF5At||0))");
    expect(nv02Loop).not.toContain('PERIODIC_F5_DEFERRED_WORKING');
    expect(nv02Loop).not.toContain('PERIODIC_F5_DEFERRED_WORKING_FRESH');
    const f5Gate=nv02Loop.indexOf("if(now>=Number(state.nextPeriodicF5At||0))");
    const workingGate=nv02Loop.indexOf("if(phase==='WORKING'){",f5Gate);
    expect(f5Gate).toBeGreaterThan(-1);
    expect(workingGate).toBeGreaterThan(f5Gate);
    expect(nv02Loop.slice(f5Gate,workingGate)).toContain('await reloadTarget(target)');
    expect(nv02Loop.slice(f5Gate,workingGate)).toContain("'PERIODIC_F5_REFRESH',15000");
  });

  it('executes due 2-4h reset regardless of WORKING and preserves same chat plus F5 timer', () => {
    expect(bridge).not.toContain("if(phase!=='WORKING'&&now>=Number(state.nextRefreshAt||0))");
    expect(bridge).toContain("if(now>=Number(state.nextRefreshAt||0))");
    expect(bridge).toContain('async function reopenNv02PeriodicWorker');
    const resetHelper=bridge.slice(
      bridge.indexOf('async function reopenNv02PeriodicWorker'),
      bridge.indexOf('async function maybeNv02Continuity')
    );
    expect(resetHelper).toContain("const resumeUrl=isNv02ProjectContext(beforeUrl)?beforeUrl:NV02_HOME_URL");
    expect(resetHelper).toContain("reason:'PERIODIC_2_4H_RESET'");
    expect(resetHelper).toContain('await closeWorker(w,target)');
    expect(resetHelper).toContain('await navigate(replacement,resumeUrl)');
    expect(resetHelper).toContain('nextPeriodicF5At:checkpointed.nextPeriodicF5At');
    expect(resetHelper).toContain('PERIODIC_RESTART_COMPLETED');
  });

  it('does not rebase overdue F5/reset timers after Chrome restart', () => {
    expect(bridge).toContain('const f5WindowVersion=4;');
    expect(bridge).toContain('NV02_F5_TIMER_OVERDUE_AFTER_RESTART');
    expect(bridge).toContain('NV02_REFRESH_TIMER_OVERDUE_AFTER_RESTART');
    expect(bridge).not.toContain('NV02_F5_TIMERS_REBASED_AFTER_RESTART');
    expect(bridge).not.toContain('NV02_REFRESH_TIMER_REBASED_AFTER_RESTART');
  });

  it('keeps NV02 maintenance timers monotonic across stale continuity-state writers', () => {
    expect(bridge).toContain("const NV02_MAINTENANCE_TIMER_STATE='D:\\\\TigerIQ\\\\Apps\\\\ChromeController\\\\Runtime\\\\nv02-maintenance-timers.json'");
    expect(bridge).toContain('function loadNv02MaintenanceTimerFloor()');
    expect(bridge).toContain('function saveNv02MaintenanceTimerFloor(nextPeriodicF5At,nextRefreshAt)');
    expect(bridge).toContain('nextPeriodicF5At:Math.max(Number(prior.nextPeriodicF5At)||0,Number(nextPeriodicF5At)||0)');
    expect(bridge).toContain('nextRefreshAt:Math.max(Number(prior.nextRefreshAt)||0,Number(nextRefreshAt)||0)');
    expect(bridge).toContain('const nextPeriodicF5At=Math.max(rawNextPeriodicF5At,Number(durableTimers.nextPeriodicF5At)||0)');
    expect(bridge).toContain('const nextRefreshAt=Math.max(rawNextRefreshAt,Number(durableTimers.nextRefreshAt)||0)');
    expect(bridge).toContain('NV02_MAINTENANCE_TIMER_REGRESSION_BLOCKED');
    const saveStart=bridge.indexOf('function saveNv02Continuity(state)');
    const saveEnd=bridge.indexOf('\n\nfunction auth(',saveStart);
    const saveBlock=bridge.slice(saveStart,saveEnd);
    expect(saveBlock).toContain('saveNv02MaintenanceTimerFloor(state.nextPeriodicF5At,state.nextRefreshAt)');
    expect(saveBlock).toContain('nextPeriodicF5At:Math.max');
    expect(saveBlock).toContain('nextRefreshAt:Math.max');
  });


  it('keeps reviewed self-pull and idle behavior in the exact head', () => {
    expect(bridge).toContain('NV02_IDLE_SELF_PULL_WAKE_UNCERTAIN');
    expect(bridge).toContain('nextIdleWakeAt:now+60_000');
    expect(bridge).toContain('NV02_IDLE_SELF_PULL_WAKE_DISPATCHED');
    const f5Gate=bridge.indexOf("if(now>=Number(state.nextPeriodicF5At||0))");
    const idleGate=bridge.indexOf("if(state.idleState==='READY_NO_ELIGIBLE_WORK'&&state.awaitingWorkStart!==true)");
    expect(f5Gate).toBeGreaterThan(-1);
    expect(idleGate).toBeGreaterThan(f5Gate);
  });
});
