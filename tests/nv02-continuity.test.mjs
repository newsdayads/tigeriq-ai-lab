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

  it('isolates NV02 auto-continue from Controller/Core jobs', () => {
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
    expect(tick).not.toContain('getCommand(');
    const backgroundSource=readFileSync('apps/chrome-controller/extension/background.js','utf8');
    expect(backgroundSource).toContain("if(workerId==='NV02'){");
    expect(backgroundSource).toContain('HARD ISOLATION: NV02 commands are owned only by Direct CDP Bridge continuity.');
    const bgNv02Guard=backgroundSource.indexOf("if(workerId==='NV02'){");
    const bgCommandFetch=backgroundSource.indexOf('/api/commands/',bgNv02Guard);
    expect(bgNv02Guard).toBeGreaterThan(-1);
    expect(bgCommandFetch).toBeGreaterThan(bgNv02Guard);
    const continuity=source.slice(source.indexOf('async function maybeNv02Continuity'),source.indexOf('\nasync function handleCommand'));
    expect(continuity).not.toContain('getControllerState(');
    expect(continuity).not.toContain('hasActiveNv02Work(');
    expect(continuity).not.toContain('hasContinuableNv02Work(');
    expect(continuity).not.toContain('/api/utility/workers/NV02/job/recovery-resume');
    expect(source).toContain('ensureNv02ModelProfile');
    const continueDispatch=source.slice(
      source.indexOf('async function dispatchNaturalContinueLocked'),
      source.indexOf('async function dispatchNaturalContinue(target'),
    );
    expect(continueDispatch).not.toContain('ensureNv02ModelProfile');
    expect(source).toContain("if(phase==='STALLED'&&ui?.modelExact!==true&&!sameNv02Chat(state.verifiedChatUrl,ui?.url))");
    expect(source).toContain("withNv02Mutation(()=>ensureNv02ModelProfile(target),'MODEL_PROFILE_RECOVERY')");
    expect(source).toContain("modelName==='GPT-5.6 Sol'");
    expect(source).toContain("reasoningEffort==='High'");
    expect(source).toContain("async open(timeout=4000)");
    expect(source).toContain("fail(new Error('CDP_OPEN_TIMEOUT'))");
    expect(source).toContain("fail(new Error('CDP_OPEN_ERROR'))");
    expect(source).toContain("const worker=config.workers.find(w=>w.id==='NV02')");
    expect(source).not.toContain("config.workers.filter(w=>w.enabled!==false&&w.id==='NV02')");
    expect(source).toContain("controllerEnabledFlagIgnored:true");
    expect(source).toContain("WORKING_STALLED_RECOVERY");
    expect(source).toContain("WORKING_STALLED_STOPPED");
    expect(source).toContain("STALLED_HOT_LOOP_NO_CHECKPOINT");
    const continuityLoop=source.slice(source.indexOf('async function maybeNv02Continuity'),source.indexOf('async function handleCommand'));
    expect(continuityLoop).not.toContain('rotateNv02Chat(');
    expect(continuityLoop).not.toContain('checkpointNv02(');
    expect(source).toContain("nextProgressCheckAt:now+60000");
    expect(source).toContain("const NV02_F5_MIN_MS=5*60*1000");
    expect(source).toContain("const NV02_F5_MAX_MS=10*60*1000");
    expect(source).toContain("'PERIODIC_F5_REFRESH'");
    expect(source).toContain("nextRefreshAt:nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS)");
    expect(source).toContain("verifiedChatUrl:String(raw.verifiedChatUrl||'')");
    expect(source).toContain("sameNv02Chat(state.verifiedChatUrl,ui?.url)");
    expect(source).toContain("phase==='STALLED'&&ui?.modelExact!==true&&!sameVerifiedSession");

    expect(source).not.toContain("state.verifiedChatUrl===ui?.url");
    expect(source).toContain("verifiedChatUrl:String(profile.url||'')");
    expect(source).toContain("location.hostname==='chatgpt.com'?Boolean(stop):Boolean(stop||activityBusy)");
    expect(source).toContain("function sameNv02Chat(a,b)");
    expect(source).toContain("verifiedTargetId:String(raw.verifiedTargetId||'')");
    expect(source).toContain("state.verifiedTargetId===String(target.id||'')");
    expect(source).toContain("MODEL_SESSION_TARGET_PINNED");
    expect(source).toContain("pages.find(t=>state?.verifiedTargetId&&t.id===state.verifiedTargetId)");

    expect(source).toContain("pages.find(t=>sameNv02Chat(t.url,state?.verifiedChatUrl))");


    const f5Block=source.slice(source.indexOf("if(now>=Number(state.nextRefreshAt||0))"),source.indexOf("if(phase==='STALLED'&&ui?.modelExact!==true&&!sameVerifiedSession)"));
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

  it('does not auto-rotate chat by age or dispatch count', () => {
    const continuity=readFileSync('apps/chrome-controller/extension/continuity.js','utf8');
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(continuity).not.toContain('CHAT_ROTATE_AFTER');
    expect(continuity).not.toContain('shouldRotateChat');
    expect(bridge).not.toContain('shouldRotateChat');
  });
  it('keeps NV02 hot-loop recovery local, same-chat, and checkpoint-free', () => {
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(source).toContain("'MODEL_PROFILE_RECOVERY'");
    expect(source).toContain("'STALLED_RECOVERY'");
    expect(source).toContain("'WORKING_STALLED_RECOVERY'");
    expect(source).toContain("'PERIODIC_F5_REFRESH'");
    expect(source).toContain("stopAndClearComposerExpr");
    const continuityLoop=source.slice(source.indexOf('async function maybeNv02Continuity'),source.indexOf('async function handleCommand'));
    expect(continuityLoop).not.toContain("rotateNv02Chat(");
    expect(continuityLoop).not.toContain("checkpointNv02(");
    const recovery=source.slice(source.indexOf('async function recoverStalledWorking'),source.indexOf('async function checkpointNv02'));
    expect(recovery).not.toContain("checkpointNv02(");
    expect(recovery).not.toContain("archiveChat(");
    expect(recovery).not.toContain("newChat(");
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
