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

  it('uses only one exact prefixed continuation command for bounded idle wake', () => {
    expect(bridge).not.toContain('NV02_SELF_PULL_WAKE_PROMPT');
    expect(bridge).not.toContain('NV02_ROTATION_INSTRUCTION');
    expect(bridge).toContain('return `02 - ${pickContinuePrompt(prior,random)}`;');
    expect(bridge).toContain('NV02_IDLE_CONTINUE_WAKE_DISPATCHED');
    expect(bridge).toContain('detectWorkerAssistantTerminal');
    expect(bridge).toContain('assistantTerminal=detectAssistantTerminal(assistantTextRaw)');
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

  it('uses the one canonical short-command pool with an NV02-specific prefix adapter', () => {
    const continuity=readFileSync('apps/chrome-controller/extension/continuity.js','utf8');
    expect(bridge).not.toContain('NV02_CONTINUE_PROMPTS');
    expect(bridge).toContain("workerId==='NV02'?pickNv02ContinuePrompt(state?.lastPrompt):pickWorkerContinuePrompt(workerId,state?.lastPrompt)");
    expect(bridge).toContain('return `02 - ${pickContinuePrompt(prior,random)}`;');
    expect(continuity).toContain("'Làm tiếp, không đổi việc'");
  });

  it('locks NV02 F5 to 5-10 minutes and preserves reversible worker scope isolation', () => {
    expect(bridge).toContain('const NV02_F5_MIN_MS=5*60*1000');
    expect(bridge).toContain('const NV02_F5_MAX_MS=10*60*1000');
    expect(supervisor).toContain("foreach($id in @('NV03','NV04'))");
    expect(supervisor).toContain('Ensure-UtilityPaused');
    expect(supervisor).toContain('Ensure-UtilityResumed');
    expect(supervisor).toContain("'THREE_UI_SIDE_WORKERS_RESUMED'");
    expect(supervisor).toContain("'THREE_UI_RESUME_SKIPPED_OWNER_PAUSE'");
    expect(supervisor).toContain('if([bool]$Active.nv02Only)');
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

  it('defers due F5 while WORKING', () => {
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02Loop).toContain("if(phase==='WORKING'&&now>=Number(state.nextPeriodicF5At||0))");
    expect(nv02Loop).toContain('PERIODIC_F5_DEFERRED_WORKING');
    const deferGate=nv02Loop.indexOf("if(phase==='WORKING'&&now>=Number(state.nextPeriodicF5At||0))");
    const f5Gate=nv02Loop.indexOf("if(now>=Number(state.nextPeriodicF5At||0))",deferGate+1);
    expect(deferGate).toBeGreaterThan(-1);
    expect(f5Gate).toBeGreaterThan(deferGate);
    expect(nv02Loop.slice(deferGate,f5Gate)).not.toContain('reloadTarget(target)');
  });

  it('requires a stable renderer grace before an overdue follow-up F5', () => {
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(bridge).toContain('const NV02_POST_F5_STABLE_GRACE_MS=30*1000');
    expect(bridge).toContain('postF5RecoveryPending:Boolean(raw.postF5RecoveryPending)');
    expect(bridge).toContain('postF5StableSince:Number(raw.postF5StableSince)||0');
    expect(nv02Loop).toContain("if(state.postF5RecoveryPending===true)");
    expect(nv02Loop).toContain("'POST_F5_STABLE_GRACE_ARMED'");
    expect(nv02Loop).toContain("'PERIODIC_F5_OVERDUE_WAITING_STABLE_GRACE'");
    expect(nv02Loop).toContain("postF5RecoveryPending:true,postF5StableSince:0");
    const waitStart=nv02Loop.indexOf("if(state.postF5RecoveryPending===true)",nv02Loop.indexOf("if(now>=Number(state.nextPeriodicF5At||0))"));
    const waitEnd=nv02Loop.indexOf('let refreshed;',waitStart);
    expect(waitStart).toBeGreaterThan(-1);
    expect(waitEnd).toBeGreaterThan(waitStart);
    expect(nv02Loop.slice(waitStart,waitEnd)).not.toContain('nextPeriodicF5At:nextRandomAt');
    expect(bridge).toContain("'NV02_POST_F5_STABLE_GRACE_RESET'");
    expect(bridge).toContain("reason:'CONNECTIVITY_FAILURE'");
  });

  it('preserves or recovers the existing NV02 project/chat context on boot', () => {
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02Loop).toContain("const bootContextTransitionPending=bootFreshContextPending.has('NV02')");
    expect(nv02Loop).toContain("'PERIODIC_F5_OVERDUE_DEFERRED_FOR_BOOT_CONTEXT'");
    expect(nv02Loop).toContain("state.crashResumePending===true");
    expect(nv02Loop).toContain("'NV02_CRASH_CHAT_RESTORED'");
    expect(nv02Loop).toContain("'BOOT_CONTEXT_PRESERVED_OR_RECOVERED'");
    expect(nv02Loop).not.toContain("rotateNv02ToFreshChat(target,state,'BOOT_FRESH_CHAT'");
  });

  it('defers planned 2-4h reset while WORKING and preserves a valid chat when idle', () => {
    expect(bridge).toContain("if(now>=Number(state.nextRefreshAt||0))");
    const resetHelper=bridge.slice(
      bridge.indexOf('async function reopenNv02PeriodicWorker'),
      bridge.indexOf('async function maybeNv02Continuity')
    );
    expect(resetHelper).toContain("if(phase==='WORKING')return{ok:false,status:'NV02_PERIODIC_REOPEN_DEFERRED_WORKING'}");
    expect(resetHelper).toContain('prepareWorkerForPlannedRestart');
    expect(resetHelper).toContain("const resumeUrl=isRestorableNv02Chat(prepared.url)?String(prepared.url):NV02_HOME_URL");
    expect(resetHelper).toContain("reason:'PERIODIC_2_4H_RESET'");
    expect(resetHelper).toContain('await closeWorker(w,target)');
    expect(resetHelper).toContain('await navigate(replacement,resumeUrl)');
    expect(resetHelper).toContain("preservedChat:isRestorableNv02Chat(resumeUrl)");
    expect(bridge).toContain("'PERIODIC_RESTART_DEFERRED_WORKING'");
  });

  it('rebases overdue maintenance only across an OS reboot, not an ordinary Chrome restart', () => {
    const supervisor=readFileSync('apps/chrome-controller/runtime/Start-Unified-AppChrome.ps1','utf8');
    expect(bridge).toContain('const f5WindowVersion=4;');
    expect(supervisor).toContain('$env:TIGERIQ_BOOT_ID=$currentBootId');
    expect(bridge).toContain("const BOOT_ID=String(process.env.TIGERIQ_BOOT_ID||'').trim()");
    expect(bridge).toContain("const bootChanged=Boolean(BOOT_ID&&String(raw.bootId||'')!==BOOT_ID)");
    expect(bridge).toContain('if(bootChanged&&nextPeriodicF5At<=now)');
    expect(bridge).toContain('if(bootChanged&&nextRefreshAt<=now)');
    expect(bridge).toContain('NV02_F5_TIMER_REBASED_AFTER_OS_REBOOT');
    expect(bridge).toContain('NV02_REFRESH_TIMER_REBASED_AFTER_OS_REBOOT');
    expect(bridge).toContain("bootId:BOOT_ID||String(raw.bootId||'')");
  });

  it('keeps NV02 maintenance timers monotonic across stale continuity-state writers', () => {
    expect(bridge).toContain("const NV02_MAINTENANCE_TIMER_STATE='D:\\\\TigerIQ\\\\Apps\\\\ChromeController\\\\Runtime\\\\nv02-maintenance-timers.json'");
    expect(bridge).toContain('function loadNv02MaintenanceTimerFloor()');
    expect(bridge).toContain('function saveNv02MaintenanceTimerFloor(nextPeriodicF5At,nextRefreshAt)');
    expect(bridge).toContain('nextPeriodicF5At:Math.max(Number(prior.nextPeriodicF5At)||0,Number(nextPeriodicF5At)||0)');
    expect(bridge).toContain('nextRefreshAt:Math.max(Number(prior.nextRefreshAt)||0,Number(nextRefreshAt)||0)');
    expect(bridge).toContain('let nextPeriodicF5At=Math.max(rawNextPeriodicF5At,Number(durableTimers.nextPeriodicF5At)||0)');
    expect(bridge).toContain('let nextRefreshAt=Math.max(rawNextRefreshAt,Number(durableTimers.nextRefreshAt)||0)');
    expect(bridge).toContain('NV02_MAINTENANCE_TIMER_REGRESSION_BLOCKED');
    const saveStart=bridge.indexOf('function saveNv02Continuity(state)');
    const saveEnd=bridge.indexOf('\n\nfunction auth(',saveStart);
    const saveBlock=bridge.slice(saveStart,saveEnd);
    expect(saveBlock).toContain('saveNv02MaintenanceTimerFloor(state.nextPeriodicF5At,state.nextRefreshAt)');
    expect(saveBlock).toContain('nextPeriodicF5At:Math.max');
    expect(saveBlock).toContain('nextRefreshAt:Math.max');
  });


  it('verifies project recovery before success and backs off a failed recovery instead of looping every tick', () => {
    const recovery=bridge.slice(bridge.indexOf('async function waitForNv02ProjectContextRecovery'),bridge.indexOf('async function focus(target)'));
    expect(recovery).toContain("isNv02ProjectContext(last?.url)||last?.projectDraftReady===true");
    expect(recovery).toContain("status:'PROJECT_NEW_CHAT_CONFIRMED'");
    expect(recovery).toContain("status:'PROJECT_CONTEXT_NAVIGATED_CONFIRMED'");
    expect(recovery).toContain("ok:false,status:confirmed?.status||'PROJECT_CONTEXT_NOT_RECOVERED'");

    const tick=bridge.slice(bridge.indexOf('async function tickWorker(w){'),bridge.indexOf('\n\nasync function tick()'));
    expect(bridge).toContain('projectRecoveryRetryAt:Number(raw.projectRecoveryRetryAt)||0');
    expect(tick).toContain('Date.now()<Number(recoveryState.projectRecoveryRetryAt||0)');
    expect(tick).toContain('const projectRecoveryRetryAt=Date.now()+30000');
    expect(tick).toContain("'PROJECT_CONTEXT_RECOVERY_FAILED'");
    expect(tick).toContain("projectRecoveryRetryAt:0");
  });

  it('does not terminal-escalate a transient load-error immediately after an F5 stable candidate', () => {
    const recoveryStart=bridge.indexOf('async function maybeRecoverChatLoadError');
    const recoveryEnd=bridge.indexOf('const MODEL_SELECTOR_POINT_EXPR',recoveryStart);
    const recovery=bridge.slice(recoveryStart,recoveryEnd);
    expect(recovery).toContain('const candidateAtDuringError=Number(state.chatLoadClearCandidateAt||0)');
    expect(recovery).toContain('if(candidateAgeMs<15_000)');
    expect(recovery).toContain('CHAT_LOAD_STABLE_CANDIDATE_TRANSIENT_ERROR');
    expect(recovery).toContain('CHAT_LOAD_STABLE_CANDIDATE_EXPIRED');
    const graceGate=recovery.indexOf('if(candidateAgeMs<15_000)');
    const terminalGate=recovery.indexOf("if(stage===2)");
    expect(graceGate).toBeGreaterThan(-1);
    expect(terminalGate).toBeGreaterThan(graceGate);
    expect(recovery.slice(graceGate,terminalGate)).toContain('return true;');
  });

  it('archives/rebuilds NV02 only after bounded retry and F5 fail on a genuinely unloadable current chat', () => {
    const recoveryStart=bridge.indexOf('async function maybeRecoverChatLoadError');
    const recoveryEnd=bridge.indexOf('const MODEL_SELECTOR_POINT_EXPR',recoveryStart);
    const recovery=bridge.slice(recoveryStart,recoveryEnd);
    const stage2=recovery.indexOf('if(stage===2)');
    expect(stage2).toBeGreaterThan(-1);
    const activeChatPath=recovery.slice(stage2,recovery.indexOf('const blockedUntil=now+15*60*1000',stage2));
    expect(activeChatPath).toContain("w.id==='NV02'&&hasCurrentNv02Chat(ui?.url)");
    expect(activeChatPath).toContain('CHAT_LOAD_DURABLE_CHECKPOINT');
    expect(activeChatPath).toContain("rotateNv02ToFreshChat(target,checkpoint,'CHAT_LOAD_ERROR'");
    expect(activeChatPath).toContain('CHAT_LOAD_ARCHIVE_RECOVERY_DEFERRED');
  });

  it('keeps exact-command idle wake after maintenance gates', () => {
    expect(bridge).toContain('NV02_IDLE_CONTINUE_WAKE_UNCERTAIN');
    expect(bridge).toContain('nextIdleWakeAt:now+60_000');
    expect(bridge).toContain('NV02_IDLE_CONTINUE_WAKE_DISPATCHED');
    expect(bridge).toContain('return `02 - ${pickContinuePrompt(prior,random)}`;');
    const f5Gate=bridge.indexOf("if(now>=Number(state.nextPeriodicF5At||0))");
    const idleGate=bridge.indexOf("if(state.idleState==='READY_NO_ELIGIBLE_WORK'&&state.awaitingWorkStart!==true)");
    expect(f5Gate).toBeGreaterThan(-1);
    expect(idleGate).toBeGreaterThan(f5Gate);
  });

});



describe('NV02 chat lifecycle master contract', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('does not auto-rotate on terminal, idle, prompt-count, chat-age, or ordinary boot', () => {
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(bridge).not.toContain('NV02_ROTATION_INSTRUCTION');
    expect(bridge).not.toContain('NV02_MAX_DISPATCHES_PER_CHAT');
    expect(bridge).not.toContain('NV02_MAX_CHAT_AGE_MS');
    expect(nv02Loop).not.toContain('SAFETY_CONTEXT_LIMIT');
    expect(nv02Loop).not.toContain('JOB_TERMINAL_DURABLE_CHECKPOINT');
    expect(nv02Loop).not.toContain("rotateNv02ToFreshChat(target,state,'READY_NO_ELIGIBLE_WORK'");
    expect(nv02Loop).not.toContain("rotateNv02ToFreshChat(target,state,'BOOT_FRESH_CHAT'");
    expect(nv02Loop).toContain('BOOT_CONTEXT_PRESERVED_OR_RECOVERED');
  });

  it('keeps archive/new-chat available only for explicit command or genuine chat-load recovery', () => {
    expect(bridge).toContain("if(action==='ARCHIVE_CHAT')");
    const recovery=bridge.slice(bridge.indexOf('async function maybeRecoverChatLoadError'),bridge.indexOf('const MODEL_SELECTOR_POINT_EXPR'));
    expect(recovery).toContain("rotateNv02ToFreshChat(target,checkpoint,'CHAT_LOAD_ERROR'");
    expect(bridge).toContain('await archiveChat(target)');
    expect(bridge).toContain('await newChat(target)');
  });
});


describe('NV02 archive rotation robustness', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('archives from the current conversation header menu only', () => {
    expect(bridge).toContain("source:direct.length?'HEADER_CONVERSATION_OPTIONS':'HEADER_TOOLBAR_MORE'");
    expect(bridge).toContain("ARCHIVE_HEADER_MENU_COUNT_");
    expect(bridge).toContain("conversation-options-button");
    const archiveStart=bridge.indexOf('function archiveMenuPointExpr');
    const archiveEnd=bridge.indexOf('function newChatExpr',archiveStart);
    const archiveBlock=bridge.slice(archiveStart,archiveEnd);
    expect(archiveBlock).not.toContain('archiveProjectRowPointExpr');
    expect(archiveBlock).not.toContain('archiveProjectMenuPointExpr');
    expect(archiveBlock).not.toContain("await p.call('Page.navigate',{url:NV02_HOME_URL})");
  });

  it('accepts localized archive labels but rejects archive-all actions', () => {
    expect(bridge).toContain("lưu trữ đoạn chat");
    expect(bridge).toContain("archive conversation");
    expect(bridge).toContain("if(/all|tất cả/i.test(t))return false");
  });

  it('does not trigger archive from READY/terminal continuity state', () => {
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02Loop).not.toContain("rotateNv02ToFreshChat(target,state,'JOB_TERMINAL_DURABLE_CHECKPOINT'");
    expect(nv02Loop).not.toContain("rotateNv02ToFreshChat(target,state,'READY_NO_ELIGIBLE_WORK'");
    expect(nv02Loop).not.toContain("rotateNv02ToFreshChat(target,state,'SAFETY_CONTEXT_LIMIT'");
  });

});

describe('NV02 current-header archive generated-expression regression', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('parses the generated header-menu expression as executable JavaScript', () => {
    const start=bridge.indexOf('function archiveMenuPointExpr');
    const end=bridge.indexOf('function archiveItemPointExpr',start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fnSource=bridge.slice(start,end);
    const expression=new Function(fnSource+'; return archiveMenuPointExpr()')();
    expect(()=>new Function('return '+expression)).not.toThrow();
  });
});

describe('NV02 current-header archive interaction', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('opens the unique header menu and activates Archive by keyboard semantics', () => {
    expect(bridge).toContain("cdpMouseClick(p,menuPoint,{paced:false})");
    expect(bridge).toContain("const activated=await activateArchiveMenuItem(p)");
    expect(bridge).not.toContain("cdpMouseClick(p,archivePoint,{paced:false})");
  });

  it('backs off a failed genuine chat-load archive recovery from failure completion time', () => {
    const recovery=bridge.slice(bridge.indexOf('async function maybeRecoverChatLoadError'),bridge.indexOf('const MODEL_SELECTOR_POINT_EXPR'));
    expect(recovery).toContain('const retryAt=Date.now()+60_000');
    expect(recovery).toContain('CHAT_LOAD_ARCHIVE_RECOVERY_DEFERRED');
    expect(recovery).not.toContain("rotationRetryAt:now+60_000");
  });
});

describe('NV02 broken-chat durable recovery contract', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('checkpoints before archive and dispatches only an exact prefixed continuation in the fresh Project chat', () => {
    const recovery=bridge.slice(bridge.indexOf('async function maybeRecoverChatLoadError'),bridge.indexOf('const MODEL_SELECTOR_POINT_EXPR'));
    expect(recovery).toContain('CHAT_LOAD_DURABLE_CHECKPOINT');
    expect(recovery).toContain("rotateNv02ToFreshChat(target,checkpoint,'CHAT_LOAD_ERROR'");
    expect(bridge).not.toContain('NV02_SELF_PULL_WAKE_PROMPT');
    expect(bridge).not.toContain('NV02_ROTATION_INSTRUCTION');
    expect(bridge).toContain("const prompt=pickNv02ContinuePrompt(state?.lastPrompt)");
    expect(bridge).toContain('return `02 - ${pickContinuePrompt(prior,random)}`;');
  });
});


describe('NV02 current-header archive confirmation', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('confirms only after leaving the exact current conversation or seeing Unarchive', () => {
    expect(bridge).toContain("sameConversation=Boolean(conversationId)&&location.pathname.endsWith('/c/'+conversationId)");
    expect(bridge).toContain("archiveConfirmExpr(menuPoint.before,menuPoint.conversationId)");
    expect(bridge).toContain("ARCHIVE_NOT_CONFIRMED_LEFT_CURRENT_CONVERSATION");
    expect(bridge).toContain("confirmation=state?.unarchiveVisible===true?'UNARCHIVE_ACTION_VISIBLE':'LEFT_CURRENT_CONVERSATION'");
  });

  it('fails closed on missing or ambiguous header menu and never navigates to Project list first', () => {
    expect(bridge).toContain("ARCHIVE_HEADER_MENU_COUNT_");
    expect(bridge).not.toContain("PROJECT_LIST_IDENTITY_ROW");
    expect(bridge).not.toContain("SIDEBAR_ROW_FALLBACK");
  });
});


describe('NV02 archive activation via menu keyboard semantics', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('focuses the exact archive menuitem and activates it with Enter', () => {
    expect(bridge).toContain('function archiveFocusExpr()');
    expect(bridge).toContain("status:document.activeElement===archive[0]?'ARCHIVE_ACTION_FOCUSED':'ARCHIVE_ACTION_FOCUS_FAILED'");
    expect(bridge).toContain("status:'ARCHIVE_ACTION_ACTIVATED_BY_ENTER'");
    expect(bridge).toContain("type:'keyDown',key:'Enter'");
    expect(bridge).toContain("type:'keyUp',key:'Enter'");
    expect(bridge).toContain('const activated=await activateArchiveMenuItem(p)');
  });
});

