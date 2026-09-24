export const CONTINUE_PROMPTS = Object.freeze([
  'Tiếp tục',
  'Làm tiếp',
  'Tiếp đi',
  'Xử lý tiếp',
  'Thực hiện tiếp',
  'Tiếp tục công việc hiện tại',
  'Làm tiếp công việc hiện tại',
  'Tiếp tục việc đang làm',
  'Làm tiếp phần đang dở',
  'Tiếp tục từ chỗ hiện tại',
  'Tiếp tục đúng việc này',
  'Xử lý tiếp việc hiện tại',
  'Thực hiện tiếp việc đang làm',
  'Tiếp tục phần còn dở',
  'Tiếp tục từ trạng thái hiện tại',
  'Tiếp tục xử lý việc đang dở',
  'Tiếp tục công việc đang dang dở',
  'Thực thi tiếp việc hiện tại',
  'Làm tiếp nhiệm vụ đang thực hiện',
  'Tiếp tục đúng việc đang được giao',
  'Làm tiếp, không đổi việc',
]);

export const CONTINUE_MIN_MS = 5 * 60 * 1000;
export const CONTINUE_MAX_MS = 10 * 60 * 1000;
export const REFRESH_MIN_MS = 2 * 60 * 60 * 1000;
export const REFRESH_MAX_MS = 4 * 60 * 60 * 1000;
export const WORKER_REFRESH_MIN_MS = REFRESH_MIN_MS;
export const WORKER_REFRESH_MAX_MS = REFRESH_MAX_MS;
export const WORKER_F5_MIN_MS = 5 * 60 * 1000;
export const WORKER_F5_MAX_MS = 20 * 60 * 1000;
export const MAX_STALLED_CHECKS = 3;
export const WORKING_PROGRESS_CHECK_MS = 60 * 1000;
export const MAX_WORKING_UNCHANGED_CHECKS = 3;
export const CHAT_ROTATE_AFTER_DISPATCHES = 30;
export const CONTINUITY_WORKERS = Object.freeze(['NV02','NV03','NV04']);

export function shouldRotateNv02Chat({phase,currentTrackedWork,now,nextRefreshAt,dispatchesInChat,chatStartedAt,rotationRetryAt,chatLoadRecoveryStage}={}){
  if(!currentTrackedWork) return false;
  if(rotationRetryAt && now < rotationRetryAt) return false;
  // Never rotate while a response is visibly generating.
  if(String(phase||'').toUpperCase()==='WORKING') return false;
  // Recovery exhaustion is always a valid rotation reason once the UI is no longer busy.
  if(Number(chatLoadRecoveryStage||0) >= 3) return true;
  // Oversized/old chat rotation is allowed only from a stable READY state.
  if(String(phase||'').toUpperCase()!=='READY') return false;
  const overdueRefresh=Number(nextRefreshAt)>0 && Number(now)>=Number(nextRefreshAt);
  const tooManyDispatches=Number(dispatchesInChat||0)>=CHAT_ROTATE_AFTER_DISPATCHES;
  const tooOld=Number(chatStartedAt)>0 && Number(now)-Number(chatStartedAt)>=REFRESH_MAX_MS;
  return overdueRefresh||tooManyDispatches||tooOld;
}

export function randomDelay(minMs,maxMs,random=Math.random){
  if(!Number.isFinite(minMs)||!Number.isFinite(maxMs)||maxMs<minMs)throw new Error('RANDOM_DELAY_RANGE_INVALID');
  return Math.floor(minMs+random()*(maxMs-minMs+1));
}

export function nextRandomAt(now,minMs,maxMs,random=Math.random){
  return now+randomDelay(minMs,maxMs,random);
}

export function pickContinuePrompt(previous='',random=Math.random){
  if(CONTINUE_PROMPTS.length===1)return CONTINUE_PROMPTS[0];
  const candidates=CONTINUE_PROMPTS.filter((text)=>text!==previous);
  return candidates[Math.min(candidates.length-1,Math.floor(random()*candidates.length))];
}

export function pickWorkerContinuePrompt(workerId,previous='',random=Math.random){
  const id=String(workerId||'').toUpperCase();
  const common=' Core assignment còn hiệu lực thì ưu tiên làm assignment đó. Nếu không có assignment hoặc Core stale/unavailable: audit GitHub Source of Truth và tự claim đúng 01 việc P1-P5 hợp lệ trong vai trò; legacy P0 không có OWNER_CONTROLLED=true, OWNER_GATE=true hoặc ASSIGNED_EXECUTOR=NVxx được coi là P1 autonomous. Tuyệt đối không tự lấy P0 Owner-controlled và không sửa App Chrome. Trước khi fallback phải post [TIGERIQ_ROLE_CLAIM_V1] gồm WORKER, RESOURCE_SCOPE, LEASE_UNTIL tối đa 30 phút; renew nếu còn làm; khi DONE/BLOCKED/WAIT/HANDOFF post [TIGERIQ_ROLE_RELEASE_V1]. Không đụng việc đã có owner/lease hoặc scope đang bận. ';
  if(id==='NV02')return '02 — MAIN EXECUTOR.'+common+'NV02 lấy general/reasoning/execution cao nhất còn trống; không giành coding chuyên biệt, review độc lập, research chuyên sâu hoặc pc_operator. Làm liên tục tới DONE evidence / BLOCKED / EXTERNAL_WAIT / Owner gate.';
  if(id==='NV03')return '03 — INDEPENDENT REVIEW/QA.'+common+'NV03 chỉ lấy review/QA/PR verification độc lập chưa có reviewer; không sửa code đang review. Trả PASS hoặc CHANGES_REQUIRED có evidence, rồi nhả lease.';
  if(id==='NV04')return '04 — DEEP RESEARCH / SECOND OPINION.'+common+'NV04 chỉ lấy research, deep analysis, investigation hoặc second-opinion/cross-check phù hợp; không code hoặc mutation. Trả evidence rồi nhả lease.';
  const base=pickContinuePrompt(String(previous||'').replace(/^\d{2}\s*-\s*/,''),random);
  const digits=(String(workerId||'').match(/\d+/)||[])[0]||'';
  const code=digits?digits.padStart(2,'0'):'';
  return code?code+' - '+base:base;
}

export function deriveWorkerPhase(ui,{heartbeatStale=false,workerId='NV02'}={}){
  if(ui?.securityBlock)return 'BLOCKED';
  if(heartbeatStale)return 'STALLED';
  if(ui?.stopVisible===true||ui?.uiBusy===true)return 'WORKING';
  if(workerId==='NV02'){
    if(ui?.modelReady===false)return 'STALLED';
    if(String(ui?.uiPhase||'').toUpperCase()==='STALLED')return 'STALLED';
    if(ui?.composerReady===true&&ui?.authRequired!==true)return 'READY';
    return 'STALLED';
  }
  if(ui?.composerReady===true&&ui?.authRequired!==true)return 'READY';
  if(String(ui?.uiPhase||'').toUpperCase()==='STALLED')return 'STALLED';
  return 'STALLED';
}
export function deriveNv02Phase(ui,opts){return deriveWorkerPhase(ui,opts);}

function workerAutopilot(controller,workerId){
  const direct=controller?.autopilotByWorker?.[workerId]||controller?.workerAutopilot?.[workerId];
  if(direct)return direct;
  const workers=controller?.workers;
  const row=Array.isArray(workers)?workers.find((item)=>item?.id===workerId):workers?.[workerId];
  if(row?.autopilot)return row.autopilot;
  return workerId==='NV02'?(controller?.autopilot||{}):{};
}

export function hasActiveWorkerWork(controller,workerId='NV02'){
  const activeStages=new Set(['QUEUED','DISPATCHING','SUBMITTED','WORKING','VERIFY','BLOCKED']);
  if((controller?.jobs||[]).some((job)=>job?.workerId===workerId&&activeStages.has(String(job?.stage||''))&&!job?.completedAt))return true;
  if(controller?.externalWorkAutopilotEnabled===false)return false;
  const autopilot=workerAutopilot(controller,workerId);
  if(autopilot.pendingJobId||autopilot.uncertainJobId)return true;
  const dispatched=String(autopilot.lastDispatchedJobId||'');
  const completed=String(autopilot.lastCompletedJobId||'');
  return Boolean((autopilot.phase==='BUSY'||autopilot.phase==='WAIT_EVIDENCE')&&dispatched&&dispatched!==completed);
}
export function hasActiveNv02Work(controller){return hasActiveWorkerWork(controller,'NV02');}

export function hasWaitingEvidenceWorkerWork(controller,workerId='NV02'){
  return (controller?.jobs||[]).some((job)=>job?.workerId===workerId&&String(job?.stage||'')==='WAITING_EVIDENCE'&&!job?.completedAt);
}
export function hasWaitingEvidenceNv02Work(controller){return hasWaitingEvidenceWorkerWork(controller,'NV02');}

export function hasContinuableWorkerWork(controller,workerId='NV02'){
  const continuableStages=new Set(['SUBMITTED','WORKING','WAITING_EVIDENCE','VERIFY']);
  return (controller?.jobs||[]).some((job)=>job?.workerId===workerId&&continuableStages.has(String(job?.stage||''))&&!job?.completedAt);
}
export function hasContinuableNv02Work(controller){return hasContinuableWorkerWork(controller,'NV02');}

export function rearmWorkerRunGrace(existingUntil=0,submittedAt=Date.now(),graceMs=15000){
  const current=Number(existingUntil)||0;
  const submitted=Number(submittedAt);
  const grace=Number(graceMs);
  if(!Number.isFinite(submitted)||!Number.isFinite(grace)||grace<0)throw new Error('WORKER_RUN_GRACE_INPUT_INVALID');
  return Math.max(current,submitted+grace);
}

export function computeWorkerStaggerDelay(workerIndex=0,baseMs=1000,multiplier=500){
  return Number(workerIndex)*Number(multiplier)+Number(baseMs);
}
export function computeNv02StaggerDelay(workerIndex,baseMs,multiplier){
  return computeWorkerStaggerDelay(workerIndex,baseMs,multiplier);
}

export const WORKER_GENERIC_CONSTANTS = Object.freeze({
  CONTINUE_MIN_MS,
  CONTINUE_MAX_MS,
  REFRESH_MIN_MS,
  REFRESH_MAX_MS,
  WORKER_REFRESH_MIN_MS,
  WORKER_REFRESH_MAX_MS,
  WORKER_F5_MIN_MS,
  WORKER_F5_MAX_MS
});
