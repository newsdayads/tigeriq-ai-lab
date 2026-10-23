import { createHash } from 'node:crypto';

export const AUTONOMOUS_RCA_TAXONOMY=Object.freeze([
  'PROVIDER','AUTH','RATE_LIMIT','MODEL','CONFIG','SOURCE_CODE','RUNTIME',
  'ROUTING','QUEUE','DEPENDENCY','REVIEW','DEPLOYMENT','DATA','STALE_STATE'
]);

const CONTRACT_CLASS=Object.freeze({
  AUTO_DISPATCH_CONTINUITY:'QUEUE',
  REVIEW_INDEPENDENCE:'REVIEW',
  TERMINAL_LEASE_RELEASE:'STALE_STATE',
  DEGRADED_RESOURCE_ROUTING:'ROUTING',
  RUNTIME_SOURCE_SHA:'RUNTIME',
  DEPENDENCY_TERMINAL_GATE:'DEPENDENCY',
  SERVICE_FUNCTIONAL_INTEGRITY:'CONFIG',
  UPDATER_WATCHDOG_HEALTH:'DEPLOYMENT',
  MAIN_CI_GATE_HEALTH:'SOURCE_CODE',
});

const SAFE_SELF_FIX_CLASSES=new Set([
  'MODEL','CONFIG','SOURCE_CODE','RUNTIME','ROUTING','QUEUE','DEPENDENCY',
  'REVIEW','DEPLOYMENT','DATA','STALE_STATE'
]);

function text(value,max=1200){return String(value??'').replace(/[\r\n]+/g,' ').trim().slice(0,max);}
function compactJson(value,max=5000){
  try{return JSON.stringify(value??{}).slice(0,max);}catch{return '{}';}
}
function hash(value){return createHash('sha256').update(String(value)).digest('hex');}

function evidenceClass(evidence={}){
  const raw=compactJson(evidence,6000).toLowerCase();
  const kind=text(evidence.kind||evidence.failureClass||evidence.errorClass||'',120).toLowerCase();
  const status=Number(evidence.status||evidence.httpStatus||0);
  if(status===401||status===403||kind==='auth'||/\bauth(?:entication|orization)?\b|credential|token missing|reauth/.test(raw))return'AUTH';
  if(status===429||kind==='rate_limit'||/rate.?limit|quota|http[_ -]?429/.test(raw))return'RATE_LIMIT';
  if(kind==='model'||/model[_ -]?(?:missing|unsupported|not found)|model mismatch/.test(raw))return'MODEL';
  if(kind==='provider'||kind==='outage'||/provider[_ -]?(?:unavailable|outage)|upstream outage/.test(raw))return'PROVIDER';
  if(kind==='configuration'||kind==='config'||/configuration|config[_ -]?(?:invalid|missing)/.test(raw))return'CONFIG';
  if(kind==='data'||/schema mismatch|data corruption|invalid data/.test(raw))return'DATA';
  if(kind==='source_code'||/source[_ -]?code|syntax error|compile error/.test(raw))return'SOURCE_CODE';
  if(kind==='deployment'||/deploy(?:ment)?[_ -]?(?:failed|stale)/.test(raw))return'DEPLOYMENT';
  return'';
}

function hardGateReason(rcaClass,evidence={}){
  const raw=compactJson(evidence,6000).toLowerCase();
  if(rcaClass==='AUTH')return'AUTH_OR_CREDENTIAL';
  if(/\bpaid\b|billing|financial|purchase|subscription/.test(raw))return'PAID_OR_FINANCIAL';
  if(/security boundary|permission change|privilege|secret rotation/.test(raw))return'SECURITY_OR_PERMISSION';
  if(/production release|deploy production|publish production/.test(raw))return'PRODUCTION';
  if(/destructive|irreversible|delete data|drop table|factory reset/.test(raw))return'DESTRUCTIVE_OR_IRREVERSIBLE';
  return'';
}

function proposedFixFor(rcaClass){
  const map={
    PROVIDER:'Quarantine provider failure, preserve evidence, and wait/fail over within existing provider policy.',
    AUTH:'Request Owner-controlled credential or authentication resolution; do not mutate credentials automatically.',
    RATE_LIMIT:'Honor cooldown/backoff and reroute only to eligible zero-cost resources.',
    MODEL:'Repair bounded model identity/config mapping and retest capability.',
    CONFIG:'Repair the smallest configuration/source contract causing the verified functional mismatch.',
    SOURCE_CODE:'Patch only the evidenced source scope, run regression tests, and require independent review.',
    RUNTIME:'Reconcile runtime to the gated source revision and verify health plus functional acceptance.',
    ROUTING:'Repair deterministic routing eligibility/precedence and regression-test the failing route.',
    QUEUE:'Repair queue continuity/dedupe/lease state without creating a second scheduler.',
    DEPENDENCY:'Repair dependency gate evaluation and prevent premature terminal state.',
    REVIEW:'Repair reviewer independence/exact-head evidence flow without implementer self-review.',
    DEPLOYMENT:'Repair gated deployment/updater/watchdog flow and verify rollback-safe health.',
    DATA:'Repair bounded data/schema handling without destructive migration unless separately authorized.',
    STALE_STATE:'Reconcile stale lifecycle/lease state idempotently and regression-test restart/reopen behavior.',
  };
  return map[rcaClass]||'Investigate the verified evidence and produce the smallest reversible fix.';
}

function testsFor(rcaClass){
  const base=['reproduce verified failure','regression test current signature','independent review'];
  if(['RUNTIME','DEPLOYMENT'].includes(rcaClass))base.push('runtime health + functional canary');
  if(['QUEUE','ROUTING','DEPENDENCY','REVIEW','STALE_STATE'].includes(rcaClass))base.push('restart/idempotency guard');
  return base;
}

export function classifyAutonomousRca(anomaly={}){
  const anomalySignature=text(anomaly.signature||anomaly.anomaly_signature||'',160);
  if(!anomalySignature)throw new Error('RCA_ANOMALY_SIGNATURE_REQUIRED');
  const contractId=text(anomaly.contractId||anomaly.contract_id||'',120).toUpperCase();
  const evidence=anomaly.evidence&&typeof anomaly.evidence==='object'?anomaly.evidence:{};
  const inferred=evidenceClass(evidence);
  const rcaClass=inferred||CONTRACT_CLASS[contractId]||'SOURCE_CODE';
  if(!AUTONOMOUS_RCA_TAXONOMY.includes(rcaClass))throw new Error('RCA_CLASS_INVALID');
  const gateReason=hardGateReason(rcaClass,evidence);
  const selfFixable=!gateReason&&SAFE_SELF_FIX_CLASSES.has(rcaClass);
  const evidenceHash=hash(compactJson(evidence,12000));
  const rcaSignature=hash([anomalySignature,rcaClass].join('|'));
  const affectedScope=text(evidence.resourceScope||evidence.scope||evidence.component||contractId||'CORE',240);
  const rcaFamilyKey=hash([contractId,rcaClass,affectedScope].join('|'));
  const mapped=Boolean(CONTRACT_CLASS[contractId]||inferred);
  return {
    rcaSignature,
    rcaFamilyKey,
    anomalySignature,
    contractId,
    class:rcaClass,
    confidence:mapped?0.98:0.8,
    affectedScope,
    selfFixable,
    hardGate:Boolean(gateReason),
    hardGateReason:gateReason||null,
    proposedFix:proposedFixFor(rcaClass),
    tests:testsFor(rcaClass),
    risk:selfFixable?'LOW_TO_MEDIUM_REVERSIBLE':'OWNER_GATE_REQUIRED',
    evidence,
    evidenceHash,
    provenance:{source:'SELF_AUDIT',contractId,anomalySignature,evidenceHash},
  };
}

export function dedupeAutonomousRca(items=[]){
  const out=[],seen=new Set();
  for(const item of Array.isArray(items)?items:[]){
    const rca=item?.rcaSignature?item:classifyAutonomousRca(item);
    const dedupeKey=rca.rcaFamilyKey||rca.rcaSignature;
    if(seen.has(dedupeKey))continue;
    seen.add(dedupeKey);out.push(rca);
  }
  return out;
}

export function autonomousRcaCanonicalAction({mode,priorType,priorIssueState,priorStateReason}={}){
  const type=String(priorType||'').toUpperCase();
  const m=String(mode||'').toUpperCase();
  if(m!=='WORK_ORDER'||type!=='AUTONOMOUS_RCA_WORK_ORDER')return'NONE';
  const state=String(priorIssueState||'unknown').toLowerCase();
  const reason=String(priorStateReason||'unknown').toLowerCase();
  if(state==='closed'&&reason==='completed')return'REARM_CANONICAL';
  if(state==='closed')return'SUPPRESS_CLOSED';
  if(state==='open'||state==='reopened')return'DEDUPE_ACTIVE';
  return'DEDUPE_UNKNOWN';
}

export function autonomousRcaMaterializationDedupe(args={}){
  const type=String(args?.priorType||'').toUpperCase();
  const m=String(args?.mode||'').toUpperCase();
  if(!type)return false;
  if(m==='WORK_ORDER')return autonomousRcaCanonicalAction(args)!=='NONE';
  if(m==='OWNER_EXCEPTION')return type==='AUTONOMOUS_RCA_OWNER_EXCEPTION';
  if(m==='OBSERVE_ONLY')return type==='AUTONOMOUS_RCA_OBSERVE_ONLY';
  return false;
}

export function buildImprovementWorkOrder(rca={}){
  if(!rca?.rcaSignature||!rca?.selfFixable||rca?.hardGate)throw new Error('RCA_WORK_ORDER_NOT_SAFE');
  const severity=String(rca?.evidence?.severity||'').toUpperCase();
  const priority=['CRITICAL','HIGH'].includes(severity)?'P1':severity==='LOW'?'P3':'P2';
  const scope='AUTO_RCA_'+String(rca.class).replace(/[^A-Z0-9_]/g,'_')+'_'+rca.rcaSignature.slice(0,12);
  const title=`[${priority}][AUTO-RCA][${rca.class}] Repair ${rca.contractId||rca.affectedScope}`;
  const body=[
    '## ACTIVE WORK ORDER — AUTO-RCA P1–P3, V2 SOURCE CONTRACT',
    'TIGERIQ_JOB_V1', // Keep legacy marker inside the active header, not before it.
    'WORK_ORDER_LIFECYCLE=V2',
    'PROJECT_ID=tigeriq-platform',
    'WORKSTREAM_ID=autonomous-rca',
    'OWNER_POLICY=AUTO',
    'MUTATION_OWNER=CORE_DYNAMIC_LEASE',
    'CURRENT_STEP=R00 — Đối chiếu nguyên nhân được tự kiểm tra phát hiện',
    'LAST_COMPLETED_STEP=NOT_VERIFIED',
    'NEXT_ACTION=Nhận việc qua khóa sở hữu duy nhất rồi kiểm thử và sửa theo bằng chứng, không bỏ qua cổng an toàn',
    'BLOCKER=NONE_FOR_SOURCE_ONLY_STAGE',
    'ETA_STATUS=UNVERIFIED',
    'STARTED_AT=NOT_STARTED',
    'FINISHED_AT=NOT_FINISHED',
    'SAME_FAILURE_RETRY_COUNT=0',
    'SAME_FAILURE_RETRY_MAX=2',
    'VERIFICATION_COUNT_CURRENT_HEAD=0',
    'VERIFICATION_MAX_PER_HEAD=2',
    'LAST_FAILURE_SIGNATURE=NONE',
    'RETRY_RESUME_TRIGGER=NEW_REVISION_OR_NEW_EVIDENCE_OR_DEPENDENCY_CHANGE',
    'ACTIVE_EXECUTION=false',
    `SOURCE=SELF_AUDIT:${rca.anomalySignature}`,
    rca.contractId==='MAIN_CI_GATE_HEALTH'
      ?'PARENT=#5144 - Core tự hỏi và sửa lỗi CI liên tục'
      :'PARENT=#2708 - Tự phân tích nguyên nhân và sinh Improvement Work Order',
    `PRIORITY=${priority}`,
    // The execution router accepts one capability per assignment. The RCA
    // lifecycle still sequences analysis, coding and independent QA, but
    // a combined CAPABILITY string has no matching AI resource.
    'CAPABILITY=coding',
    'EXECUTION_SURFACE=CODING',
    `RESOURCE_SCOPE=${scope}`,
    'ZERO_COST=true',
    'NO_DIRECT_MAIN=true',
    'NO_PRODUCTION_RELEASE=true',
    'NO_PAID_COST=true',
    'NO_CREDENTIAL_CHANGE=true',
    'NO_SECURITY_BOUNDARY_CHANGE=true',
    'NO_DESTRUCTIVE=true',
    'APP_CHROME_MUTATION=FORBIDDEN',
    'ONE_RESOURCE_SCOPE_ONE_WRITER=true',
    'SELF_UPGRADE_CANDIDATE=true',
    'TIGERIQ_EXECUTABLE=true',
    'AUTO_QUEUE=INCLUDED',
    'CURRENT_STATE=READY_AUTONOMOUS_REPAIR',
    `RCA_SIGNATURE=${rca.rcaSignature}`,
    `RCA_FAMILY_KEY=${rca.rcaFamilyKey}`,
    `RCA_CLASS=${rca.class}`,
    `RCA_CONFIDENCE=${rca.confidence}`,
    `AFFECTED_SCOPE=${rca.affectedScope}`,
    `EVIDENCE_HASH=${rca.evidenceHash}`,
    `PROPOSED_FIX=${rca.proposedFix}`,
    ...(rca.contractId==='MAIN_CI_GATE_HEALTH'?[
      `CI_SOURCE_SHA=${String(rca.evidence?.sourceSha||'').slice(0,40)}`,
      `CI_FAILURE_STATE=${String(rca.evidence?.observedState||'').slice(0,30)}`,
      'NEXT_REPAIR_ACTION=Read exact main commit CI failed check and job logs; reproduce; change only safe source via branch PR; retest exact-head checks and main push CI; verify PC01 gated release with real receipts',
      'CI_CHECK_RUNS='+JSON.stringify(rca.evidence?.checks||[]).slice(0,1200),
    ]:[]),
    `ACCEPTANCE=Verified RCA signature ${rca.rcaSignature}; required tests pass; independent exact-head review approves; applicable runtime/live canary passes`,
    `REQUIRED_TESTS=${rca.tests.join('|')}`,
    `RISK=${rca.risk}`,
    `PROVENANCE=${rca.provenance.source}|${rca.provenance.contractId}|${rca.provenance.anomalySignature}`,
    'DONE=false',
    'STATE=READY_P1_P5_AUTONOMOUS_REPAIR',
    '',
    '## STRUCTURED_PROGRESS_CHECKLIST',
    '- [ ] R00 — Kiểm chứng lỗi thật, xác định phạm vi và không nhận trùng.',
    '- [ ] R01 — Sửa trên nhánh riêng trong phạm vi không phát sinh chi phí.',
    '- [ ] R02 — Kiểm thử, kiểm tra chính xác bản mã và rà soát độc lập.',
    '- [ ] R03 — Nghiệm thu chạy thực tế, lưu bằng chứng rồi mới kết thúc.',
    '',
    '## ACCEPTANCE',
    `- Phải xác minh chữ ký lỗi ${rca.rcaSignature} và có bằng chứng kiểm thử, rà soát, nghiệm thu thật.`,
    '- Metadata không đồng nghĩa có nhân sự đã nhận hoặc đủ điều kiện kết thúc.',
    '',
    '## STOP_CONDITIONS',
    '- Ngừng đúng bước đòi chi phí, thông tin xác thực, quyền bảo mật, thay đổi không thể hoàn tác hoặc triển khai chính thức chưa được cho phép.',
  ].join('\n');
  return{title,body,priority,resourceScope:scope};
}

export function buildOwnerException(rca={}){
  if(!rca?.rcaSignature||!rca?.hardGate)throw new Error('RCA_OWNER_EXCEPTION_NOT_REQUIRED');
  return{
    type:'OWNER_EXCEPTION',
    rcaSignature:rca.rcaSignature,
    rcaFamilyKey:rca.rcaFamilyKey,
    anomalySignature:rca.anomalySignature,
    class:rca.class,
    reason:rca.hardGateReason||'OWNER_GATE_REQUIRED',
    affectedScope:rca.affectedScope,
    evidenceHash:rca.evidenceHash,
    proposedFix:rca.proposedFix,
  };
}

export function syntheticAutonomousRcaCanary(){
  const fixtures=[
    {signature:'canary-queue',contractId:'AUTO_DISPATCH_CONTINUITY',evidence:{eligibleBacklogCount:2,eligibleIdleWorkers:1}},
    {signature:'canary-review',contractId:'REVIEW_INDEPENDENCE',evidence:{reviewerEmployeeId:'NV12',implementerEmployeeIds:['NV12']}},
    {signature:'canary-runtime',contractId:'RUNTIME_SOURCE_SHA',evidence:{expectedSha:'good',installedSha:'stale'}},
    {signature:'canary-rate',contractId:'SERVICE_FUNCTIONAL_INTEGRITY',evidence:{kind:'rate_limit',status:429,provider:'gemini'}},
    {signature:'canary-auth',contractId:'SERVICE_FUNCTIONAL_INTEGRITY',evidence:{kind:'auth',status:401,provider:'watsonx'}},
  ];
  const rcas=dedupeAutonomousRca([...fixtures,fixtures[0]]);
  const bySig=new Map(rcas.map(x=>[x.anomalySignature,x]));
  const safe=buildImprovementWorkOrder(bySig.get('canary-queue'));
  const owner=buildOwnerException(bySig.get('canary-auth'));
  const expected=[
    ['canary-queue','QUEUE'],['canary-review','REVIEW'],['canary-runtime','RUNTIME'],
    ['canary-rate','RATE_LIMIT'],['canary-auth','AUTH'],
  ];
  const pass=rcas.length===5
    &&expected.every(([sig,cls])=>bySig.get(sig)?.class===cls)
    &&safe.body.includes('SELF_UPGRADE_CANDIDATE=true')
    &&safe.body.includes('NO_DIRECT_MAIN=true')
    &&owner.type==='OWNER_EXCEPTION'
    &&owner.reason==='AUTH_OR_CREDENTIAL';
  return{
    ok:pass,pass,fixtureCount:fixtures.length,dedupedCount:rcas.length,
    taxonomy:rcas.map(x=>({anomalySignature:x.anomalySignature,class:x.class,selfFixable:x.selfFixable,hardGate:x.hardGate})),
    safeAction:{type:'IMPROVEMENT_WORK_ORDER',title:safe.title,resourceScope:safe.resourceScope},
    hardGateAction:owner,
    mutation:false,
  };
}
