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
