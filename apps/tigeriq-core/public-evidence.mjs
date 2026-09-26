const SUPPORTED_PUBLIC_EVIDENCE_KEYS=Object.freeze([
  'installedSha',
  'result',
  'remoteDesktopGuard',
  'changedPaths',
  'updaterTaskTarget',
]);

const SUPPORTED_SET=new Set(SUPPORTED_PUBLIC_EVIDENCE_KEYS);
const SENSITIVE_KEY_RE=/(?:secret|token|password|passwd|credential|authorization|cookie|session|api[_-]?key|private[_-]?key|env(?:ironment)?)/i;
const MAX_DEPTH=4;
const MAX_ARRAY=16;
const MAX_OBJECT_KEYS=24;
const MAX_STRING=400;
const MAX_BLOCK_CHARS=1800;

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

export function sanitizePublicEvidenceValue(value,depth=0){
  if(depth>=MAX_DEPTH)return '[TRUNCATED_DEPTH]';
  if(value==null||typeof value!=='object')return sanitizeScalar(value);
  if(Array.isArray(value))return value.slice(0,MAX_ARRAY).map(item=>sanitizePublicEvidenceValue(item,depth+1));
  const out={};let count=0;
  for(const [key,val] of Object.entries(value)){
    if(count>=MAX_OBJECT_KEYS)break;
    if(SENSITIVE_KEY_RE.test(key))continue;
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
    if(!Array.isArray(node)&&SENSITIVE_KEY_RE.test(String(key)))continue;
    const found=findRequestedValue(val,target,depth+1,seen);
    if(found!==undefined)return found;
  }
  return undefined;
}

export function extractPublicEvidence(jobResult,requestedKeys=[]){
  const requested=[...new Set((requestedKeys||[]).filter(key=>SUPPORTED_SET.has(String(key))).map(String))];
  if(!requested.length)return {};
  const source=jobResult?.evidence?.agentResult?.evidence;
  if(source==null||typeof source!=='object')return {};
  const out={};
  for(const key of requested){
    const raw=findRequestedValue(source,key);
    if(raw===undefined)continue;
    out[key]=sanitizePublicEvidenceValue(raw);
  }
  return out;
}

export function formatPublicEvidenceBlock(evidence={}){
  const safe={};
  for(const key of SUPPORTED_PUBLIC_EVIDENCE_KEYS){
    if(!Object.prototype.hasOwnProperty.call(evidence,key))continue;
    safe[key]=sanitizePublicEvidenceValue(evidence[key]);
  }
  const keys=Object.keys(safe);
  if(!keys.length)return '';
  let json=JSON.stringify(safe);
  if(json.length>MAX_BLOCK_CHARS){
    const bounded={};
    for(const key of keys){
      const value=safe[key];
      const candidate={...bounded,[key]:value};
      if(JSON.stringify(candidate).length>MAX_BLOCK_CHARS)break;
      bounded[key]=value;
    }
    json=JSON.stringify(bounded);
    if(json==='{}')return '';
  }
  return `PUBLIC_EVIDENCE_JSON=${json}`;
}

export function appendPublicEvidenceToSummary(baseSummary,jobResult,requestedKeys=[]){
  const base=String(baseSummary||'').slice(0,3000);
  const block=formatPublicEvidenceBlock(extractPublicEvidence(jobResult,requestedKeys));
  return block?`${base}\n${block}`:base;
}
