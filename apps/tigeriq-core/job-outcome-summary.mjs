// Honest Core activity projection: terminal internal jobs are not feature acceptance.
const RESULT_MAX_STRING=600;
const RESULT_MAX_ITEMS=12;
const SENSITIVE_RESULT_KEY=/(?:secret|token|password|passwd|credential|authorization|cookie|session|api[_-]?key|private[_-]?key|env(?:ironment)?)/i;
const RAW_RESULT_KEY=/^(?:text|content|stdout|stderr|raw|rawText|raw_text|payload|body)$/i;
function redactResultString(value=''){
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi,'Bearer [REDACTED]')
    .replace(/((?:secret|token|password|passwd|credential|authorization|cookie|api[_-]?key|private[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,'$1[REDACTED]')
    .slice(0,RESULT_MAX_STRING);
}
function safeResultValue(value,depth=0){
  if(depth>4)return '[TRUNCATED_DEPTH]';
  if(value==null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return redactResultString(value);
  if(Array.isArray(value))return value.slice(0,RESULT_MAX_ITEMS).map(item=>safeResultValue(item,depth+1));
  if(typeof value!=='object')return redactResultString(value);
  const out={};let count=0;
  for(const [key,val] of Object.entries(value)){
    if(count>=RESULT_MAX_ITEMS)break;
    if(SENSITIVE_RESULT_KEY.test(key)||RAW_RESULT_KEY.test(key))continue;
    out[key]=safeResultValue(val,depth+1);count++;
  }
  return out;
}
export function projectCoreExecutionResult(result){
  if(!result||typeof result!=='object'||Array.isArray(result))return null;
  let parsed=null;
  if(typeof result.text==='string'&&result.text.length<=50000){
    try{parsed=JSON.parse(result.text)}catch{}
  }
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.schema!=='EXECUTION_RESULT_V1')return null;
  const safe=safeResultValue(parsed);
  const gate=result.executionGate&&typeof result.executionGate==='object'?{
    pass:result.executionGate.pass===true,
    code:redactResultString(result.executionGate.code||''),
    evidenceIds:Array.isArray(result.executionGate.evidenceIds)?result.executionGate.evidenceIds.slice(0,RESULT_MAX_ITEMS).map(redactResultString):[],
  }:null;
  return {schema:'TIGERIQ_CORE_EXECUTION_RESULT_SUMMARY_V1',executionResult:safe,executionGate:gate};
}
const INTERNAL_KINDS=new Set(['api_doctor','nv07_bootstrap','readonly','research']);
export function summarizeCoreJobEvidence(jobs=[]){
  const rows=Array.isArray(jobs)?jobs:[];
  const done=rows.filter(x=>x?.status==='done');
  const internalDone=done.filter(x=>INTERNAL_KINDS.has(String(x.kind||'')));
  const otherDone=done.length-internalDone.length;
  const types=Object.fromEntries([...new Set(rows.map(x=>String(x?.kind||'unknown')))].sort().map(kind=>[kind,rows.filter(x=>String(x?.kind||'unknown')===kind).length]));
  return {
    schema:'TIGERIQ_CORE_ACTIVITY_EVIDENCE_V1',
    sampleSize:rows.length,
    terminalDone:done.length,
    internalOperationDone:internalDone.length,
    otherDoneNotNecessarilyAccepted:otherDone,
    sampledKinds:types,
    verifiedProductAcceptance:null,
    acceptedProductProgressClaimAllowed:false,
    reason:'CORE_JOB_STATUS_IS_NOT_PRODUCT_ACCEPTANCE; requires canonical Work Order acceptance plus artifact/build/functional/runtime receipts'
  };
}
