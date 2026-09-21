import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDurableSavePrompt, SAVE_RECEIPT_POLL_DELAYS_MS, waitForDurableSaveReceipt } from '../apps/chrome-controller/extension/save-receipt.js';
import {
  CONTINUE_PROMPTS, deriveNv02Phase, hasActiveNv02Work, hasWaitingEvidenceNv02Work, hasContinuableNv02Work, pickContinuePrompt,
  randomDelay,
} from '../apps/chrome-controller/extension/continuity.js';

describe('NV02 continuity policy', () => {
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

  it('keeps exactly the approved 25 natural continue prompts', () => {
    expect(CONTINUE_PROMPTS).toHaveLength(25);
    expect(new Set(CONTINUE_PROMPTS).size).toBe(25);
    expect(CONTINUE_PROMPTS).toContain('Tiếp tục công việc hiện tại');
    expect(CONTINUE_PROMPTS).not.toContain('02');
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

  it('wires continuity into the live direct CDP bridge used by NV02', () => {
    execFileSync(process.execPath,['--check','apps/chrome-controller/direct-cdp-bridge.mjs'],{stdio:'pipe'});
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(source).toContain("if(w.id==='NV02')await maybeNv02Continuity");
    expect(source).toContain("w.enabled!==false&&w.id==='NV02'");
    expect(source).toContain("CONTINUE_DISPATCHED");
    expect(source).toContain("REFRESH_SCHEDULED");
    expect(source).toContain("CHAT_ROTATED");
    expect(source).toContain("ARCHIVE_CURRENT_ROW_COUNT_");
    expect(source).toContain("const actionDeadline=Date.now()+4000");
    expect(source).toContain("await sleep(200)");
    expect(source).toContain("function archiveConfirmExpr");
    expect(source).toContain("visibleChatRows");
    expect(source).toContain("currentTitleRows");
    expect(source).toContain("SIDEBAR_ROW_REMOVED");
    expect(source).toContain("data-selected-reasoning-effort");
    expect(source).toContain("MUTATION_LEASE_BUSY");
    expect(source).toContain("dispatchNaturalContinueLocked");
    expect(source).toContain("return dispatchNaturalContinueLocked(target,next,now)");
    expect(source).not.toContain("return dispatchNaturalContinue(target,next,now)");
    expect(source).toContain("ROTATE_MODEL_PROFILE_NOT_READY");
    expect(source).toContain("freshUi?.modelExact!==true");
    expect(source).toContain("NV02_HOME_URL");
    expect(source).toContain("projectNewChatExpr");
    expect(source).toContain("recoverNv02ProjectContext");
    expect(source).toContain("Trò chuyện mới trong TigerIQ AI Lab");
    expect(source).toContain("New chat in TigerIQ AI Lab");
    expect(source).toContain("PROJECT_NEW_CHAT_CLICKED");
    expect(source).toContain("labels.includes((e.getAttribute('aria-label')||'').trim())");
    expect(source).toContain("projectDraftReady");
    expect(source).toContain("projectDraftLabels");
    expect(source).toContain("thay đổi dự án: tigeriq ai lab");
    expect(source).toContain("change project: tigeriq ai lab");
    expect(source).toContain("rawUi.projectDraftReady===true");
    expect(source).toContain("for(let attempt=0;attempt<12;attempt+=1)");
    expect(source).toContain("await sleep(250)");
    expect(source).toContain("NEW_CHAT_PROJECT_CONTEXT_RECOVERED");
    expect(source).toContain("NEW_CHAT_PROJECT_DRAFT_READY");
    expect(source).toContain("function newChatContextExpr");
    expect(source).toContain("current?.composer&&current?.projectDraftReady===true");
    expect(source).toContain("state?.composer&&state?.projectDraftReady===true");
    expect(source).toContain("projectDraftLabels=['thay đổi dự án: tigeriq ai lab','change project: tigeriq ai lab']");
    expect(source).toContain("Page.navigate',{url:NV02_HOME_URL}");
    expect(source).toContain("NV02_PROJECT_PREFIX");
    expect(source).toContain("NV02_PROJECT_ID_PREFIX");
    expect(source).toContain("current.pathname.startsWith(NV02_PROJECT_ID_PREFIX+'/c/')");
    expect(source).toContain("isNv02ProjectContext");
    expect(source).toContain("PROJECT_CONTEXT_RECOVERY_NAVIGATED");
    expect(source).toContain("projectContextReady?rawUi:{...rawUi,uiReady:false,uiPhase:'STALLED',modelReady:false}");
    expect(source).toContain("ttlMs=30000");
    expect(source).toContain("'CHECKPOINT_DURABLE',120000");
    expect(source).toContain("'CHAT_ROTATION',60000");
    expect(source).toContain("NV02_STABLE_READY_TIMEOUT");
    expect(source).toContain("waitForIdleAfterSubmission(target,45000,5000)");
    expect(source).toContain("const SEND_BUTTON_WAIT_MS=10000");
    expect(source).toContain("SEND_BUTTON_WAIT_MS+6000");
    expect((source.match(/composer-submit-button/g)||[]).length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("until=Date.now()+${SEND_BUTTON_WAIT_MS}");
    expect(source).toContain("first?.status!=='SEND_BUTTON_NOT_FOUND'");
    expect(source).toContain("enterSubmitStateExpr(text)");
    expect(source).toContain("function focusComposerExpr");
    expect(source).toContain("async function rewriteComposerViaCdp");
    expect(source).toContain("Input.insertText");
    expect(source).toContain("CDP_TEXT_INSERT_VERIFIED");
    expect(source).toContain("CDP_TEXT_INSERT_EVIDENCE_MISSING");
    expect(source).toContain("expectedNormalized=String(text||'').replace(/\\\\s+/g,' ').trim()");
    expect(source).toContain("currentNormalized=current.replace(/\\\\s+/g,' ').trim()");
    expect(source).toContain("currentNormalized===expectedNormalized");
    expect(source).toContain("Input.dispatchKeyEvent");
    expect(source).not.toContain("ENTER_COMPOSER_CLEARED");
    expect(source).toContain(".rich-text-user-turn");
    expect(source).toContain("data-user-message-bubble");
    expect(source).toContain("data-content-search-unit-key$");
    expect(source).toContain("ENTER_USER_MESSAGE_VISIBLE");
    expect(source).toContain("ENTER_SUBMIT_EVIDENCE_MISSING");
    expect(source).toContain("activityBusyVisible:Boolean(activityBusy)");
    expect(source).toContain("đang suy nghĩ|thinking|generating|đang tạo");
    expect(source).toContain("/(^|\\\\s)(đang suy nghĩ|thinking|generating|đang tạo)(\\\\s|$)/i");
    expect(source).toContain(".replace(/\\\\s+/g,' ')");
    expect(source).not.toContain('shouldRotateChat');
    expect(source).toContain("CONTINUE_SKIPPED_NO_CURRENT_WORK");
    expect(source).toContain("const continuable=hasContinuableNv02Work(controller)");
    expect(source).toContain("const currentTrackedWork=continuable");
    expect(source).toContain("now>=state.nextRefreshAt&&phase==='READY'&&!active&&!waitingEvidence");
    expect(source).not.toContain('WAITING_EVIDENCE_CONTINUE_ACCELERATED');
    expect(source).not.toContain('IDLE_CONTINUE_ACCELERATED');
    expect(source).not.toContain('nextContinueAt:now+5000');
    expect(source).not.toContain('nextContinueAt:now+20000');
    expect(source).not.toContain('nextContinueAt:now+15000');
    expect(source).toContain("controller?.paused===true");
    expect(source).toContain("CONTINUE_SKIPPED_OWNER_READ_ONLY");
    expect(source).toContain("error.startsWith('BROWSER_MUTATION_LEASE_BUSY:')");
    expect(source).toContain("const checkpointed={...state,dispatchesInChat:0,chatStartedAt:now");
    expect(source).toContain("nextRefreshAt:nextRandomAt(now,REFRESH_MIN_MS,REFRESH_MAX_MS)");
    expect(source).not.toContain("PROJECT_CONTEXT_RECOVERY_AFTER_ROTATE_FAILED");
    expect(source).toContain("nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)");
    expect(source).toContain("'CONTINUITY_CONTINUE'");
    const leaseServerSource = readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(leaseServerSource).toContain("allowWaitingEvidence:continuityContinue");
    expect(leaseServerSource).toContain("purpose==='CONTINUITY_CONTINUE'");
    expect(leaseServerSource).toContain("if(!config.autopilot.enabled)return false;");
    expect(leaseServerSource).toContain("externalWorkAutopilotEnabled:config.autopilot.enabled");
    expect(leaseServerSource).toContain("EXTERNAL_WORK_AUTOPILOT_DISABLED");
    expect(source).toContain("WORKING_NO_PROGRESS_CHECK");
    expect(source).toContain("WORKING_STALE_RELOAD");
    expect(source).toContain("WORKING_NO_PROGRESS_3_CHECKS");
    expect(source).toContain("activitySignature");
    expect(source).toContain("workingUnchangedChecks");
    const serverSource=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(serverSource).not.toContain("paused&&!projectContextRecovery");
    expect(serverSource).toContain("if(paused)throw new Error('OWNER_INTERACTION_READ_ONLY');");
    expect(serverSource).toContain("const boundedRecovery=staleWorkingRecovery||stalledRecovery||modelProfileRecovery||checkpointRecovery||chatRotation");
    expect(serverSource).toContain("allowContinuable:continuityContinue");
    const backgroundSource=readFileSync('apps/chrome-controller/extension/background.js','utf8');
    expect(backgroundSource).not.toContain("if(workerId==='NV02')await maybeNv02Continuity(ctx,ui)");
    expect(backgroundSource).toContain('single NV02 continuity owner');
    expect(source).toContain('ensureNv02ModelProfile');
    expect(source).toContain('MODEL_56_SOL_CLICK_EXPR');
    expect(source).toContain('MODEL_SELECTED_EXPR');
    expect(source).toContain('[role="menuitemradio"][aria-checked="true"]');
    expect(source).toContain('nv02VerifiedModelProfile');
    const contentSource=readFileSync('apps/chrome-controller/extension/content.js','utf8');
    expect(contentSource).toContain("el.getAttribute?.('role') === 'menuitemradio'");
    expect(contentSource).toContain("el.getAttribute?.('aria-checked') === 'true'");
    expect(contentSource).toContain('lastVerifiedModelProfile');
    expect(contentSource).toContain("data-selected-reasoning-effort");
    expect(source).toContain("'MODEL_PROFILE_RECOVERY'");
    expect(source).toContain("'MODEL_PROFILE_HEARTBEAT_REFRESHED'");
    expect(source).toContain("await postWorkerHeartbeat(w,target,corrected,recoveredProjectContext)");
    const recoveryStart=source.indexOf("const corrected=await withNv02Mutation(()=>ensureNv02ModelProfile(target),'MODEL_PROFILE_RECOVERY')");
    const recoveryEnd=source.indexOf("state={...state,stalledChecks:Math.min(MAX_STALLED_CHECKS",recoveryStart);
    const recoverySlice=source.slice(recoveryStart,recoveryEnd);
    expect(recoverySlice.indexOf("postWorkerHeartbeat(w,target,corrected,recoveredProjectContext)")).toBeGreaterThan(-1);
    expect(recoverySlice.indexOf("postWorkerHeartbeat(w,target,corrected,recoveredProjectContext)")).toBeLessThan(recoverySlice.indexOf("dispatchNaturalContinue(target,state,now,waitingEvidenceJobId)"));
    expect(source).toContain("'/api/utility/workers/NV02/job/recovery-resume'");
    expect(source).toContain("'WAITING_EVIDENCE_RESUMED'");
    expect(source).toContain("nextContinueAt:now");
    expect(source).toContain("waitingEvidenceJobId");
    expect(source).toContain("if(currentTrackedWork&&phase==='STALLED'&&ui?.modelExact!==true)");
    expect(source.indexOf("if(currentTrackedWork&&phase==='STALLED'&&ui?.modelExact!==true)")).toBeLessThan(source.indexOf("if(now<state.nextContinueAt)return;"));
    expect(source).toContain("'RECOVERY_CONTINUE_NOT_DELIVERED'");
    expect(source).toContain("'ARCHIVE_CONFIRMED'");
    expect(source).toContain("'NEW_CHAT_CREATED'");
    expect(source).toContain("'CONTEXT_RECOVERY_ROTATED'");
    expect(source).toContain("modelName==='GPT-5.6 Sol'");
    expect(source).toContain("reasoningEffort==='High'");
  });

  it('does not auto-rotate chat by age or dispatch count', () => {
    const continuity=readFileSync('apps/chrome-controller/extension/continuity.js','utf8');
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(continuity).not.toContain('CHAT_ROTATE_AFTER');
    expect(continuity).not.toContain('shouldRotateChat');
    expect(bridge).not.toContain('shouldRotateChat');
  });
  it('wires reopen restore resume transition in ledger and server', () => {
    const ledgerSource=readFileSync('apps/chrome-controller/src/job-ledger.ts','utf8');
    const serverSource=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(ledgerSource).toContain('retryError');
    expect(ledgerSource).toContain('ERROR');
    expect(ledgerSource).toContain('QUEUED');
    expect(serverSource).toContain('retryKnownNotDelivered');
    expect(serverSource).toContain('uiJobLedger.retryError');
    expect(serverSource).toContain("'/api/utility/workers/NV02/job/recovery-resume'");
    expect(serverSource).toContain("uiJobLedger.resumeWaitingEvidence('NV02',jobId");
    expect(serverSource).toContain("RECOVERY_RESUME_REQUIRES_GPT_5_6_SOL_HIGH");
    expect(serverSource).toContain("BROWSER_MUTATION_LEASE_REQUIRED:NV02");
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
    expect(installer).toContain("NV02_MODEL_NOT_READY");
    expect(installer).toContain("NV02_REASONING_NOT_HIGH");
    expect(installer).toContain("$effectiveConfig.autopilot.enabled=$false");
    expect(installer).toContain("$effectiveConfig.autopilot.stateUrl=''");
    expect(installer).toContain('APP_CHROME_AUTOPILOT_DISABLE_FAILED');
    const example=JSON.parse(readFileSync('apps/chrome-controller/chrome-controller.config.example.json','utf8'));
    expect(example.autopilot.enabled).toBe(false);
    expect(example.autopilot.stateUrl).toBe('');
    expect(installer).toContain("Invoke-Native -File 'git' -ArgumentList");
    expect(installer).toContain("Invoke-Native -File 'npm' -ArgumentList");
    expect(installer).not.toContain("Invoke-Native 'git' @(");
  });

});
