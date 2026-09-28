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
    expect(bridge).toContain('P0 tuyệt đối không đọc hoặc claim');
    expect(bridge).toContain('NV02_IDLE_SELF_PULL_WAKE_DISPATCHED');
    expect(bridge).toContain("assistantTerminal=assistantText.includes('READY_NO_ELIGIBLE_WORK')");
    expect(bridge).toContain('lastIdleMarkerSignature');
    expect(bridge).toContain('NV02_IDLE_WAKE_MIN_MS=5*60*1000');
    expect(bridge).toContain('NV02_IDLE_WAKE_MAX_MS=10*60*1000');
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
