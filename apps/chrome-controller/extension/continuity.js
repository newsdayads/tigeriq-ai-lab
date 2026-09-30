export const CONTINUE_PROMPTS = Object.freeze([
  'Kiểm tra trạng thái việc hiện tại và làm bước kế tiếp.',
  'Tiếp tục đúng Work Order đang active, không đổi việc.',
  'Làm bước nhỏ tiếp theo có thể kiểm chứng.',
  'Hoàn tất phần đang dở rồi ghi evidence.',
  'Kiểm tra kết quả bước vừa làm.',
  'Nếu có lỗi, xác định root cause và sửa trong phạm vi Work Order.',
  'Chạy test hoặc verification cần thiết cho bước hiện tại.',
  'Đọc lại acceptance criteria và đối chiếu kết quả.',
  'Kiểm tra dependency trước khi tiếp tục.',
  'Nếu dependency chưa đủ, ghi blocker cụ thể và dừng an toàn.',
  'Tiếp tục xử lý phần còn thiếu của Work Order.',
  'Không tự chuyển sang issue hoặc nhiệm vụ khác.',
  'Không tự tạo scope, claim hoặc resource mới ngoài Work Order.',
  'Kiểm tra evidence đã đủ và đúng định dạng chưa.',
  'Nếu đã đạt yêu cầu, ghi terminal evidence.',
  'Nếu bị chặn thật, ghi blocker và không lặp vô hạn.',
  'Nếu cần retry, retry đúng bước lỗi với giới hạn an toàn.',
  'Kiểm tra lease và resource ownership trước khi ghi.',
  'Hoàn tất, release lease và cập nhật trạng thái cuối.',
  'Nếu không còn active work, không tự bịa việc và chờ controller.',
  'Báo trạng thái ngắn gọn: DONE, BLOCKED, EXTERNAL_WAIT hoặc READY.',
]);

export const CONTINUE_MIN_MS = 3 * 1000;
export const CONTINUE_MAX_MS = 15 * 1000;
export const REFRESH_MIN_MS = 2 * 60 * 60 * 1000;
export const REFRESH_MAX_MS = 4 * 60 * 60 * 1000;
export const WORKER_REFRESH_MIN_MS = REFRESH_MIN_MS;
export const WORKER_REFRESH_MAX_MS = REFRESH_MAX_MS;
export const WORKER_F5_MIN_MS = 5 * 60 * 1000;
export const WORKER_F5_MAX_MS = 20 * 60 * 1000;
export const MAX_STALLED_CHECKS = 3;
export const WORKING_PROGRESS_CHECK_MS = 60 * 1000;
export const MAX_WORKING_UNCHANGED_CHECKS = 3;
export const AWAITING_WORK_START_TIMEOUT_MS = 30 * 1000;
export const CONTINUITY_WORKERS = Object.freeze(['NV02','NV03','NV04']);

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
  const base=pickContinuePrompt(String(previous||'').replace(/^\d{2}\s*-\s*/,''),random);
  const digits=(String(workerId||'').match(/\d+/)||[])[0]||'';
  const code=digits?digits.padStart(2,'0'):'';
  return code?code+' - '+base:base;
}

export function detectWorkerAssistantTerminal(rawText=''){
  const text=String(rawText||'').trim();
  if(!text)return '';
  const markerLine=(marker)=>text.split(/\r?\n/).some((rawLine)=>{
    const line=String(rawLine||'').trim()
      .replace(/^[>\-*+\s]+/,'')
      .replace(/^\*\*|\*\*$/g,'')
      .replace(/^\`+|\`+$/g,'')
      .trim();
    return line===marker||line===`STATE=${marker}`||line===`RESULT=${marker}`;
  });
  if(markerLine('TIGERIQ_CHAT_ROTATE_READY'))return 'TIGERIQ_CHAT_ROTATE_READY';
  if(markerLine('READY_NO_ELIGIBLE_WORK'))return 'READY_NO_ELIGIBLE_WORK';
  if(/(?:^|\n)\s*EXTERNAL_WAIT\b/i.test(text))return 'EXTERNAL_WAIT';
  if(/(?:^|\n)\s*DONE\b/i.test(text))return 'DONE';
  if(/(?:^|\n)\s*BLOCKED\b/i.test(text)||(/\bSTATE=BLOCKED\b/i.test(text)&&/\bLEASE=RELEASED\b/i.test(text)))return 'BLOCKED';
  return '';
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

export function shouldRearmAwaitingWorkStart({phase,awaitingWorkStart,awaitingWorkStartSince,now,timeoutMs=AWAITING_WORK_START_TIMEOUT_MS}={}){
  if(String(phase||'').toUpperCase()!=='READY')return false;
  if(awaitingWorkStart!==true)return false;
  const since=Number(awaitingWorkStartSince),current=Number(now),timeout=Number(timeoutMs);
  if(!Number.isFinite(since)||!Number.isFinite(current)||!Number.isFinite(timeout)||timeout<0)return false;
  return current-since>=timeout;
}

export function rearmAwaitingWorkStart(state,now){
  return {...state,awaitingWorkStart:false,awaitingWorkStartSince:0,pendingContinue:true,nextContinueAt:Number(now)};
}

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
