export const CONTINUE_PROMPTS = Object.freeze([
  '02',
  'Làm tiếp',
  'Tiếp tục',
  'Thực thi',
  'Làm ngay',
  'Tiếp đi',
  'Xử lý tiếp',
  'Làm phần tiếp theo',
  'Tiếp tục công việc',
  'Thực hiện tiếp',
  'Tiếp tục từ trạng thái hiện tại',
  'Lấy việc tiếp theo làm đi',
  'Kiểm tra rồi làm tiếp',
  'Xem việc đang dở và tiếp tục',
  'Tự lấy việc tiếp theo',
  'Tiếp tục đến khi xong',
  'Đừng dừng, làm tiếp',
  'Xử lý việc ưu tiên cao nhất',
  'Tiếp tục theo trạng thái hiện tại',
  'Làm việc tiếp theo trong hàng đợi',
  'Kiểm tra việc chưa xong rồi thực thi',
  'Tiếp tục công việc đang dang dở',
  'Tự chọn việc phù hợp và làm tiếp',
  'Tiếp tục xử lý, không cần chờ tôi',
  'Làm tiếp đến điểm dừng hợp lệ',
]);

export const CONTINUE_MIN_MS = 5 * 60 * 1000;
export const CONTINUE_MAX_MS = 10 * 60 * 1000;
export const REFRESH_MIN_MS = 2 * 60 * 60 * 1000;
export const REFRESH_MAX_MS = 4 * 60 * 60 * 1000;
export const MAX_STALLED_CHECKS = 3;
export const CHAT_ROTATE_AFTER_DISPATCHES = 8;
export const CHAT_ROTATE_AFTER_MS = 45 * 60 * 1000;

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
  const autopilot=controller?.autopilot||{};
  if(autopilot.pendingJobId||autopilot.uncertainJobId)return true;
  const dispatched=String(autopilot.lastDispatchedJobId||'');
  const completed=String(autopilot.lastCompletedJobId||'');
  return Boolean((autopilot.phase==='BUSY'||autopilot.phase==='WAIT_EVIDENCE')&&dispatched&&dispatched!==completed);
}

export function shouldRotateChat(state,now){
  const started=Number(state?.chatStartedAt||now);
  const count=Number(state?.dispatchesInChat||0);
  return count>=CHAT_ROTATE_AFTER_DISPATCHES||(now-started)>=CHAT_ROTATE_AFTER_MS;
}
