export const PUBLIC_EVIDENCE_KEYS=Object.freeze([
  'installedSha',
  'result',
  'remoteDesktopGuard',
  'changedPaths',
  'updaterTaskTarget',
]);

const SUPPORTED=new Set(PUBLIC_EVIDENCE_KEYS);
const SENSITIVE_KEY_RE=/(?:secret|token|password|passwd|credential|authorization|api[_-]?key|private[_-]?key|cookie|session|environment|env)/i;
const SENSITIVE_VALUE_RE=/(?:bearer\s+[A-Za-z0-9._-]{12,}|\bgh[pousr]_[A-Za-z0-9_]{16,}|(?:api[_-]?key|token|password|passwd|secret|credential)\s*[:=]\s*\S+)/i;

export function parsePublicEvidenceKeys(body){
  const match=String(body||'').match(/^PUBLIC_EVIDENCE_KEYS=(.*)$/mi);
  if(!match)return {present:false,keys:[],invalid:[]};
  const tokens=String(match[1]||'').split(',').map(x=>x.trim()).filter(Boolean);
  const keys=[]; const invalid=[]; const seen=new Set();
  for(const token of tokens){
    if(!SUPPORTED.has(token)){invalid.push(token);continue;}
    if(!seen.has(token)){seen.add(token);keys.push(token);}
  }
  return {present:true,keys,invalid};
}

function safeString(value,max=240){
  const text=String(value??'');
  if(SENSITIVE_VALUE_RE.test(text))return '[REDACTED]';
  return text.length<=max?text:text.slice(0,max)+'...[TRUNCATED]';
}

export function sanitizePublicEvidenceValue(value,depth=0){
  if(value==null||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='string')return safeString(value,240);
  if(depth>=3)return '[MAX_DEPTH]';
  if(Array.isArray(value))return value.slice(0,12).map(v=>sanitizePublicEvidenceValue(v,depth+1));
  if(typeof value==='object'){
    const out={}; let count=0;
    for(const [key,val] of Object.entries(value)){
      if(count>=16){out.__truncated__=true;break;}
      count++;
      if(SENSITIVE_KEY_RE.test(key)){out[key]='[REDACTED]';continue;}
      out[key]=sanitizePublicEvidenceValue(val,depth+1);
    }
    return out;
  }
  return safeString(value,120);
}

function findField(root,key,depth=0,budget={nodes:0}){
  if(!root||typeof root!=='object'||depth>4||budget.nodes>=64)return undefined;
  budget.nodes++;
  if(Object.prototype.hasOwnProperty.call(root,key))return root[key];
  const values=Array.isArray(root)?root:Object.entries(root).filter(([k])=>!SENSITIVE_KEY_RE.test(k)).map(([,v])=>v);
  for(const value of values){
    const found=findField(value,key,depth+1,budget);
    if(found!==undefined)return found;
  }
  return undefined;
}

function sanitizeField(key,value){
  if(value===undefined)return null;
  if(key==='installedSha'){
    const text=String(value||'').trim();
    return /^[a-f0-9]{7,64}$/i.test(text)?text.toLowerCase():null;
  }
  if(key==='result')return safeString(value,120);
  if(key==='changedPaths'){
    if(!Array.isArray(value))return null;
    return value.slice(0,12).map(x=>safeString(x,180));
  }
  return sanitizePublicEvidenceValue(value,0);
}

export function extractPublicEvidence(structuredEvidence,requestedKeys=[]){
  if(!structuredEvidence||typeof structuredEvidence!=='object'||Array.isArray(structuredEvidence))return {};
  const out={};
  for(const key of requestedKeys){
    if(!SUPPORTED.has(key))continue;
    out[key]=sanitizeField(key,findField(structuredEvidence,key));
  }
  return out;
}

export function buildPublicEvidenceBlock(structuredEvidence,requestedKeys=[]){
  const keys=[...new Set((requestedKeys||[]).filter(key=>SUPPORTED.has(key)))];
  if(!keys.length)return '';
  let payload=extractPublicEvidence(structuredEvidence,keys);
  let json=JSON.stringify(payload);
  if(json.length>3600){
    const compact={};
    for(const key of keys){
      const value=payload[key];
      const encoded=JSON.stringify(value);
      compact[key]=encoded.length<=650?value:'[TRUNCATED]';
    }
    payload=compact;
    json=JSON.stringify(payload);
  }
  return 'TIGERIQ_PUBLIC_EVIDENCE_V1='+json.slice(0,4000);
}
