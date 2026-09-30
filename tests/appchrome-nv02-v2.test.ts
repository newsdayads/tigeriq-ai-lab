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

  it('prioritizes boot fresh-context transition over overdue F5', () => {
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02Loop).toContain("const bootContextTransitionPending=bootFreshContextPending.has('NV02')");
    expect(nv02Loop).toContain("'PERIODIC_F5_OVERDUE_DEFERRED_FOR_BOOT_CONTEXT'");
    expect(nv02Loop).toContain("if(bootContextTransitionPending)");
    expect(nv02Loop).toContain("rotateNv02ToFreshChat(target,state,'BOOT_FRESH_CHAT'");
    expect(nv02Loop).toContain("state.crashResumePending===true");
    expect(nv02Loop).toContain("'NV02_CRASH_CHAT_RESTORED'");
  });

  it('defers planned 2-4h reset while WORKING and reopens into fresh project context', () => {
    expect(bridge).toContain("if(now>=Number(state.nextRefreshAt||0))");
    const resetHelper=bridge.slice(
      bridge.indexOf('async function reopenNv02PeriodicWorker'),
      bridge.indexOf('async function maybeNv02Continuity')
    );
    expect(resetHelper).toContain("if(phase==='WORKING')return{ok:false,status:'NV02_PERIODIC_REOPEN_DEFERRED_WORKING'}");
    expect(resetHelper).toContain('prepareWorkerForPlannedRestart');
    expect(resetHelper).toContain('const resumeUrl=NV02_HOME_URL');
    expect(resetHelper).toContain("reason:'PERIODIC_2_4H_RESET'");
    expect(resetHelper).toContain('await closeWorker(w,target)');
    expect(resetHelper).toContain('await navigate(replacement,resumeUrl)');
    expect(resetHelper).toContain('dispatchesInChat:0');
    expect(resetHelper).toContain("bootFreshContextPending.add('NV02')");
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

  it('does not arm the 15m terminal backoff for a valid active NV02 chat after post-reboot F5', () => {
    const recoveryStart=bridge.indexOf('async function maybeRecoverChatLoadError');
    const recoveryEnd=bridge.indexOf('const MODEL_SELECTOR_POINT_EXPR',recoveryStart);
    const recovery=bridge.slice(recoveryStart,recoveryEnd);
    const stage2=recovery.indexOf('if(stage===2)');
    const genericBlock=recovery.indexOf('const blockedUntil=now+15*60*1000',stage2);
    expect(stage2).toBeGreaterThan(-1);
    expect(genericBlock).toBeGreaterThan(stage2);
    const activeChatPath=recovery.slice(stage2,genericBlock);
    expect(activeChatPath).toContain("w.id==='NV02'&&hasCurrentNv02Chat(ui?.url)");
    expect(activeChatPath).toContain('const retryAt=now+30_000');
    expect(activeChatPath).toContain('chatLoadRecoveryStage:0');
    expect(activeChatPath).toContain('chatLoadBlockedUntil:retryAt');
    expect(activeChatPath).toContain('CHAT_LOAD_ACTIVE_CHAT_BOUNDED_BACKOFF');
    expect(activeChatPath).toContain('return false;');
    const nv02ActiveStart=activeChatPath.indexOf("w.id==='NV02'&&hasCurrentNv02Chat(ui?.url)");
    const terminalStart=activeChatPath.indexOf('chatLoadRecoveryStage:3');
    expect(terminalStart).toBeGreaterThan(nv02ActiveStart);
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


describe('NV02 fresh-chat lifecycle V3', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('uses GitHub checkpoint as continuity and rotates chat after terminal work', () => {
    expect(bridge).toContain("const NV02_CHAT_ROTATE_MARKER='TIGERIQ_CHAT_ROTATE_READY'");
    expect(bridge).toContain('NV02_ROTATION_INSTRUCTION');
    expect(bridge).toContain("ui?.assistantTerminal===NV02_CHAT_ROTATE_MARKER");
    expect(bridge).toContain("rotateNv02ToFreshChat(target,state,'JOB_TERMINAL_DURABLE_CHECKPOINT'");
    expect(bridge).toContain("await archiveChat(target)");
    expect(bridge).toContain("await newChat(target)");
    expect(bridge).toContain('dispatchesInChat:0,chatStartedAt:now');
  });

  it('does not restore a verified chat on ordinary boot and keeps crash-only restore explicit', () => {
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02Loop).toContain("rotateNv02ToFreshChat(target,state,'BOOT_FRESH_CHAT'");
    expect(nv02Loop).not.toContain('restoreVerifiedChatUrl');
    expect(bridge).toContain('crashResumePending:Boolean(raw.crashResumePending)');
    expect(bridge).toContain("log('NV02_CRASH_CHAT_RESUME_ARMED'");
    expect(nv02Loop).toContain("state.crashResumePending===true&&isRestorableNv02Chat(state.crashResumeUrl)");
    expect(bridge).toContain("function isRestorableNv02Chat(url)");
    expect(bridge).toContain("!/^local-chatgpt:/i.test(conversationId)");
    expect(bridge).toContain("'NV02_CRASH_CHAT_RESUME_SKIPPED_NON_DURABLE'");
    expect(bridge).toContain("const crashUrl=isRestorableNv02Chat(continuity.verifiedChatUrl)");
  });

  it('rotates idle and oversized chats instead of growing context forever', () => {
    expect(bridge).toContain('NV02_MAX_DISPATCHES_PER_CHAT=60');
    expect(bridge).toContain('NV02_MAX_CHAT_AGE_MS=6*60*60*1000');
    expect(bridge).toContain("rotateNv02ToFreshChat(target,state,'READY_NO_ELIGIBLE_WORK'");
    expect(bridge).toContain("rotateNv02ToFreshChat(target,state,'SAFETY_CONTEXT_LIMIT'");
    expect(bridge).toContain('Number(state.dispatchesInChat||0)>=NV02_MAX_DISPATCHES_PER_CHAT');
    expect(bridge).toContain('chatAgeMs>=NV02_MAX_CHAT_AGE_MS');
  });
});


describe('NV02 archive rotation robustness', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('captures exact conversation identity and archives only from the Project chat list', () => {
    expect(bridge).toContain("status:'ARCHIVE_IDENTITY_CAPTURED'");
    expect(bridge).toContain("source:'PROJECT_LIST_IDENTITY_ROW'");
    expect(bridge).toContain("ARCHIVE_PROJECT_ROW_IDENTITY_COUNT_");
    expect(bridge).toContain("await p.call('Page.navigate',{url:NV02_HOME_URL})");
    expect(bridge).toContain("confirmation:'PROJECT_LIST_ROW_REMOVED'");
  });

  it('does not use current-chat header selectors or title fallback for archive identity', () => {
    const start=bridge.indexOf('function archiveCurrentIdentityExpr');
    const end=bridge.indexOf('function archiveItemPointExpr',start);
    const archiveSelectors=bridge.slice(start,end);
    expect(archiveSelectors).not.toContain('HEADER_TOOLBAR_MORE');
    expect(archiveSelectors).not.toContain('HEADER_CONVERSATION_OPTIONS');
    expect(archiveSelectors).not.toContain('conversation-options-button');
    expect(archiveSelectors).not.toContain("String(row.innerText||'').trim()===title");
    expect(archiveSelectors).toContain("pathname.endsWith('/c/'+conversationId)");
  });

  it('accepts localized archive labels but rejects archive-all actions', () => {
    expect(bridge).toContain("lưu trữ đoạn chat");
    expect(bridge).toContain("archive conversation");
    expect(bridge).toContain("if(/all|tất cả/i.test(t))return false");
  });

  it('honors rotationRetryAt after archive failure instead of retrying every 3s tick', () => {
    expect(bridge).toContain("ui?.assistantTerminal===NV02_CHAT_ROTATE_MARKER&&now>=Number(state.rotationRetryAt||0)");
    expect(bridge).toContain("ui?.assistantTerminal==='READY_NO_ELIGIBLE_WORK'&&now>=Number(state.rotationRetryAt||0)");
    expect(bridge).toContain("rotationRetryAt:Date.now()+60_000");
  });
});


// #2535 exact-head regression: Project-list identity archive only.
describe('NV02 Project-list archive generated-expression regression', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  function generatedExpr(functionName:string,nextFunctionName:string){
    const start=bridge.indexOf('function '+functionName);
    const end=bridge.indexOf('function '+nextFunctionName,start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fnSource=bridge.slice(start,end);
    return new Function(fnSource+'; return '+functionName+"('conv-test')")();
  }

  it('parses the generated Project row and menu expressions as executable JavaScript', () => {
    const rowExpr=generatedExpr('archiveProjectRowPointExpr','archiveProjectMenuPointExpr');
    const menuExpr=generatedExpr('archiveProjectMenuPointExpr','archiveItemPointExpr');
    expect(()=>new Function('return '+rowExpr)).not.toThrow();
    expect(()=>new Function('return '+menuExpr)).not.toThrow();
  });
});


describe('NV02 archive Project-list interaction', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('hovers the exact identity row before opening its menu, then activates Archive by keyboard semantics', () => {
    expect(bridge).toContain("type:'mouseMoved',x:Number(rowPoint.x),y:Number(rowPoint.y)");
    expect(bridge).toContain("cdpMouseClick(p,menuPoint,{paced:false})");
    expect(bridge).toContain("const activated=await activateArchiveMenuItem(p)");
    expect(bridge).not.toContain("cdpMouseClick(p,archivePoint,{paced:false})");
  });

  it('arms archive retry from failure completion time, not stale tick start time', () => {
    expect(bridge).not.toContain("rotationRetryAt:now+60_000");
    expect(bridge).toContain("rotationRetryAt:Date.now()+60_000");
    expect(bridge).toContain("modelCheckBlockedUntil:Date.now()+30_000");
  });
});


describe('NV02 rotation durable-checkpoint contract', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('requires the worker terminal marker after durable GitHub checkpoint and does not invent a second Save prompt', () => {
    expect(bridge).toContain('durable checkpoint/evidence đã ghi GitHub');
    expect(bridge).not.toContain("dispatch(target,'Lưu')");
    expect(bridge).toContain('if(hasCurrentNv02Chat(ui?.url))');
    expect(bridge).toContain('const archived=await archiveChat(target)');
  });
});


describe('NV02 archive Project-list confirmation', () => {
  const bridge = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('confirms only after the exact conversation ID row disappears from Project list', () => {
    expect(bridge).toContain("rowRemoved:exact.length===0");
    const confirmStart=bridge.indexOf('function archiveConfirmExpr');
    const confirmEnd=bridge.indexOf('async function archiveChat',confirmStart);
    const confirmBlock=bridge.slice(confirmStart,confirmEnd);
    expect(confirmBlock).toContain("projectContext:!");
    expect(confirmBlock).toContain(".test(location.pathname)");
    expect(confirmBlock).toContain("pathname.endsWith('/c/'+conversationId)");
    expect(bridge).toContain("archiveConfirmExpr(identity.conversationId)");
    expect(bridge).toContain("ARCHIVE_NOT_CONFIRMED_PROJECT_LIST_ROW_REMOVED");
  });

  it('fails closed on ambiguous or missing identity rows and never falls back to title', () => {
    expect(bridge).toContain("ARCHIVE_PROJECT_ROW_IDENTITY_COUNT_");
    expect(bridge).toContain("ARCHIVE_PROJECT_ROW_MENU_COUNT_");
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

