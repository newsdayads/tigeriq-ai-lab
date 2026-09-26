export const SUPPORTED_PUBLIC_EVIDENCE_KEYS=Object.freeze([
  'installedSha','result','remoteDesktopGuard','changedPaths','updaterTaskTarget'
]);

const SUPPORTED=new Set(SUPPORTED_PUBLIC_EVIDENCE_KEYS);
const SENSITIVE_KEY_RE=/(?:^|[_-])(token|secret|password|passwd|credential|authorization|cookie|private[_-]?key|api[_-]?key|access[_-]?key|refresh[_-]?key)(?:$|[_-])/i;
const SENSITIVE_VALUE_PATTERNS=[
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi,
  /\bgithub_pat_[A-Za-z0-9_]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{12,}/g,
  /\bsk-[A-Za-z0-9_-]{12,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

function redactString(value,maxString=800){
  let out=String(value??'');
  for(const pattern of SENSITIVE_VALUE_PATTERNS)out=out.replace(pattern,'[REDACTED]');
  if(out.length>maxString)out=out.slice(0,maxString)+'…';
  return out;
}

export function parsePublicEvidenceKeys(body=''){
  const raw=String(body||'').match(/^PUBLIC_EVIDENCE_KEYS=(.+)$/mi)?.[1]||'';
  const out=[];
  for(const token of raw.split(',').map(x=>x.trim()).filter(Boolean)){
    if(SUPPORTED.has(token)&&!out.includes(token))out.push(token);
  }
  return out;
}

function maybeJson(value){
  if(typeof value!=='string')return null;
  const text=value.trim();
  if(text.length<2||text.length>12000||!((text.startsWith('{')&&text.endsWith('}'))||(text.startsWith('[')&&text.endsWith(']'))))return null;
  try{return JSON.parse(text);}catch{return null;}
}

function collectObjects(value,{depth=0,maxDepth=6,seen=new Set(),out=[]}={}){
  if(depth>maxDepth||value===null||value===undefined)return out;
  if(typeof value==='string'){
    const parsed=maybeJson(value);
    if(parsed!==null)collectObjects(parsed,{depth:depth+1,maxDepth,seen,out});
    return out;
  }
  if(typeof value!=='object'||seen.has(value))return out;
  seen.add(value);
  if(!Array.isArray(value))out.push({value,depth});
  const children=Array.isArray(value)?value:Object.values(value);
  for(const child of children)collectObjects(child,{depth:depth+1,maxDepth,seen,out});
  return out;
}

export function findPublicEvidenceObject(jobResult,requestedKeys=[]){
  const requested=(Array.isArray(requestedKeys)?requestedKeys:[]).filter(k=>SUPPORTED.has(k));
  if(!requested.length)return null;
  const root=jobResult?.evidence?.agentResult?.evidence
    ??jobResult?.evidence?.agentResult
    ??jobResult?.evidence
    ??jobResult;
  const objects=collectObjects(root);
  let best=null;
  for(const entry of objects){
    const direct=requested.filter(k=>Object.prototype.hasOwnProperty.call(entry.value,k));
    if(!direct.length)continue;
    const score=direct.length*100+entry.depth;
    if(!best||score>best.score)best={...entry,score,direct};
  }
  return best?.value||null;
}

export function sanitizePublicEvidenceValue(value,{depth=0,maxDepth=4,maxString=800,maxArray=20,maxKeys=30}={}){
  if(depth>maxDepth)return '[TRUNCATED_DEPTH]';
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return redactString(value,maxString);
  if(Array.isArray(value))return value.slice(0,maxArray).map(v=>sanitizePublicEvidenceValue(v,{depth:depth+1,maxDepth,maxString,maxArray,maxKeys}));
  if(typeof value==='object'){
    const out={};
    for(const key of Object.keys(value).slice(0,maxKeys)){
      if(SENSITIVE_KEY_RE.test(key)){out[key]='[REDACTED]';continue;}
      out[key]=sanitizePublicEvidenceValue(value[key],{depth:depth+1,maxDepth,maxString,maxArray,maxKeys});
    }
    return out;
  }
  return redactString(value,maxString);
}

export function buildPublicEvidence(jobResult,requestedKeys=[]){
  const requested=(Array.isArray(requestedKeys)?requestedKeys:[]).filter(k=>SUPPORTED.has(k));
  if(!requested.length)return null;
  const source=findPublicEvidenceObject(jobResult,requested);
  if(!source)return null;
  const fields={};
  for(const key of requested){
    if(Object.prototype.hasOwnProperty.call(source,key))fields[key]=sanitizePublicEvidenceValue(source[key]);
  }
  return Object.keys(fields).length?{schema:'TIGERIQ_PUBLIC_EVIDENCE_V1',fields}:null;
}

export function formatPublicEvidenceLine(jobResult,requestedKeys=[]){
  const evidence=buildPublicEvidence(jobResult,requestedKeys);
  if(!evidence)return '';
  let encoded=JSON.stringify(evidence);
  if(encoded.length>3500)encoded=JSON.stringify({schema:evidence.schema,fields:{result:'[TRUNCATED_PUBLIC_EVIDENCE]'}});
  return `PUBLIC_EVIDENCE_V1=${encoded}`;
}
