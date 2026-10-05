const SUPPORTED_PUBLIC_EVIDENCE_KEYS=Object.freeze([
  'installedSha',
  'result',
  'remoteDesktopGuard',
  'changedPaths',
  'updaterTaskTarget',
  'taskNames',
  'releaseTaskNames',
  'status',
  'version',
  'employeeId',
  'online',
  'lastSeenAt',
  'expected',
  'taskCount',
  'completed',
  'failed',
  'queued',
  'leased',
  'pending',
  'invalid',
  'attemptCount',
  'pass',
  'sendCount',
  'duplicateSendCount',
  'recoveryCount',
  'created',
  'existing',
  'count',
  'apkSha256',
  'unsignedApkSha256',
  'certificateSha256',
  'sourceSha',
  'sourceWorkflowRunId',
  'sourceArtifactId',
  'signingIdentity',
  'passwordTransport',
  'apksignerMode',
  'prealignedInput',
  'secretsPrinted',
  'executionIdentity',
  'taskName',
  'taskPrincipal',
  'taskLogonType',
  'taskRunLevel',
  'taskDeleted',
  'lastScanAt',
  'postRepairValidations24h',
  'actions',
  'degradedProviders',
  'totalBytes',
  'chunkIndex',
  'chunkCount',
  'chunkBytes',
  'chunkSha256',
  'chunkBase64',
]);

const SUPPORTED_SET=new Set(SUPPORTED_PUBLIC_EVIDENCE_KEYS);
const GATE_C_V021_PUBLIC_EVIDENCE_KEYS=new Set([
  'status','version','employeeId','online','lastSeenAt','expected','taskCount','completed','failed','queued','leased','pending','invalid','attemptCount','pass',
  'sendCount','duplicateSendCount','recoveryCount','created','existing','count',
]);
const GATE_C_V021_ACTIONS=new Set([
  'android_worker_gate_c_v021_status',
  'android_worker_gate_c_v021_enqueue_10',
]);
const SENSITIVE_KEY_RE=/(?:secret|token|password|passwd|credential|authorization|cookie|session|api[_-]?key|private[_-]?key|env(?:ironment)?)/i;
const RAW_OUTPUT_KEY_RE=/^(?:content|contentSnippet|content_snippet|text|stdout|stderr|raw|rawText|raw_text|payload|body)$/i;
const blockedPublicKey=(key)=>SENSITIVE_KEY_RE.test(String(key))||RAW_OUTPUT_KEY_RE.test(String(key));
const MAX_DEPTH=4;
const MAX_ARRAY=16;
const MAX_OBJECT_KEYS=24;
const MAX_STRING=400;
const MAX_BLOCK_CHARS=1800;
const MAX_EXPORT_CHUNK_BASE64_CHARS=16000;
const MAX_EXPORT_BLOCK_CHARS=17500;

export {SUPPORTED_PUBLIC_EVIDENCE_KEYS};

export function parsePublicEvidenceKeys(body=''){
  const raw=String(body||'').match(/^PUBLIC_EVIDENCE_KEYS=(.+)$/mi)?.[1];
  if(raw==null)return [];
  const out=[];const seen=new Set();
  for(const token of raw.split(',')){
    const key=token.trim();
    if(!SUPPORTED_SET.has(key)||seen.has(key))continue;
    seen.add(key);out.push(key);
  }
  return out;
}

function sanitizeScalar(value){
  if(value==null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return value.slice(0,MAX_STRING);
  return String(value).slice(0,MAX_STRING);
}

function sanitizePublicEvidenceForKey(key,value){
  if(key==='chunkBase64'){
    if(typeof value!=='string'||value.length>MAX_EXPORT_CHUNK_BASE64_CHARS||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))return '[INVALID_CHUNK_BASE64]';
    return value;
  }
  return sanitizePublicEvidenceValue(value);
}

export function sanitizePublicEvidenceValue(value,depth=0){
  if(depth>=MAX_DEPTH)return '[TRUNCATED_DEPTH]';
  if(value==null||typeof value!=='object')return sanitizeScalar(value);
  if(Array.isArray(value))return value.slice(0,MAX_ARRAY).map(item=>sanitizePublicEvidenceValue(item,depth+1));
  const out={};let count=0;
  for(const [key,val] of Object.entries(value)){
    if(count>=MAX_OBJECT_KEYS)break;
    if(blockedPublicKey(key))continue;
    out[key]=sanitizePublicEvidenceValue(val,depth+1);
    count++;
  }
  return out;
}

function findRequestedValue(node,target,depth=0,seen=new Set()){
  if(depth>MAX_DEPTH||node==null||typeof node!=='object'||seen.has(node))return undefined;
  seen.add(node);
  if(!Array.isArray(node)&&Object.prototype.hasOwnProperty.call(node,target))return node[target];
  const entries=Array.isArray(node)?node.entries():Object.entries(node);
  for(const [key,val] of entries){
    if(!Array.isArray(node)&&blockedPublicKey(key))continue;
    const found=findRequestedValue(val,target,depth+1,seen);
    if(found!==undefined)return found;
  }
  return undefined;
}

function parseTrustedFileReadJsonReceipt(node){
  if(!node||typeof node!=='object'||Array.isArray(node))return null;
  if(node.ok!==true||String(node.action||'').toLowerCase()!=='file_read'||String(node.target||'').toLowerCase()!=='pc01-local')return null;
  const data=node.data;
  const content=typeof data?.content==='string'?data.content:'';
  if(!content||content.length>256*1024)return null;
  try{
    const parsed=JSON.parse(content);
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;
  }catch{return null;}
}

function collectTrustedFileReadJsonSources(node,depth=0,seen=new Set(),out=[]){
  if(depth>8||node==null||typeof node!=='object'||seen.has(node))return out;
  seen.add(node);
  const parsed=parseTrustedFileReadJsonReceipt(node);
  if(parsed)out.push(parsed);
  const values=Array.isArray(node)?node:Object.values(node);
  for(const value of values)collectTrustedFileReadJsonSources(value,depth+1,seen,out);
  return out;
}

function hasGateCV021BridgeAction(bridgeCalls){
  const calls=Array.isArray(bridgeCalls)?bridgeCalls:[bridgeCalls];
  return calls.some(call=>GATE_C_V021_ACTIONS.has(String(call?.result?.action||'')));
}

function trustedGateCV021ReceiptSources(bridgeCalls){
  const calls=Array.isArray(bridgeCalls)?bridgeCalls:[bridgeCalls];
  for(let index=calls.length-1;index>=0;index--){
    const call=calls[index];
    const result=call?.result;
    const evidence=result?.evidence;
    if(String(call?.tool||'')!=='tigeriq_pc')continue;
    if(!result||typeof result!=='object'||Array.isArray(result))continue;
    if(result.ok!==true||String(result.target||'').toLowerCase()!=='pc01-local')continue;
    if(!GATE_C_V021_ACTIONS.has(String(result.action||'')))continue;
    if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))continue;
    if(String(evidence.transport||'')!=='local-process'||evidence.androidGateCV021!==true)continue;
    if(evidence.shell!==false||evidence.inheritedSecretEnvironment!==false)continue;
    if(result.data&&typeof result.data==='object'&&!Array.isArray(result.data))return [result.data];
  }
  return [];
}

function structuredBridgeEvidenceSources(bridgeCalls){
  const calls=Array.isArray(bridgeCalls)?bridgeCalls:[bridgeCalls];
  const sources=[];
  for(const call of calls){
    if(!call||typeof call!=='object')continue;
    const result=call.result;
    if(result&&typeof result==='object'){
      const trustedPcReceipt=result.ok===true
        && String(result.target||'').toLowerCase()==='pc01-local'
        && String(result.action||'').startsWith('paperclip_lab_')
        && result.data&&typeof result.data==='object'&&!Array.isArray(result.data);
      if(trustedPcReceipt)sources.push({result:result.data});
      if(result.data&&typeof result.data==='object')sources.push(result.data);
      else if(result.evidence&&typeof result.evidence==='object')sources.push(result.evidence);
      else sources.push(result);
    }else if(call.data&&typeof call.data==='object')sources.push(call.data);
    else if(call.evidence&&typeof call.evidence==='object')sources.push(call.evidence);
  }
  return [...sources,...collectTrustedFileReadJsonSources(bridgeCalls)];
}

export function extractPublicEvidence(jobResult,requestedKeys=[]){
  const requested=[...new Set((requestedKeys||[]).filter(key=>SUPPORTED_SET.has(String(key))).map(String))];
  if(!requested.length)return {};
  const primary=jobResult?.evidence?.agentResult?.evidence;
  const bridgeCalls=jobResult?.evidence?.bridgeCalls;
  const trustedGateCV021Sources=trustedGateCV021ReceiptSources(bridgeCalls);
  const gateCV021Request=hasGateCV021BridgeAction(bridgeCalls);
  const fallbackSources=[
    ...(primary&&typeof primary==='object'?[primary]:[]),
    ...structuredBridgeEvidenceSources(bridgeCalls),
  ];
  if(!fallbackSources.length&&!trustedGateCV021Sources.length)return {};
  const out={};
  for(const key of requested){
    let raw;
    const sources=gateCV021Request&&GATE_C_V021_PUBLIC_EVIDENCE_KEYS.has(key)
      ? trustedGateCV021Sources
      : fallbackSources;
    for(const source of sources){
      raw=findRequestedValue(source,key);
      if(raw!==undefined)break;
    }
    if(raw===undefined)continue;
    out[key]=sanitizePublicEvidenceForKey(key,raw);
  }
  return out;
}

export function buildPublicJobEvidenceRecord(row={}){
  const metadata=row?.objective_metadata&&typeof row.objective_metadata==='object'&&!Array.isArray(row.objective_metadata)?row.objective_metadata:{};
  const requested=Array.isArray(metadata.publicEvidenceKeys)?metadata.publicEvidenceKeys:[];
  const evidence=extractPublicEvidence(row?.result,requested);
  const out={
    ok:true,
    jobId:String(row?.id||''),
    objectiveId:row?.objective_id==null?null:String(row.objective_id),
    status:String(row?.status||''),
    requestedKeys:[...new Set(requested.filter(key=>SUPPORTED_SET.has(String(key))).map(String))],
    evidence,
  };
  if(metadata.publicEvidenceDiagnostic===true&&out.requestedKeys.length&&!Object.keys(evidence).length){
    out.diagnostic=buildPublicEvidenceDiagnostic(row?.result,out.requestedKeys,{
      metadataPublicEvidenceKeysPresent:true,
      metadataPublicEvidenceKeyCount:out.requestedKeys.length,
    });
  }
  return out;
}

export function formatPublicEvidenceBlock(evidence={}){
  const safe={};
  for(const key of SUPPORTED_PUBLIC_EVIDENCE_KEYS){
    if(!Object.prototype.hasOwnProperty.call(evidence,key))continue;
    safe[key]=sanitizePublicEvidenceForKey(key,evidence[key]);
  }
  const keys=Object.keys(safe);
  if(!keys.length)return '';
  const maxBlockChars=Object.prototype.hasOwnProperty.call(safe,'chunkBase64')?MAX_EXPORT_BLOCK_CHARS:MAX_BLOCK_CHARS;
  let json=JSON.stringify(safe);
  if(json.length>maxBlockChars){
    const bounded={};
    for(const key of keys){
      const value=safe[key];
      const candidate={...bounded,[key]:value};
      if(JSON.stringify(candidate).length>maxBlockChars)break;
      bounded[key]=value;
    }
    json=JSON.stringify(bounded);
    if(json==='{}')return '';
  }
  return `PUBLIC_EVIDENCE_JSON=${json}`;
}

function diagnosticValueType(value){
  if(value===null||value===undefined)return 'null';
  if(Array.isArray(value))return 'array';
  if(typeof value==='object')return 'object';
  return 'scalar';
}

function diagnosticKeys(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return [];
  return Object.keys(value).filter(key=>!blockedPublicKey(key)).slice(0,MAX_OBJECT_KEYS);
}

function trustedFileReadDiagnostic(node,depth=0,seen=new Set(),state={present:false,parseable:false}){
  if(depth>8||node==null||typeof node!=='object'||seen.has(node))return state;
  seen.add(node);
  if(!Array.isArray(node)&&node.ok===true&&String(node.action||'').toLowerCase()==='file_read'&&String(node.target||'').toLowerCase()==='pc01-local'){
    const content=typeof node.data?.content==='string'?node.data.content:'';
    if(content){
      state.present=true;
      if(content.length<=256*1024){
        try{
          const parsed=JSON.parse(content);
          if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))state.parseable=true;
        }catch{}
      }
    }
  }
  const values=Array.isArray(node)?node:Object.entries(node).filter(([key])=>!blockedPublicKey(key)).map(([,value])=>value);
  for(const value of values)trustedFileReadDiagnostic(value,depth+1,seen,state);
  return state;
}

export function buildPublicEvidenceDiagnostic(jobResult,requestedKeys=[],options={}){
  const requested=[...new Set((requestedKeys||[]).filter(key=>SUPPORTED_SET.has(String(key))).map(String))];
  const extracted=extractPublicEvidence(jobResult,requested);
  const evidence=jobResult?.evidence;
  const agentResult=evidence?.agentResult;
  const agentEvidence=agentResult?.evidence;
  const bridgeCalls=evidence?.bridgeCalls;
  const trusted=trustedFileReadDiagnostic(bridgeCalls);
  const metadataPresent=Boolean(options?.metadataPublicEvidenceKeysPresent);
  const metadataCount=metadataPresent?Math.max(0,Number(options?.metadataPublicEvidenceKeyCount)||0):0;
  return {
    requestedKeys:requested,
    metadataPublicEvidenceKeysPresent:metadataPresent,
    metadataPublicEvidenceKeyCount:metadataCount,
    jobResultType:diagnosticValueType(jobResult),
    jobResultKeys:diagnosticKeys(jobResult),
    evidenceType:diagnosticValueType(evidence),
    evidenceKeys:diagnosticKeys(evidence),
    agentResultType:diagnosticValueType(agentResult),
    agentResultKeys:diagnosticKeys(agentResult),
    agentEvidenceType:diagnosticValueType(agentEvidence),
    agentEvidenceKeys:diagnosticKeys(agentEvidence),
    bridgeCallsType:diagnosticValueType(bridgeCalls),
    bridgeCallsCount:Array.isArray(bridgeCalls)?bridgeCalls.length:(bridgeCalls&&typeof bridgeCalls==='object'?1:0),
    trustedFileReadReceiptPresent:trusted.present,
    trustedFileReadJsonParseable:trusted.parseable,
    extractedKeys:Object.keys(extracted).filter(key=>SUPPORTED_SET.has(key)),
  };
}

export function formatPublicEvidenceDiagnosticBlock(diagnostic={}){
  return `PUBLIC_EVIDENCE_DIAGNOSTIC_JSON=${JSON.stringify(diagnostic)}`;
}

export function appendPublicEvidenceToSummary(baseSummary,jobResult,requestedKeys=[],options={}){
  const base=String(baseSummary||'').slice(0,3000);
  const evidence=extractPublicEvidence(jobResult,requestedKeys);
  const block=formatPublicEvidenceBlock(evidence);
  if(block)return `${base}\n${block}`;
  if(options?.diagnostic!==true||!(requestedKeys||[]).length)return base;
  const diagnostic=buildPublicEvidenceDiagnostic(jobResult,requestedKeys,options);
  return `${base}\n${formatPublicEvidenceDiagnosticBlock(diagnostic)}`;
}
