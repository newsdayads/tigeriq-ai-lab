const SAVE_RECEIPT_SERVICE='http://127.0.0.1:8794';
const SAVE_LEDGER_ISSUE=788;
const POLL_DELAYS_MS=[0,2000,4000];

export function buildDurableSavePrompt({saveToken,workerId,dispatchedAt}){
  return [
    'lưu',
    '',
    'Đây là lệnh CHỐT PHIÊN BỀN VỮNG của TigerIQ. Rà toàn bộ chat hiện tại; đối chiếu Nguồn Sự Thật động để chống trùng; cập nhật issue/Work Order/state hiện có với trạng thái thật, trọng tâm, quyết định mới, việc đã xong, việc còn dở, blocker/chờ/quyền cần thiết, bước tiếp theo và evidence/ref. Đọc lại để xác minh việc ghi đã thành công. Chỉ sau khi đã xác minh, thêm đúng 01 comment biên nhận vào GitHub Issue #'+SAVE_LEDGER_ISSUE+' với đầy đủ các dòng máy đọc được bên dưới. Nếu không ghi hoặc không xác minh được, KHÔNG tạo biên nhận DURABLE và báo BỊ CHẶN / SAVE_NOT_DURABLE.',
    '',
    'TIGERIQ_SAVE_RECEIPT_V1',
    `TIGERIQ_SAVE_TOKEN=${saveToken}`,
    `TIGERIQ_SAVE_WORKER=${workerId}`,
    `TIGERIQ_SAVE_DISPATCHED_AT=${dispatchedAt}`,
    'TIGERIQ_SAVE_STATUS=DURABLE',
    'TIGERIQ_SAVE_REF=<URL issue/Work Order/state đã cập nhật hoặc URL comment #788 nếu comment đó chứa đầy đủ checkpoint>',
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

async function readReceipt(saveToken,workerId,dispatchedAt){
  const query=new URLSearchParams({token:saveToken,workerId,after:dispatchedAt});
  const response=await fetch(`${SAVE_RECEIPT_SERVICE}/api/ui-autopilot/save-receipt?${query.toString()}`,{cache:'no-store'});
  if(!response.ok)throw new Error(`SAVE_RECEIPT_HTTP_${response.status}`);
  return response.json();
}

export async function waitForDurableSaveReceipt(saveToken,workerId,dispatchedAt,{sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms))}={}){
  let lastStatus='SAVE_NOT_DURABLE';
  for(const delayMs of POLL_DELAYS_MS){
    if(delayMs)await sleep(delayMs);
    const value=await readReceipt(saveToken,workerId,dispatchedAt);
    if(value?.ok===true&&value?.status==='DURABLE'&&value?.receiptRef&&value?.checkpointRef&&value?.verifiedAt)return value;
    lastStatus=String(value?.status||lastStatus);
  }
  throw new Error(lastStatus==='DURABLE'?'SAVE_RECEIPT_INCOMPLETE':'SAVE_NOT_DURABLE');
}
