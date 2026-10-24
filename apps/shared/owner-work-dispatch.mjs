// Parent Work Center Owner requests may open a read-only planning child in the
// EXISTING GitHub -> Core queue; no independent lease or direct action grants.
import { validateOwnerWorkRequest } from './owner-work-request.mjs';

const SCOPE=/^[A-Z][A-Z0-9_]{2,159}$/;
export function boundedOwnerTriageChild({issue,request,receiptUrl}={}) {
  const r=validateOwnerWorkRequest(request);
  if(!issue||Number(issue.number)!==r.issueNumber||issue.state!=='open'||issue.pull_request)
    throw Error('owner_triage_invalid_parent');
  const parentScope=String(issue.body||'').match(/^RESOURCE_SCOPE=([A-Z][A-Z0-9_]+)$/m)?.[1]||'';
  if(!SCOPE.test(parentScope))throw Error('owner_triage_invalid_scope');
  const expected='https://github.com/newsdayads/tigeriq-ai-lab/issues/'+r.issueNumber+'#issuecomment-';
  if(typeof receiptUrl!=='string'||!receiptUrl.startsWith(expected)||!/^https:\/\/github\.com\/newsdayads\/tigeriq-ai-lab\/issues\/\d+#issuecomment-\d+$/.test(receiptUrl))
    throw Error('owner_triage_invalid_receipt');
  const scope='TIGERIQ_OWNER_DIRECTIVE_TRIAGE_'+r.issueNumber;
  const title='[P1][OWNER REQUEST #'+r.issueNumber+'] Phân tích chỉ đạo '+r.requestId.slice(0,8);
  // No original request text is copied into the child issue. The parent
  // already contains the authenticated Owner receipt and is the source.
  const body=[
    'TIGERIQ_JOB_V1',
    'WORK_ORDER_LIFECYCLE=V2',
    'PROJECT_ID=tigeriq-platform',
    'WORKSTREAM_ID=work-center-owner-request-intake',
    'SOURCE=AUTHENTICATED_OWNER_WORK_CARD',
    'PARENT_ISSUE=#'+r.issueNumber,
    'OWNER_REQUEST_ID='+r.requestId,
    'OWNER_REQUEST_RECEIPT='+receiptUrl,
    'OWNER_DIRECT=true',
    'OWNER_POLICY=AUTO',
    'OWNER_HOLD=false',
    'OWNER_CONTROLLED=false',
    'PRIORITY=P1',
    'TIGERIQ_EXECUTABLE=true',
    'AUTO_QUEUE=INCLUDED',
    'CAPABILITY=reasoning',
    'EXECUTION_SURFACE=CORE_REASONING',
    'ASSIGNED_EXECUTOR=ELIGIBLE_ROLE_DYNAMIC',
    'MUTATION_OWNER=CORE_DYNAMIC_LEASE',
    'ONE_RESOURCE_SCOPE_ONE_WRITER=true',
    'RESOURCE_SCOPE='+scope,
    'CURRENT_STATE=READY_SOURCE_AUDIT',
    'CURRENT_STEP=R01 — Read the precise authenticated Owner receipt and check gates',
    'LAST_COMPLETED_STEP=NOT_STARTED',
    'NEXT_ACTION=Read the parent Owner request receipt; triage intent and propose authorized bounded actions through existing Core delegation. Read only in this job; do not claim implementation.',
    'BLOCKER=NONE',
    'STARTED_AT=NOT_STARTED',
    'FINISHED_AT=NOT_FINISHED',
    'ETA_STATUS=UNVERIFIED',
    'DONE=false',
    'SAME_FAILURE_RETRY_COUNT=0',
    'SAME_FAILURE_RETRY_MAX=2',
    'VERIFICATION_COUNT_CURRENT_HEAD=0',
    'VERIFICATION_MAX_PER_HEAD=2',
    'LAST_FAILURE_SIGNATURE=NONE',
    'RETRY_RESUME_TRIGGER=NEW_PARENT_RECEIPT_OR_NEW_AUTHORITY',
    'NO_DIRECT_MAIN=true',
    'NO_PAID_COST=true',
    'NO_CREDENTIAL_CHANGE=true',
    'NO_SECURITY_BOUNDARY_CHANGE=true',
    'NO_DESTRUCTIVE=true',
    'NO_PRODUCTION_RELEASE=true',
    'NO_CODE_CHANGE=true',
    'NO_PC01_SHELL=true',
    'NO_BROWSER_AUTH=true',
    'NO_RDC=true',
    'APP_CHROME_MUTATION=FORBIDDEN',
    '',
    '## STRUCTURED_PROGRESS_CHECKLIST',
    '- [ ] R01 — Read exact receipt, inspect parent/worker authority and all security gates',
    '- [ ] R02 — Produce a concrete evidence-backed safe plan and escalation only through existing Core manager',
    '',
    '## ACCEPTANCE',
    '- Native Core job with fresh lease and nonempty evidence; parent receipt is NOT completed by a child plan',
    '- No Github source merge or production action may be inferred from planning alone',
    '',
    '## STOP_CONDITIONS',
    '- Block if owner receipt or write authority cannot be verified; no paid fallback, credential changes or unauthorized mutation',
    '- One resource scope / one writer; do not steal a running Core lease or requeue unchanged failures',
  ].join('\n');
  return {title,body,scope,requestId:r.requestId,parentIssueNumber:r.issueNumber};
}

export function verifiedOwnerReceiptForChild(childBody,commentBody) {
  const child=String(childBody||''),receipt=String(commentBody||'');
  if(!/^SOURCE=AUTHENTICATED_OWNER_WORK_CARD$/m.test(child))throw Error('owner_triage_source_missing');
  const parent=Number(/^PARENT_ISSUE=#(\d+)$/m.exec(child)?.[1]||0);
  const id=/^OWNER_REQUEST_ID=([a-f0-9-]{36})$/mi.exec(child)?.[1]||'';
  const url=/^OWNER_REQUEST_RECEIPT=(https:\/\/github\.com\/newsdayads\/tigeriq-ai-lab\/issues\/\d+#issuecomment-\d+)$/m.exec(child)?.[1];
  if(!parent||!id||!url||!url.includes('/issues/'+parent+'#issuecomment-'))throw Error('owner_triage_child_receipt_invalid');
  const lines=receipt.split(/\r?\n/);
  if(lines[0]!=='TIGERIQ_OWNER_REQUEST_V1'
    ||!lines.includes('OWNER_REQUEST_ID='+id)
    ||!lines.includes('OWNER_REQUEST_ISSUE='+parent)
    ||!lines.includes('OWNER_REQUEST_STATUS=RECEIVED'))throw Error('owner_triage_receipt_not_correlated');
  const encoded=/^OWNER_REQUEST_MESSAGE_JSON=(.+)$/m.exec(receipt)?.[1];
  let message;try{message=JSON.parse(encoded||'')}catch{throw Error('owner_triage_receipt_json_invalid')}
  if(typeof message!=='string'||!message.trim()||message.length>3000)
    throw Error('owner_triage_receipt_message_invalid');
  return {parentIssueNumber:parent,requestId:id,message:message.trim(),receiptUrl:url};
}

export function ownerCoreTriageReceiptPlan(childBody,row={}) {
  const body=String(childBody||'');
  if(!/^SOURCE=AUTHENTICATED_OWNER_WORK_CARD$/m.test(body))return null;
  const parent=Number(/^PARENT_ISSUE=#(\d+)$/m.exec(body)?.[1]||0);
  const requestId=/^OWNER_REQUEST_ID=([a-f0-9-]{36})$/mi.exec(body)?.[1]||'';
  if(!parent||!requestId||!['completed','blocked'].includes(row?.status))return null;
  const jobId=String(row.id||'');
  if(!/^OBJ-GH-\d+/.test(jobId)||jobId.length>128)return null;
  const status=row.status==='completed'?'PLAN_SHOWN':'BLOCKED';
  const summary=String(row.summary||'').trim().slice(0,2000);
  const reply='CORE_TRIAGE_OBJECTIVE_ID='+jobId+' — '+(summary||'Chưa có đầu ra được xác minh')+
    ' — Đây chỉ là kết quả phân tích của Core; yêu cầu Owner chưa được nghiệm thu thực thi.';
  return {parentIssueNumber:parent,requestId,status,reply,objectiveId:jobId};
}
