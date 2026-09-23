import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDurableSavePrompt, SAVE_RECEIPT_POLL_DELAYS_MS, waitForDurableSaveReceipt } from '../apps/chrome-controller/extension/save-receipt.js';
import {
  CONTINUE_PROMPTS, CHAT_ROTATE_AFTER_DISPATCHES, MAX_WORKING_UNCHANGED_CHECKS, WORKING_PROGRESS_CHECK_MS,
  CONTINUE_MIN_MS, CONTINUE_MAX_MS, REFRESH_MIN_MS, REFRESH_MAX_MS, WORKER_F5_MIN_MS, WORKER_F5_MAX_MS,
  CONTINUITY_WORKERS, deriveNv02Phase, deriveWorkerPhase, hasActiveNv02Work, hasActiveWorkerWork,
  hasWaitingEvidenceNv02Work, hasWaitingEvidenceWorkerWork, hasContinuableNv02Work, hasContinuableWorkerWork,
  pickContinuePrompt, randomDelay, shouldRotateNv02Chat, computeWorkerStaggerDelay,
} from '../apps/chrome-controller/extension/continuity.js';

describe('NV02 continuity policy', () => {
  it('exposes isolated worker-generic continuity primitives for NV02/NV03/NV04', () => {
    expect(CONTINUITY_WORKERS).toEqual(['NV02','NV03','NV04']);
    expect(CONTINUE_PROMPTS).toHaveLength(21);
    expect(WORKER_F5_MIN_MS).toBe(5*60*1000);
    expect(WORKER_F5_MAX_MS).toBe(20*60*1000);
    expect(WORKER_F5_MIN_MS).toBe(CONTINUE_MIN_MS);
    expect(WORKER_F5_MAX_MS).toBeGreaterThan(CONTINUE_MAX_MS);
    expect(REFRESH_MIN_MS).toBe(2*60*60*1000);
    expect(REFRESH_MAX_MS).toBe(4*60*60*1000);
    expect(pickContinuePrompt('Tiếp tục',()=>0)).not.toBe('Tiếp tục');

    for(const workerId of CONTINUITY_WORKERS){
      expect(deriveWorkerPhase({stopVisible:true,composerReady:true},{workerId})).toBe('WORKING');
      expect(deriveWorkerPhase({composerReady:true,uiBusy:false},{workerId})).toBe('READY');
      expect(deriveWorkerPhase({composerReady:false,uiBusy:false},{workerId})).toBe('STALLED');
      expect(deriveWorkerPhase({securityBlock:'CAPTCHA'},{workerId})).toBe('BLOCKED');

      const own={jobs:[{workerId,stage:'WORKING',completedAt:null}]};
      expect(hasActiveWorkerWork(own,workerId)).toBe(true);
      expect(hasContinuableWorkerWork(own,workerId)).toBe(true);
      expect(hasWaitingEvidenceWorkerWork({jobs:[{workerId,stage:'WAITING_EVIDENCE',completedAt:null}]},workerId)).toBe(true);
      for(const other of CONTINUITY_WORKERS.filter((id)=>id!==workerId)){
        expect(hasActiveWorkerWork(own,other)).toBe(false);
        expect(hasContinuableWorkerWork(own,other)).toBe(false);
      }
    }

    expect(deriveWorkerPhase({composerReady:true,authRequired:false,uiBusy:false,modelReady:false,uiPhase:'STALLED'},{workerId:'NV03'})).toBe('READY');
    expect(deriveWorkerPhase({composerReady:true,authRequired:false,uiBusy:false,modelReady:false,uiPhase:'STALLED'},{workerId:'NV04'})).toBe('READY');
    expect(deriveWorkerPhase({composerReady:true,authRequired:false,uiBusy:false,modelReady:false,uiPhase:'STALLED'},{workerId:'NV02'})).toBe('STALLED');

    expect(hasActiveWorkerWork({autopilot:{pendingJobId:'NV02-ONLY'}},'NV02')).toBe(true);
    expect(hasActiveWorkerWork({autopilot:{pendingJobId:'NV02-ONLY'}},'NV03')).toBe(false);
    expect(hasActiveWorkerWork({autopilotByWorker:{NV03:{pendingJobId:'NV03-ONLY'}}},'NV03')).toBe(true);
    expect(hasActiveNv02Work({jobs:[{workerId:'NV03',stage:'WORKING',completedAt:null}]})).toBe(false);

    const stagger=CONTINUITY_WORKERS.map((_,index)=>computeWorkerStaggerDelay(index,0,60_000));
    expect(new Set(stagger).size).toBe(3);
    expect(stagger).toEqual([0,60_000,120_000]);
  });

  it('enforces fail-closed behavior on stale fallback or duplicate canonical ownership', () => {
    const script = readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs', 'utf8');
    expect(script).toContain('acquireNv02CanonicalOwnership');
    expect(script).toContain('NV02_DUPLICATE_CANONICAL_OWNERSHIP');
    expect(script).toContain('NV02_OWNER_LOCK');
    expect(script).toContain('provenanceVerified');
    expect(script).toContain('sourceSha256');
    expect(script).toContain('FAIL_CLOSED');
    const installer = readFileSync('apps/chrome-controller/runtime/Install-NV02-Continuity.ps1', 'utf8');
    expect(installer).toContain('NV02_FAIL_CLOSED_STALE_OR_MISSING_OWNERSHIP');
    expect(installer).toContain('DEPLOY_SOURCE_HASH_MISMATCH');
    expect(installer).toContain('BRIDGE_PROVENANCE_NOT_VERIFIED');
  });

  it('waits long enough for durable receipt propagation without real sleeping', async () => {
    expect(SAVE_RECEIPT_POLL_DELAYS_MS.reduce((sum,ms)=>sum+ms,0)).toBe(60000);
    const slept=[];let reads=0;
    const receipt=await waitForDurableSaveReceipt('token','NV02','2026-09-19T00:00:00Z',{
      sleep:async(ms)=>{slept.push(ms);},
      read:async()=>++reads<5
        ? {ok:false,status:'SAVE_NOT_DURABLE'}
        : {ok:true,status:'DURABLE',receiptRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/788#issuecomment-1',checkpointRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1122#issuecomment-1',verifiedAt:'2026-09-19T00:01:00Z'},
    });
    expect(receipt.status).toBe('DURABLE');
    expect(slept).toEqual([5000,10000,15000,30000]);
  });

  it('scopes durable save to current GitHub work without Core/backlog discovery', () => {
    const prompt=buildDurableSavePrompt({saveToken:'token-1',workerId:'NV02',dispatchedAt:'2026-09-20T00:00:00Z'});
    expect(prompt).toContain('CÔNG VIỆC HIỆN TẠI');
    expect(prompt).toContain('KHÔNG tìm việc mới');
    expect(prompt).toContain('KHÔNG chọn P0');
    expect(prompt).toContain('KHÔNG đọc backlog');
    expect(prompt).toContain('KHÔNG kiểm tra hoặc phụ thuộc Core, PC01 runtime hay port 8795');
    expect(prompt).toContain('GitHub write + readback thành công');
    expect(prompt).toContain('TIGERIQ_SAVE_TOKEN=token-1');
  });

  it('uses exactly the approved 21 continue commands without immediate repetition', () => {
    expect(CONTINUE_PROMPTS).toEqual(["Tiếp tục","Làm tiếp","Tiếp đi","Xử lý tiếp","Thực hiện tiếp","Tiếp tục công việc hiện tại","Làm tiếp công việc hiện tại","Tiếp tục việc đang làm","Làm tiếp phần đang dở","Tiếp tục từ chỗ hiện tại","Tiếp tục đúng việc này","Xử lý tiếp việc hiện tại","Thực hiện tiếp việc đang làm","Tiếp tục phần còn dở","Tiếp tục từ trạng thái hiện tại","Tiếp tục xử lý việc đang dở","Tiếp tục công việc đang dang dở","Thực thi tiếp việc hiện tại","Làm tiếp nhiệm vụ đang thực hiện","Tiếp tục đúng việc đang được giao","Làm tiếp, không đổi việc"]);
    expect(CONTINUE_PROMPTS).toHaveLength(21);
    expect(new Set(CONTINUE_PROMPTS).size).toBe(21);
    expect(pickContinuePrompt('Tiếp tục',()=>0)).toBe('Làm tiếp');
    expect(pickContinuePrompt('Làm tiếp, không đổi việc',()=>0.999999)).not.toBe('Làm tiếp, không đổi việc');
    for(const prompt of CONTINUE_PROMPTS){
      expect(prompt).not.toMatch(/tự (lấy|chọn)|việc tiếp theo|hàng đợi|ưu tiên cao nhất/i);
    }
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
    expect(hasActiveNv02Work({jobs:[{workerId:'NV02',stage:'WAITING_EVIDENCE',completedAt:null}],autopilot:{phase:'IDLE'}})).toBe(false);
    expect(hasWaitingEvidenceNv02Work({jobs:[{workerId:'NV02',stage:'WAITING_EVIDENCE',completedAt:null}]})).toBe(true);
    expect(hasWaitingEvidenceNv02Work({jobs:[{workerId:'NV02',stage:'DONE',completedAt:'2026-09-20T00:00:00Z'}]})).toBe(false);
    for(const stage of ['SUBMITTED','WORKING','WAITING_EVIDENCE','VERIFY'])expect(hasContinuableNv02Work({jobs:[{workerId:'NV02',stage,completedAt:null}]})).toBe(true);
    for(const stage of ['QUEUED','DISPATCHING','DONE','BLOCKED','ERROR'])expect(hasContinuableNv02Work({jobs:[{workerId:'NV02',stage,completedAt:stage==='DONE'?'2026-09-20T00:00:00Z':null}]})).toBe(false);
    expect(hasActiveNv02Work({jobs:[{workerId:'NV02',stage:'VERIFY',completedAt:null}],autopilot:{phase:'IDLE'}})).toBe(true);
    expect(hasActiveNv02Work({jobs:[],autopilot:{pendingJobId:'GH-1'}})).toBe(true);
    expect(hasActiveNv02Work({jobs:[],autopilot:{phase:'IDLE'}})).toBe(false);
    expect(hasActiveNv02Work({jobs:[],autopilot:{phase:'BUSY',lastDispatchedJobId:'GH-1',lastCompletedJobId:'GH-1'}})).toBe(false);
    expect(hasActiveNv02Work({jobs:[],autopilot:{phase:'BUSY',lastDispatchedJobId:'GH-2',lastCompletedJobId:'GH-1'}})).toBe(true);
    expect(hasActiveNv02Work({externalWorkAutopilotEnabled:false,jobs:[],autopilot:{pendingJobId:'GH-STALE',phase:'BUSY'}})).toBe(false);
    expect(hasActiveNv02Work({jobs:[{workerId:'NV02',stage:'BLOCKED',completedAt:'2026-09-18T23:07:35.468Z'}],autopilot:{phase:'IDLE'}})).toBe(false);
  });

  it('keeps random timing inside requested windows', () => {
    expect(randomDelay(300000,600000,()=>0)).toBe(300000);
    expect(randomDelay(300000,600000,()=>0.999999)).toBeGreaterThanOrEqual(599999);
  });

  it('avoids immediate prompt repetition when alternatives exist', () => {
    expect(pickContinuePrompt('02',()=>0)).not.toBe('02');
  });

  it('keeps NV02 continuity isolated while allowing Controller command transport', () => {
    execFileSync(process.execPath,['--check','apps/chrome-controller/direct-cdp-bridge.mjs'],{stdio:'pipe'});
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(source).toContain('NV02_ISOLATED_AUTO_CONTINUE');
    expect(source).toContain("const currentTrackedWork=hasCurrentNv02Chat(ui?.url)");
    expect(source).toContain("CONTINUE_SKIPPED_NO_CURRENT_CHAT");
    expect(source).toContain("CONTINUE_DISPATCHED");
    expect(source).not.toContain("CONTEXT_RECOVERY_ROTATED");
    expect(source).toContain("controllerRequired:false");
    expect(source).toContain("CONTROLLER_TELEMETRY_UNAVAILABLE");
    expect(source).toContain("NV02_LOCAL_MUTATION_ACQUIRED");
    expect(source).toContain("await postWorkerHeartbeat(w,target,ui,projectContextReady).catch");
    const tick=source.slice(source.indexOf('async function tickWorker(w){'),source.indexOf('\n\nasync function tick()'));
    expect(tick).toContain('getCommand(w.id)');
    expect(source).toContain("String(state?.ownerInteractionMode||'')==='READ_ONLY'");
    expect(tick).toContain('if(await workerAutomationPaused(w.id))');
    expect(tick.indexOf('await postWorkerHeartbeat(w,target,ui,projectContextReady)')).toBeLessThan(tick.indexOf('if(await workerAutomationPaused(w.id))'));
    expect(tick.indexOf('if(await workerAutomationPaused(w.id))')).toBeLessThan(tick.indexOf('getCommand(w.id)'));
    expect(tick.indexOf('if(await workerAutomationPaused(w.id))')).toBeLessThan(tick.indexOf("if(w.id==='NV02'&&!projectContextReady&&!ui.securityBlock)"));
    expect(tick.indexOf('getCommand(w.id)')).toBeLessThan(tick.indexOf("if(w.id==='NV02')await maybeNv02Continuity"));
    const backgroundSource=readFileSync('apps/chrome-controller/extension/background.js','utf8');
    expect(backgroundSource).toContain('HARD ISOLATION: NV02, NV03, and NV04 commands and UI mutation loops');
    const continuity=source.slice(source.indexOf('async function maybeNv02Continuity'),source.indexOf('\nasync function handleCommand'));
    expect(continuity).not.toContain('/api/utility/workers/NV02/job/recovery-resume');
    expect(source).toContain('ensureNv02ModelProfile');
    const continueDispatch=source.slice(
      source.indexOf('async function dispatchNaturalContinueLocked'),
      source.indexOf('async function dispatchNaturalContinue(target'),
    );
    expect(continueDispatch).not.toContain('ensureNv02ModelProfile');
    expect(continueDispatch).toContain('getControllerState()');
    expect(continueDispatch).toContain('hasContinuableNv02Work(controllerState)');
    expect(continueDispatch).toContain('findContinuableNv02Work(controllerState)');
    expect(source).toContain("function findContinuableNv02Work(controllerState)");
    expect(source).toContain("typeof job?.issueRef==='string'");
    expect(continueDispatch).toContain('CONTINUE_CURRENT_WORK_VERIFIED');
    expect(continueDispatch).toContain('CONTINUE_SKIPPED_NO_CURRENT_WORK');
    expect(continueDispatch).toContain('CONTINUE_SKIPPED_CURRENT_WORK_UNVERIFIED');
    expect(source).toContain("if(phase==='STALLED'&&ui?.modelExact!==true&&modelCheckRequired)");
    expect(source).toContain("withNv02Mutation(()=>ensureNv02ModelProfile(target),'MODEL_PROFILE_RECOVERY')");
    expect(source).toContain("modelName==='GPT-5.6 Sol'");
    expect(source).toContain("const NV02_F5_MAX_MS=20*60*1000");
    expect(source).toContain("const UI_STABILITY_PACING_MIN_MS=1200");
    expect(source).toContain("VIEW_FOLLOW_BOTTOM");
    expect(source).toContain("nextViewFollowAt");
    expect(source).toContain("reasoningEffort==='High'");
    expect(source).toContain("async open(timeout=4000)");
    expect(source).toContain("fail(new Error('CDP_OPEN_TIMEOUT'))");
    expect(source).toContain("fail(new Error('CDP_OPEN_ERROR'))");
    expect(source).toContain("const worker=config.workers.find(w=>w.id==='NV02')");
    expect(source).not.toContain("config.workers.filter(w=>w.enabled!==false&&w.id==='NV02')");
    expect(source).toContain("controllerEnabledFlagIgnored:true");
    expect(source).toContain("WORKING_LONG_RUNNING_NO_MUTATION");
    expect(source).toContain("WORKING_STALLED_STOPPED");
    expect(source).toContain("STALLED_HOT_LOOP_NO_CHECKPOINT");
    const continuityLoop=source.slice(source.indexOf('async function maybeNv02Continuity'),source.indexOf('async function handleCommand'));
    expect(continuityLoop).toContain('shouldRotateNv02Chat');
    expect(continuityLoop).toContain('rotateNv02Chat(target,state,now)');
    expect(continuityLoop).not.toContain('checkpointNv02(');
    expect(source).toContain("nextProgressCheckAt:now+WORKING_PROGRESS_CHECK_MS");
    expect(source).toContain("unchanged>=MAX_WORKING_UNCHANGED_CHECKS");
    expect(continuityLoop.indexOf("if(phase==='WORKING')")).toBeLessThan(continuityLoop.indexOf("if(currentTrackedWork&&now>=Number(state.nextPeriodicF5At||0))"));
    expect(continuityLoop.indexOf("if(phase==='WORKING')")).toBeLessThan(continuityLoop.indexOf("if(now<state.nextContinueAt)return"));
    expect(source).toContain("const NV02_F5_MIN_MS=5*60*1000");
    expect(source).toContain("const NV02_F5_MAX_MS=20*60*1000");
    expect(source).toContain("'PERIODIC_F5_REFRESH'");
    expect(source).toContain("let nextPeriodicF5At=Number(raw.nextPeriodicF5At)||nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS)");
    expect(source).toContain("let workingRecheckAt=Number(raw.workingRecheckAt)||0");
    expect(source).toContain("'NV02_F5_TIMERS_REBASED_AFTER_RESTART'");
    expect(source).toContain("nextPeriodicF5At:nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS)");
    expect(source).toContain("modelCheckBlockedUntil:now+30000");
    expect(source).toContain("modelCheckBlockedUntil:now+60_000");
    expect(source).toContain("MODEL_PROFILE_RECOVERY_FAILED");
    expect(source).toContain("modelCheckBlockedUntil:Number(raw.modelCheckBlockedUntil)||0");

    expect(source).toContain("verifiedChatUrl:String(raw.verifiedChatUrl||'')");
    expect(source).toContain("resumeChatUrl:String(raw.resumeChatUrl||(hasCurrentNv02Chat(raw.verifiedChatUrl)?raw.verifiedChatUrl:'')||'')");
    expect(source).toContain("resumeChatUrl:hasCurrentNv02Chat(currentUrl)?currentUrl:state.resumeChatUrl");
    expect(source).toContain("if(hasCurrentNv02Chat(state.resumeChatUrl)){");
    expect(source).toContain("await navigate(target,state.resumeChatUrl)");
    expect(source).toContain("'CURRENT_CHAT_RESTORE'");
    expect(source).toContain("'CURRENT_CHAT_RESTORED'");

    expect(source).toContain("sameNv02Chat(state.verifiedChatUrl,ui?.url)");
    expect(source).toContain("const modelCheckRequired=now>=Number(state.modelCheckBlockedUntil||0)&&(ui?.modelExact!==true||!state.verifiedChatUrl||!sameNv02Chat(state.verifiedChatUrl,ui?.url))");
    expect(source).toContain("phase==='STALLED'&&ui?.modelExact!==true&&modelCheckRequired");
    expect(source).toContain("phase==='STALLED'&&ui?.modelExact!==true&&modelCheckRequired");
    const currentChatRestoreGate=continuityLoop.indexOf("if(!currentTrackedWork&&hasCurrentNv02Chat(state.resumeChatUrl))");
    const periodicF5Gate=continuityLoop.indexOf("if(currentTrackedWork&&now>=Number(state.nextPeriodicF5At||0))");
    const modelRecoveryGate=continuityLoop.indexOf("if(phase==='STALLED'&&ui?.modelExact!==true&&modelCheckRequired)");
    const noCurrentChatGate=continuityLoop.indexOf("if(!currentTrackedWork)");
    expect(currentChatRestoreGate).toBeGreaterThan(-1);
    expect(periodicF5Gate).toBeGreaterThan(currentChatRestoreGate);
    expect(periodicF5Gate).toBeLessThan(modelRecoveryGate);
    expect(currentChatRestoreGate).toBeLessThan(modelRecoveryGate);
    expect(modelRecoveryGate).toBeGreaterThan(-1);
    expect(noCurrentChatGate).toBeGreaterThan(modelRecoveryGate);

    expect(source).not.toContain("state.verifiedChatUrl===ui?.url");
    expect(source).toContain("const currentUrl=String(profile.url||'')");
    expect(source).toContain("verifiedChatUrl:currentUrl");
    expect(source).toContain("location.hostname==='chatgpt.com'?Boolean(stop):Boolean(stop||activityBusy)");
    expect(source).toContain("function sameNv02Chat(a,b)");
    expect(source).toContain("currentProjectId=(current.pathname.match(");
    expect(source).toContain("currentProjectId===NV02_PROJECT_ID");
    expect(source).toContain("function preferredWorkerUrl(w)");
    expect(source).toContain("state.resumeChatUrl||state.verifiedChatUrl||''");
    expect(source).toContain("pages.find(t=>sameWorkerLocation(t.url,preferredUrl))");


    const f5Block=source.slice(source.indexOf("if(currentTrackedWork&&now>=Number(state.nextPeriodicF5At||0))"),source.indexOf("const modelCheckRequired="));
    expect(f5Block).toContain("reloadTarget(target)");
    expect(f5Block).not.toContain("ensureNv02ModelProfile");
    expect(f5Block).not.toContain("checkpointNv02");
    expect(f5Block).not.toContain("rotateNv02Chat");

    expect(source).toContain('[data-message-author-role="assistant"]');

    expect(source).toContain('button[aria-label*="Ngừng" i]');
    const dispatchExprSource=source.slice(source.indexOf('function dispatchExpr'),source.indexOf('function enterSubmitStateExpr'));
    expect(dispatchExprSource).toContain('button[aria-label*=\\\"Ngừng\\\" i]');
    expect(backgroundSource).toBeTruthy();
    const contentSource=readFileSync('apps/chrome-controller/extension/content.js','utf8');
    expect(contentSource).toContain('button[aria-label*="Ngừng" i]');
  });

  it('rotates only when there is CHAT_BAD evidence (e.g. chatLoadRecoveryStage, authRequired, securityBlock) and ignores time/count', () => {
    // Proves that time/dispatch count alone never trigger rotation
    expect(shouldRotateNv02Chat({phase:'READY',currentTrackedWork:true,now:9999999,nextRefreshAt:0,dispatchesInChat:9999})).toBe(false);
    expect(shouldRotateNv02Chat({phase:'WORKING',currentTrackedWork:true,now:9999999,nextRefreshAt:0,dispatchesInChat:9999})).toBe(false);

    // Proves CHAT_BAD terminal recovery exhaustion triggers rotation
    expect(shouldRotateNv02Chat({currentTrackedWork:true,now:102,chatLoadRecoveryStage:3})).toBe(true);

    // Proves authRequired/securityBlock do NOT trigger rotation (they fail-closed instead)
    expect(shouldRotateNv02Chat({currentTrackedWork:true,now:100,authRequired:true})).toBe(false);
    expect(shouldRotateNv02Chat({currentTrackedWork:true,now:100,securityBlock:'IP_BANNED'})).toBe(false);

    // Un-tracked work doesn't trigger rotation yet
    expect(shouldRotateNv02Chat({phase:'READY',currentTrackedWork:false,now:100,chatLoadRecoveryStage:3})).toBe(false);

    // Bounded retry applies
    expect(shouldRotateNv02Chat({currentTrackedWork:true,now:100,rotationRetryAt:101,chatLoadRecoveryStage:3})).toBe(false);
    expect(shouldRotateNv02Chat({currentTrackedWork:true,now:102,rotationRetryAt:101,chatLoadRecoveryStage:3})).toBe(true);

    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain("CHAT_ROTATION_DUE");
    expect(bridge).toContain("CHAT_ROTATION_FAILED");
    expect(bridge).toContain("CHAT_ROTATION_DEFERRED_TO_EXTERNAL_AUTOPILOT");
    expect(bridge).toContain("rotationRetryAt:Number(raw.rotationRetryAt)||0");
    expect(bridge).toContain("conversationId=(location.pathname.match(");
    expect(bridge).toContain("chatgpt:conversation:'+conversationId");
    expect(bridge).toContain("identityRows.length?identityRows");
    expect(bridge).toContain("archiveConfirmExpr(menuPoint.title,menuPoint.conversationId)");
    expect(bridge).toContain("const verified=loadNv02Continuity();");
    const rotation=bridge.slice(bridge.indexOf('async function rotateNv02Chat'),bridge.indexOf('async function noteNv02CommandDispatch'));
    expect(rotation).toContain("resumeChatUrl:''");
    expect(rotation).toContain("verifiedChatUrl:''");
    expect(rotation).toContain("rotateNv02Chat");
    const continuity=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('\nasync function handleCommand'));
    const workingGate=continuity.indexOf("if(phase==='WORKING')");
    const recoveryGate=continuity.indexOf('const chatLoadRecoveryHandled=await maybeRecoverChatLoadError');
    const reloadPersistedRecovery=continuity.indexOf('state=loadNv02Continuity()',recoveryGate);
    const rotateGate=continuity.indexOf('if(shouldRotateNv02Chat',recoveryGate);
    expect(workingGate).toBeGreaterThan(-1);
    expect(recoveryGate).toBeGreaterThan(workingGate);
    expect(reloadPersistedRecovery).toBeGreaterThan(recoveryGate);
    expect(rotateGate).toBeGreaterThan(reloadPersistedRecovery);
  });

  it('restores the exact durable CURRENT_WORK_ORDER after archive instead of blind continue', () => {
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(source).toContain('function buildCurrentWorkRestorePrompt');
    expect(source).toContain('CURRENT_WORK_ORDER=');
    expect(source).toContain('CURRENT_CHECKPOINT=');
    expect(source).toContain('DURABLE_SAVE_RECEIPT=');
    expect(source).toContain('CURRENT_WORK_RESTORE_DISPATCHED');
    expect(source).toContain('CURRENT_WORK_RESTORE_SKIPPED_CHANGED_WORK');
    expect(source).toContain('CHAT_ROTATION_SKIPPED_NO_CURRENT_WORK');
    expect(source).toContain('checkpointNv02(target,currentWork)');
    const rotation=source.slice(source.indexOf('async function rotateNv02Chat'),source.indexOf('async function noteNv02CommandDispatch'));
    expect(rotation).toContain('CHAT_ROTATION_CURRENT_WORK_VERIFIED');
    expect(rotation).toContain('dispatchCurrentWorkRestoreLocked(target,next,now,currentWork,receipt)');
    expect(rotation).not.toContain('dispatchNaturalContinueLocked(target,next,now)');
    const archiveCall=rotation.indexOf('const archived=await archiveChat(target)');
    const clearResume=rotation.indexOf("resumeChatUrl:''");
    const newChatCall=rotation.indexOf('const opened=await newChat(target)');
    expect(archiveCall).toBeGreaterThan(-1);
    expect(clearResume).toBeGreaterThan(archiveCall);
    expect(newChatCall).toBeGreaterThan(clearResume);
    const beforeArchive=rotation.slice(0,archiveCall);
    expect(beforeArchive).not.toContain("resumeChatUrl:''");
    expect(rotation).toContain("if(!archived?.ok)throw new Error(archived?.status||'ROTATE_ARCHIVE_FAILED')");
    expect(rotation).toContain("if(!opened?.ok)throw new Error(opened?.status||'ROTATE_NEW_CHAT_FAILED')");
    const checkpoint=source.slice(source.indexOf('async function checkpointNv02'),source.indexOf('async function rotateNv02Chat'));
    expect(checkpoint).toContain('CHECKPOINT_CURRENT_WORK_REQUIRED');
    expect(checkpoint).toContain('CURRENT_WORK_ORDER=');
  });

  it('persists NV02 chat-load stable candidate across continuity ticks', () => {
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const loader=source.slice(source.indexOf('function loadNv02Continuity'),source.indexOf('function saveNv02Continuity'));
    expect(loader).toContain('chatLoadClearCandidateAt:Number(raw.chatLoadClearCandidateAt)||0');
    const recovery=source.slice(source.indexOf('async function maybeRecoverChatLoadError'),source.indexOf('const MODEL_SELECTOR_CLICK_EXPR'));
    expect(recovery).toContain('chatLoadClearCandidateAt:now');
    expect(recovery).toContain('now-candidateAt<5000');
    expect(recovery).toContain("'CHAT_LOAD_RECOVERED_STABLE'");
  });

  it('classifies ChatGPT request-timeout retry cards as recoverable chat errors', () => {
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const ui=source.slice(source.indexOf('const UI_EXPR='),source.indexOf('async function uiStateRaw'));
    expect(ui).toContain('requestTimeoutError');
    expect(ui).toContain('yêu cầu (?:đã )?hết thời gian chờ');
    expect(ui).toContain('request (?:has )?timed out');
    expect(ui).toContain('request timeout');
    expect(ui).toContain('Boolean(chatRetry)');
    expect(ui).toContain("const parts=[]");
    expect(ui).toContain("parts.push(text)");
    expect(ui).toContain("parts.join(' | ')");
    expect(source).toContain("function chatLoadRetryExpr()");
    expect(source).toContain("CHAT_LOAD_RETRY");
    expect(source).toContain("CHAT_LOAD_F5");
    expect(source).toContain("CHAT_LOAD_REOPEN");
  });

  it('ships one-shot NV02 continuity installer with exact-head deploy and rollback',()=>{
    const installer=readFileSync('apps/chrome-controller/runtime/Install-NV02-Continuity.ps1','utf8');
    expect(installer).toContain('[Parameter(Mandatory=$true)][string]$ExpectedHead');
    expect(installer).toContain("[string]$SourceRef='main'");
    expect(installer).toContain("fetch','origin',$SourceRef");
    expect(installer).toContain("rev-parse 'FETCH_HEAD'");
    expect(installer).toContain("tests/chrome-controller-autonomy-hardening.test.ts");
    expect(installer).toContain("Invoke-Native -File 'npm' -ArgumentList @('run','typecheck')");
    expect(installer).toContain("Invoke-Native -File 'npm' -ArgumentList @('run','build')");
    expect(installer).toContain("Deploy-1122-");
    expect(installer).toContain('Assert-Ok (Test-Path $launcher) "LAUNCHER_NOT_FOUND:$launcher"');
    expect(installer).toContain('& $launcher');
    expect(installer).not.toContain('Start-ScheduledTask -TaskName $TaskName');
    expect(installer).toContain("apps\\chrome-controller\\direct-cdp-bridge.mjs");
    expect(installer).toContain("NV02_PACKAGE_FAILED_ROLLBACK_APPLIED");
    expect(installer).toContain("CONTROLLER_NOT_RUNNING_DEPLOY_HEAD");
    expect(installer).toContain("BRIDGE_NOT_RUNNING_DEPLOY_HEAD");
    expect(installer).toContain("CONTROLLER_APPROVED_HEAD_MISMATCH");
    expect(installer).toContain("BRIDGE_APPROVED_HEAD_MISMATCH");
    expect(installer).toContain("BRIDGE_SOURCE_HASH_MISMATCH");
    expect(installer).toContain("NV02_MODEL_NOT_READY");
    expect(installer).toContain("NV02_REASONING_NOT_HIGH");
    const resumeModeIndex=installer.indexOf("Set-OwnerMode ([bool]$ResumeAutomation)");
    const modelWaitIndex=installer.indexOf("$deadline=(Get-Date).AddSeconds(30)");
    expect(resumeModeIndex).toBeGreaterThan(-1);
    expect(modelWaitIndex).toBeGreaterThan(resumeModeIndex);
    expect(installer.indexOf("Set-OwnerMode ([bool]$ResumeAutomation)",resumeModeIndex+1)).toBe(-1);
    expect(installer).toContain("$effectiveConfig.autopilot.enabled=$false");
    expect(installer).toContain("$effectiveConfig.autopilot.stateUrl='http://127.0.0.1:8794/api/ui-autopilot/snapshot'");
    expect(installer).toContain('APP_CHROME_AUTOPILOT_DISABLE_FAILED');
    expect(installer).toContain('APP_CHROME_STATE_URL_MISMATCH');
    const example=JSON.parse(readFileSync('apps/chrome-controller/chrome-controller.config.example.json','utf8'));
    expect(example.autopilot.enabled).toBe(false);
    expect(example.autopilot.stateUrl).toBe('http://127.0.0.1:8794/api/ui-autopilot/snapshot');
    expect(installer).toContain("Invoke-Native -File 'git' -ArgumentList");
    expect(installer).toContain("Invoke-Native -File 'npm' -ArgumentList");
    expect(installer).not.toContain("Invoke-Native 'git' @(");
  });

});
