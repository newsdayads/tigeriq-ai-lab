const SAVE_RECEIPT_SERVICE='http://127.0.0.1:8794';
const SAVE_LEDGER_ISSUE=788;
const ARCHIVE_SUPPORTED_WORKERS=new Set(['NV02','NV03']);
const ACTIVE_STATUSES=new Set(['QUEUED','READY','RUNNING','WAITING','BLOCKED','REVIEWING']);

export function validateArchiveCommand(workerId,payload){
  if(!ARCHIVE_SUPPORTED_WORKERS.has(workerId)) throw new Error(`ARCHIVE_SELECTOR_UNVERIFIED:${workerId}`);
  const upstreamReceiptRef=String(payload?.receiptRef||'');
  if(!upstreamReceiptRef.startsWith('https://github.com/')) throw new Error('ARCHIVE_DURABLE_RECEIPT_REQUIRED');
  return upstreamReceiptRef;
}

export function doneEvidence(snapshot,workerId){
  const job=snapshot?.previousJob;
  if(!job||job.workerId!==workerId||job.status!=='DONE') return null;
  const evidence=(job.evidence||[]).find((item)=>['GITHUB','CORE'].includes(item?.source)&&String(item?.ref||'').trim()&&item?.verifiedAt);
  return evidence?{job,evidence}:null;
}

export async function assertArchiveAllowed(workerId,{getJson,requireDone=true}={}){
  if(!ARCHIVE_SUPPORTED_WORKERS.has(workerId)) throw new Error(`ARCHIVE_SELECTOR_UNVERIFIED:${workerId}`);
  if(typeof getJson!=='function') throw new Error('ARCHIVE_CONTROLLER_READER_REQUIRED');
  const state=await getJson('/api/state');
  if(state?.killed) throw new Error('ARCHIVE_CONTROLLER_KILLED');
  if(state?.paused) throw new Error('ARCHIVE_OWNER_INTERACTION_READ_ONLY');
  const worker=(state?.workers||[]).find((item)=>item.id===workerId);
  if(!worker?.enabled) throw new Error(`ARCHIVE_WORKER_DISABLED:${workerId}`);
  if(worker.blocked) throw new Error(`ARCHIVE_WORKER_BLOCKED:${workerId}`);
  if(worker.lastHeartbeat?.securityBlock) throw new Error(String(worker.lastHeartbeat.securityBlock));
  if(worker.lastHeartbeat?.uiBusy!==false) throw new Error('ARCHIVE_UI_NOT_IDLE');

  const autopilot=await getJson('/api/autopilot/state');
  if(workerId==='NV02'&&(autopilot?.state?.pendingJobId||autopilot?.state?.uncertainJobId)) throw new Error('ARCHIVE_ACTIVE_JOB_FORBIDDEN');
  const previous=autopilot?.snapshot?.previousJob;
  if(previous?.workerId===workerId&&ACTIVE_STATUSES.has(previous.status)) throw new Error('ARCHIVE_ACTIVE_JOB_FORBIDDEN');
  const proof=doneEvidence(autopilot?.snapshot,workerId);
  if(requireDone&&!proof) throw new Error('ARCHIVE_EXTERNAL_DONE_EVIDENCE_REQUIRED');
  return proof?{jobId:proof.job.jobId,evidenceRef:proof.evidence.ref}:{jobId:null,evidenceRef:null};
}

export function buildDurableSavePrompt({saveToken,workerId,dispatchedAt}){
  return [
    'lưu','',
    'Đây là lệnh CHỐT PHIÊN BỀN VỮNG của TigerIQ. Rà toàn bộ chat hiện tại; đối chiếu Nguồn Sự Thật động để chống trùng; cập nhật issue/Work Order/state hiện có với trạng thái thật, trọng tâm, quyết định mới, việc đã xong, việc còn dở, blocker/chờ/quyền cần thiết, bước tiếp theo và evidence/ref. Đọc lại để xác minh việc ghi đã thành công. Chỉ sau khi đã xác minh, thêm đúng 01 comment biên nhận vào GitHub Issue #'+SAVE_LEDGER_ISSUE+' với đầy đủ các dòng máy đọc được bên dưới. Repository là công khai: tuyệt đối không ghi secret/credential/password/token đăng nhập, dữ liệu sức khỏe/gia đình riêng tư, định danh không cần thiết hoặc nội dung kinh doanh mật; phải REDACT và chỉ tham chiếu nguồn private/authorized khi cần. Thay toàn bộ phần <...> bằng giá trị thật; không để placeholder. Nếu không ghi hoặc không xác minh được, KHÔNG tạo biên nhận DURABLE và báo BỊ CHẶN / SAVE_NOT_DURABLE.','',
    'TIGERIQ_SAVE_RECEIPT_V1',
    `TIGERIQ_SAVE_TOKEN=${saveToken}`,
    `TIGERIQ_SAVE_WORKER=${workerId}`,
    `TIGERIQ_SAVE_DISPATCHED_AT=${dispatchedAt}`,
    'TIGERIQ_SAVE_STATUS=DURABLE',
    'TIGERIQ_SAVE_REF=<URL GitHub của issue/Work Order/state đã cập nhật; nếu checkpoint nằm ngay ledger thì dùng https://github.com/newsdayads/tigeriq-ai-lab/issues/788>',
    'TIGERIQ_SAVE_STATE=<trạng thái thật>',
    'TIGERIQ_SAVE_FOCUS=<trọng tâm hiện tại>',
    'TIGERIQ_SAVE_DECISIONS=<quyết định mới hoặc NONE>',
    'TIGERIQ_SAVE_DONE=<việc đã hoàn tất hoặc NONE>',
    'TIGERIQ_SAVE_PENDING=<việc còn dở hoặc NONE>',
    'TIGERIQ_SAVE_BLOCKERS=<blocker/chờ/quyền cần thiết hoặc NONE>',
    'TIGERIQ_SAVE_NEXT=<bước tiếp theo>',
    'TIGERIQ_SAVE_EVIDENCE=<evidence/ref quan trọng>',
  ].join('\n');
}

export async function waitForSaveCompletion(uiState,{sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms)),pollMs=1000,busyObservationPolls=20,maxPolls=120}={}){
  let sawBusy=false;
  for(let poll=0;poll<maxPolls;poll+=1){
    const ui=await uiState();
    if(ui?.securityBlock) throw new Error(String(ui.securityBlock));
    if(ui?.uiBusy===true) sawBusy=true;
    if(sawBusy&&ui?.uiBusy===false) return;
    if(!sawBusy&&poll>=busyObservationPolls) throw new Error('SAVE_RESPONSE_NOT_OBSERVED');
    await sleep(pollMs);
  }
  throw new Error('SAVE_RESPONSE_TIMEOUT');
}

export async function waitForDurableSaveReceipt(saveToken,workerId,dispatchedAt,{fetchImpl=fetch,sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms)),delays=[0,2000,4000]}={}){
  let lastStatus='SAVE_NOT_DURABLE';
  for(const delayMs of delays){
    if(delayMs) await sleep(delayMs);
    const query=new URLSearchParams({token:saveToken,workerId,after:dispatchedAt});
    const response=await fetchImpl(`${SAVE_RECEIPT_SERVICE}/api/ui-autopilot/save-receipt?${query.toString()}`,{cache:'no-store'});
    if(!response.ok) throw new Error(`SAVE_RECEIPT_HTTP_${response.status}`);
    const value=await response.json();
    if(value?.ok===true&&value?.status==='DURABLE'&&value?.receiptRef&&value?.checkpointRef&&value?.verifiedAt) return value;
    lastStatus=String(value?.status||lastStatus);
  }
  throw new Error(lastStatus==='DURABLE'?'SAVE_RECEIPT_INCOMPLETE':'SAVE_NOT_DURABLE');
}

function archiveExpression(){
  return `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const txt=e=>String(e?.textContent||'').replace(/\\s+/g,' ').trim().toLowerCase();const security=()=>{if(document.querySelector('iframe[src*="captcha" i],iframe[src*="challenge" i],[class*="captcha" i],[id*="captcha" i]'))return'BLOCKED_CAPTCHA';const t=[...document.querySelectorAll('[role="alert"],[role="dialog"],[data-testid*="toast" i]')].slice(0,30).map(e=>(e.textContent||'').toLowerCase()).join(' ');for(const[n,s]of[['rate limit','BLOCKED_RATE_LIMIT'],['too many requests','BLOCKED_RATE_LIMIT'],['suspicious activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['unusual activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['verify your identity','BLOCKED_REAUTH'],['verify it’s you','BLOCKED_REAUTH'],['xác minh danh tính','BLOCKED_REAUTH']])if(t.includes(n))return s;return null};const blocked=security();if(blocked)return{ok:false,status:blocked};if(location.hostname!=='chatgpt.com')return{ok:false,status:'ARCHIVE_SELECTOR_UNVERIFIED_HOST'};if(!/\\/c\\//.test(location.pathname))return{ok:false,status:'ARCHIVE_REQUIRES_CONVERSATION_URL'};const before=location.href;const selectors=['header button[aria-haspopup="menu"]','main button[aria-haspopup="menu"]','button[data-testid*="conversation" i][aria-haspopup="menu"]','button[aria-label*="conversation" i][aria-haspopup="menu"]'];const candidates=[...new Set(selectors.flatMap(s=>[...document.querySelectorAll(s)]))].filter(vis).filter(e=>/more|menu|options|thêm|tùy chọn/.test(((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('title')||'')).toLowerCase()));if(candidates.length!==1)return{ok:false,status:'ARCHIVE_MENU_BUTTON_NOT_UNIQUE:'+candidates.length};candidates[0].click();await sleep(350);const afterMenu=security();if(afterMenu){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));return{ok:false,status:afterMenu}}const items=[...document.querySelectorAll('[role="menuitem"],[role="menu"] button,[data-radix-menu-content] button')].filter(vis);const archive=items.filter(e=>['archive','lưu trữ'].includes(txt(e)));if(archive.length!==1){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));return{ok:false,status:'ARCHIVE_MENU_ITEM_NOT_UNIQUE:'+archive.length}}archive[0].click();const deadline=Date.now()+8000;while(Date.now()<deadline){await sleep(250);if(location.href!==before||!/\\/c\\//.test(location.pathname))return{ok:true,status:'ARCHIVED'};const b=security();if(b)return{ok:false,status:b}}return{ok:false,status:'ARCHIVE_NOT_CONFIRMED'}})()`;
}

export async function archiveConversation({target,evaluate}){
  if(!target?.url) throw new Error('ARCHIVE_WORKER_WINDOW_AMBIGUOUS_OR_MISSING');
  const url=new URL(target.url);
  if(url.hostname!=='chatgpt.com') throw new Error('ARCHIVE_SELECTOR_UNVERIFIED_HOST');
  if(!/\/c\//.test(url.pathname)) throw new Error('ARCHIVE_REQUIRES_CONVERSATION_URL');
  const result=await evaluate(archiveExpression());
  if(!result?.ok) throw new Error(String(result?.status||'ARCHIVE_FAILED'));
  return result;
}

const TERMINAL_STATUSES = new Set(['COMPLETED','FAILED','CANCELED']);
export async function runDirectCdpArchive({workerId,target,payload,getJson,dispatch,uiState,evaluate,fetchImpl=fetch,sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms)),randomUUID=()=>crypto.randomUUID(),saveCompletionOptions={},receiptOptions={}}){
  const upstreamReceiptRef=validateArchiveCommand(workerId,payload);
  const proof=await assertArchiveAllowed(workerId,{getJson,requireDone:true});
  // Guard: only archive when job is in a terminal state
  if(!proof?.job?.status||!TERMINAL_STATUSES.has(proof.job.status))
    throw new Error('ARCHIVE_NOT_TERMINAL');
  if(!target?.url) throw new Error('ARCHIVE_WORKER_WINDOW_AMBIGUOUS_OR_MISSING');
  const url=new URL(target.url);
  if(url.hostname!=='chatgpt.com'||!/\/c\//.test(url.pathname)) throw new Error('ARCHIVE_WORKER_WINDOW_AMBIGUOUS_OR_MISSING');

  const saveToken=randomUUID();
  const dispatchedAt=new Date().toISOString();
  const saveText=buildDurableSavePrompt({saveToken,workerId,dispatchedAt});
  const save=await dispatch(saveText);
  if(!save?.ok) throw new Error(String(save?.status||'SAVE_DISPATCH_FAILED'));
  await waitForSaveCompletion(uiState,{sleep,...saveCompletionOptions});
  const receipt=await waitForDurableSaveReceipt(saveToken,workerId,dispatchedAt,{fetchImpl,sleep,...receiptOptions});

  // Send the archive command (the UI interaction)
  await archiveConversation({target,evaluate});

  // Verify a fresh receipt appears after the archive action, with bounded retries
  const maxAttempts=3;
  let attempt=0;
  let freshReceipt=null;
  while(attempt<maxAttempts){
    attempt++;
    try{
      const newReceipt=await waitForDurableSaveReceipt(saveToken,workerId,dispatchedAt,{fetchImpl,sleep,...receiptOptions});
      if(newReceipt.receiptRef!==receipt.receiptRef && new Date(newReceipt.verifiedAt)>new Date(receipt.verifiedAt)){
        freshReceipt=newReceipt;break;
      }
    }catch(err){
      const msg=String(err);
      if(/CAPTCHA|RATE[_-]LIMIT|SECURITY|CHALLENGE/i.test(msg)){
        // Abort flow and log safe‑stop event
        console.error('SAFE_STOP', {reason:msg,workerId});
        throw new Error('ARCHIVE_ABORTED_SECURITY_CHALLENGE');
      }
    }
    // exponential back‑off
    await sleep(500*Math.pow(2,attempt-1));
  }
  if(!freshReceipt) throw new Error('ARCHIVE_FRESH_RECEIPT_MISMATCH');

  return {ok:true,status:'ARCHIVED',workerId,jobId:proof.jobId,evidenceRef:proof.evidenceRef,receiptRef:freshReceipt.receiptRef,checkpointRef:freshReceipt.checkpointRef,receiptVerifiedAt:freshReceipt.verifiedAt,upstreamReceiptRef};
}
