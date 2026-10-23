// Owner work-card instruction receipts. GitHub issue comments are the existing durable record.
// This module intentionally does not grant a worker lease or mark acceptance complete.
export const OWNER_REQUEST_RECEIVED = 'TIGERIQ_OWNER_REQUEST_V1';
export const OWNER_REQUEST_RESULT = 'TIGERIQ_OWNER_REQUEST_RESULT_V1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESULTS = new Set(['ANSWERED','PLAN_SHOWN','WAITING','BLOCKED','VERIFIED']);

export function validateOwnerWorkRequest(value) {
  const issueNumber = Number(value?.issueNumber);
  const requestId = String(value?.requestId || '').trim();
  const message = String(value?.message || '').trim();
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || issueNumber > 99999999) throw new Error('invalid_owner_request_issue');
  if (!UUID.test(requestId)) throw new Error('invalid_owner_request_id');
  if (!message || message.length > 3000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(message)) throw new Error('invalid_owner_request_message');
  return { issueNumber, requestId, message };
}

// GitHub comments are durable but not an atomic idempotency store. A retry
// may reuse an ID only for the original issue AND exact validated message.
// Conflicting replay IDs must never return a success for a different command.
export function ownerWorkRequestReplayPlan(history=[], input={}) {
  const request=validateOwnerWorkRequest(input);
  const previous=(Array.isArray(history)?history:[]).find(row=>row?.requestId===request.requestId);
  if(!previous)return {kind:'NEW',request:null};
  if(previous.issueNumber!==request.issueNumber||previous.message!==request.message)
    return {kind:'CONFLICT',request:null};
  return {kind:'REPLAY',request:previous};
}

// AI reply text is not evidence that an Owner action was executed.
// Fail closed: only a clearly interrogative, non-action request may resolve
// with a conversational ANSWERED receipt. All actionable prompts remain open
// for the canonical Core lease/worker/accepted-result lifecycle.
export function ownerWorkRequestTriageStatus(message, mode) {
  if(mode==='clarify')return 'WAITING';
  const text=String(message||'').trim();
  const isQuestion=/[?？]\s*$/u.test(text)
    || /^(?:ai|gì|vì sao|tại sao|khi nào|bao giờ|bao nhiêu|ở đâu|thế nào|như thế nào|có phải)\s/iu.test(text);
  const action=/(?:^|[\s,.;:])(?:hãy|giúp|làm|sửa|thực hiện|triển khai|giao|tạo|xóa|xoá|chạy|đăng|bật|tắt|merge|deploy|kiểm tra|cập nhật|khôi phục|chốt|test)(?=$|[\s,.;:?!])/iu.test(text);
  return (mode==='reply'||mode==='status')&&isQuestion&&!action?'ANSWERED':'PLAN_SHOWN';
}

export function makeOwnerRequestReceipt(request) {
  const r = validateOwnerWorkRequest(request);
  return [OWNER_REQUEST_RECEIVED, 'OWNER_REQUEST_ID='+r.requestId, 'OWNER_REQUEST_ISSUE='+r.issueNumber,
    'OWNER_REQUEST_STATUS=RECEIVED', 'OWNER_REQUEST_MESSAGE_JSON='+JSON.stringify(r.message)].join('\n');
}

export function makeOwnerResultReceipt(requestId, status, response) {
  if (!UUID.test(String(requestId || ''))) throw new Error('invalid_owner_request_id');
  if (!RESULTS.has(status)) throw new Error('invalid_owner_request_status');
  const text = String(response || '').trim().slice(0, 3000);
  if (!text) throw new Error('invalid_owner_request_response');
  return [OWNER_REQUEST_RESULT, 'OWNER_REQUEST_ID='+requestId,
    'OWNER_REQUEST_STATUS='+status, 'OWNER_REQUEST_REPLY_JSON='+JSON.stringify(text)].join('\n');
}

export function ownerWorkRequestHistory(comments=[]) {
  const entries = new Map();
  for (const comment of Array.isArray(comments)?comments:[]) {
    const body = String(comment?.body||'');
    const first = body.split(/\r?\n/,1)[0];
    if (first!==OWNER_REQUEST_RECEIVED && first!==OWNER_REQUEST_RESULT) continue;
    const id = /^OWNER_REQUEST_ID=([^\r\n]+)$/m.exec(body)?.[1]||'';
    if (!UUID.test(id)) continue;
    const createdAt = comment?.created_at||null;
    if (first===OWNER_REQUEST_RECEIVED) {
      const issueNumber=Number(/^OWNER_REQUEST_ISSUE=(\d+)$/m.exec(body)?.[1]);
      const json=/^OWNER_REQUEST_MESSAGE_JSON=(.+)$/m.exec(body)?.[1];
      let message;
      try { message=JSON.parse(json||''); } catch { continue; }
      if (!Number.isSafeInteger(issueNumber)||typeof message!=='string'||!message) continue;
      if (!entries.has(id)) entries.set(id,{requestId:id,issueNumber,message,status:'RECEIVED',reply:null,createdAt,updatedAt:createdAt,receiptUrl:comment.html_url||null});
    } else if(entries.has(id)) {
      const status=/^OWNER_REQUEST_STATUS=([A-Z_]+)$/m.exec(body)?.[1];
      const json=/^OWNER_REQUEST_REPLY_JSON=(.+)$/m.exec(body)?.[1];
      let reply; try{reply=JSON.parse(json||'');}catch{continue;}
      if (!RESULTS.has(status)||typeof reply!=='string')continue;
      const row=entries.get(id);
      row.status=status;row.reply=reply;row.updatedAt=createdAt;row.resultUrl=comment.html_url||null;
    }
  }
  return [...entries.values()].reverse();
}
export function ownerWorkRequestResolved(status) {
  return status==='ANSWERED'||status==='VERIFIED';
}
