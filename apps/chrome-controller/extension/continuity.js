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
export const MAX_STALLED_CHECKS = 3;

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

export function deriveNv02Phase(ui,{heartbeatStale=false}={}){
  if(ui?.securityBlock)return 'BLOCKED';
  if(heartbeatStale)return 'STALLED';
  if(ui?.stopVisible===true||ui?.uiBusy===true)return 'WORKING';
  if(ui?.modelReady===false)return 'STALLED';
  if(String(ui?.uiPhase||'').toUpperCase()==='STALLED')return 'STALLED';
  if(ui?.composerReady===true&&ui?.authRequired!==true)return 'READY';
  return 'STALLED';
}

export function hasActiveNv02Work(controller){
  const activeStages=new Set(['QUEUED','DISPATCHING','SUBMITTED','WORKING','VERIFY','BLOCKED']);
  if((controller?.jobs||[]).some((job)=>job?.workerId==='NV02'&&activeStages.has(String(job?.stage||''))&&!job?.completedAt))return true;
  if(controller?.externalWorkAutopilotEnabled===false)return false;
  const autopilot=controller?.autopilot||{};
  if(autopilot.pendingJobId||autopilot.uncertainJobId)return true;
  const dispatched=String(autopilot.lastDispatchedJobId||'');
  const completed=String(autopilot.lastCompletedJobId||'');
  return Boolean((autopilot.phase==='BUSY'||autopilot.phase==='WAIT_EVIDENCE')&&dispatched&&dispatched!==completed);
}

export function hasWaitingEvidenceNv02Work(controller){
  return (controller?.jobs||[]).some((job)=>job?.workerId==='NV02'&&String(job?.stage||'')==='WAITING_EVIDENCE'&&!job?.completedAt);
}

export function hasContinuableNv02Work(controller){
  const continuableStages=new Set(['SUBMITTED','WORKING','WAITING_EVIDENCE','VERIFY']);
  return (controller?.jobs||[]).some((job)=>job?.workerId==='NV02'&&continuableStages.has(String(job?.stage||''))&&!job?.completedAt);
}
