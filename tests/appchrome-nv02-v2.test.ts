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

describe('NV02 V2 reviewed race hardening', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('keeps periodic reset lease valid and does not starve Auto wake on reset backoff', () => {
    const resetGate=bridge.indexOf("if(phase!=='WORKING'&&now>=Number(state.nextRefreshAt||0))");
    const f5Gate=bridge.indexOf("if(phase==='WORKING'&&now>=Number(state.nextPeriodicF5At||0))");
    expect(resetGate).toBeGreaterThan(-1);
    expect(f5Gate).toBeGreaterThan(resetGate);
    const resetBlock=bridge.slice(resetGate,f5Gate);
    expect(resetBlock).toContain("'PERIODIC_PREPARE_RESTART',120000");
    expect(resetBlock).not.toContain("'PERIODIC_PREPARE_RESTART',240000");
    expect(resetBlock).toContain('PERIODIC_RESTART_PREPARE_BACKOFF');
    expect(resetBlock).toContain('PERIODIC_RESTART_LEASE_BUSY_BACKOFF');
    expect(resetBlock).toContain('skipPeriodicReset=true');
    expect(resetBlock).toContain('state=loadNv02Continuity();');
  });

  it('backs off NV02 reopen failures instead of re-entering the overdue reset loop', () => {
    const resetGate=bridge.indexOf("if(phase!=='WORKING'&&now>=Number(state.nextRefreshAt||0))");
    const f5Gate=bridge.indexOf("if(phase==='WORKING'&&now>=Number(state.nextPeriodicF5At||0))");
    const resetBlock=bridge.slice(resetGate,f5Gate);
    expect(resetBlock).toContain("PERIODIC_RESTART_REOPEN_BACKOFF");
    expect(resetBlock).toContain("nextRefreshAt:now+5*60*1000");
    expect(resetBlock).toContain("const stillUsable=await uiState(target).then(()=>true).catch(()=>false)");
    expect(resetBlock).toContain("if(!stillUsable)return");
    expect(resetBlock).toContain("skipPeriodicReset=true");
  });

  it('keeps reviewed idle/F5 fixes in the exact head', () => {
    expect(bridge).toContain('const f5WindowVersion=3;');
    expect(bridge).toContain("lastIdleMarkerSignature:'',idleWakeBaselineSignature:String(ui?.assistantSignature||'')");
    expect(bridge).toContain("NV02_IDLE_SELF_PULL_WAKE_UNCERTAIN");
    expect(bridge).toContain('nextIdleWakeAt:now+60_000');
    const f5Gate=bridge.indexOf("if(now>=Number(state.nextPeriodicF5At||0))");
    const idleGate=bridge.indexOf("if(state.idleState==='READY_NO_ELIGIBLE_WORK'&&state.awaitingWorkStart!==true)");
    expect(f5Gate).toBeGreaterThan(-1);
    expect(idleGate).toBeGreaterThan(f5Gate);
  });
});
