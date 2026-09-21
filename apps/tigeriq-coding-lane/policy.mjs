const SAFE_PATH_RE=/^[A-Za-z0-9._/-]+$/;
const PROTECTED=[
  /^\.github\/workflows\/\i,
  /^\.github\/CODEOWNERS$/i,
  /^\.env(?:\.|$)\i,
  /(^|\/)secrets?(\/|$)/i,
  /credential/i,
  /^docs\/EXECUTION_BOUNDARY\.md$/i,
  /^docs\/SECURITY\.md$/i,
  /^scripts\/tigeriq-core\/(?:run-core|install-core-task|install-core-updater)\.ps1$/i,
  /^vercel\.json$/i,
];

export function safeRepoPath(path){
  const p=String(path||'').trim();
  if(!p||p.length>220||!SAFE_PATH_RE.test(p)||p.startsWith('/')||p.includes('..')||p.includes('\\')) return false;
  return !PROTECTED.some(re=>re.test(p));
}

export function validateRedToGreenRequirements({ isBugFix = false, hasPreFixFailureEvidence = false, isDocOrConfig = false } = {}) {
  if (isDocOrConfig) return true;
  if (isBugFix && !hasPreFixFailureEvidence) {
    throw new Error('RED_TDD_PRE_FIX_EVIDENCE_REQUIRED');
  }
  return true;
}

export function validateChanges(changes,allowedPaths=[]){
  if(!Array.isArray(changes)||changes.length<1||changes.length>8) throw new Error('CODING_CHANGES_COUNT_INVALID');
  const allow=new Set((allowedPaths||[]).map(x=>String(x).trim()).filter(Boolean));
  let bytes=0; const seen=new Set();
  for(const change of changes){
    const path=String(change?.path||'').trim(); const content=String(change?.content??'');
    if(!safeRepoPath(path)) throw new Error(`CODING_PATH_BLOCKED:${path}`);
    if(allow.size&&!allow.has(path)) throw new Error(`CODING_PATH_OUTSIDE_MANAGER_SCOPE:${path}`);
    if(seen.has(path)) throw new Error(`CODING_DUPLICATE_PATH:${path}`); seen.add(path);
    bytes+=Buffer.byteLength(content,'utf8');
  }
  if(bytes>300000) throw new Error('CODING_CHANGESET_TOO_LARGE');
  return true;
}

function pathTokens(text){
  const raw=String(text||'').match(/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/g)||[];
  return raw.map(x=>x.replace(/[.,;:!?)}]+$/g,'')).filter(safeRepoPath);
}

export function extractCanonicalAllowedPaths(text){
  const lines=String(text||'').split(/\r?\n/);
  const out=[];
  let active=false;
  for(const raw of lines){
    const line=raw.trim();
    const header=line.match(/^(?:[-*]\s*)?(?:#{1,6}\s*)?(?:exact\s+hard\s+scope|allowed\s+paths\s+only|canonical\s+allowed\s+paths(?:\s*\(\s*must\s+not\s+expand\s*\))?)\s*:?(.*)$/i);
    if(header){
      active=true;
      for(const token of pathTokens(header[1]))out.push(token);
      continue;
    }
    if(!active)continue;
    if(/^#{1,6}\s+/.test(line)||/^(?:##?\s*)?(?:implement|mục tiêu|bắt buộc|acceptance|gate|no\s+)/i.test(line))break;
    const m=line.match(/^[-*]\s+`?([^`\s]+)`?\s*$/);
    if(m&&safeRepoPath(m[1]))out.push(m[1]);
    else if(line){
      const inline=pathTokens(line);
      if(inline.length)out.push(...inline);
      else if(out.length)break;
    }
  }
  return [...new Set(out)];
}

export function isRetryableAiError(error){
  const status=Number(error?.status||0);
  if([408,409,413,429,500,502,503,504].includes(status)) return true;
  const msg=String(error?.message||error||'');
  return error?.name==='AbortError'||/MANAGER_SOFT_BLOCK|CODING_CHANGES_COUNT_INVALID|CODING_COMPACT_(?:EDIT|EDITS)[A-Z0-9_]*|COMPACT_EDIT_[A-Z0-9_]+|JSON_OBJECT_(?:INVALID|MISSING)|unterminated|truncat|schema|EMPTY_RESPONSE|fetch failed|aborted|ECONNRESET|ETIMEDOUT|socket|HTTP_(?:408|409|413|429|500|502|503|504)\b/i.test(msg);
}

function repairInvalidJsonEscapes(input){
  const s=String(input||'');
  let out='';
  let inString=false;
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(!inString){out+=ch;if(ch==='"') inString=true;continue;}
    if(ch==='"'){
      let backslashes=0;
      for(let j=i-1;j>=0&&s[j]==='\\';j--) backslashes++;
      out+=ch;
      if(backslashes%2===0) inString=false;
      continue;
    }
    if(ch==='\\'){\n      const next=s[i+1];
      if(next&&'"\\bfnrtu'.includes(next)) out+='\\';
      else out+='\\\\';
      continue;
    }
    const code=ch.charCodeAt(0);
    if(code<=0x1f){
      if(ch==='\n') out+='\\n';
      else if(ch==='\r') out+='\\r';
      else if(ch==='\t') out+='\\t';
      else if(ch==='\b') out+='\\b';
      else if(ch==='\f') out+='\\f';
      else out+=`\\u${code.toString(16).padStart(4,'0')}`;
      continue;
    }
    out+=ch;
  }
  return out;
}

export function parseJsonObject(text){
  const raw=String(text||'').trim();
  const clean=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const a=clean.indexOf('{'),b=clean.lastIndexOf('}');
  if(a<0||b<a) throw new Error('JSON_OBJECT_MISSING');
  const candidate=clean.slice(a,b+1);
  try{return JSON.parse(candidate)}catch(firstError){
    try{return JSON.parse(repairInvalidJsonEscapes(candidate))}catch{
      const e=new Error(`JSON_OBJECT_INVALID:${String(firstError?.message||firstError)}`);
      e.cause=firstError;
      throw e;
    }
  }
}

export function validateCompactContract(edits){
  if(!Array.isArray(edits)) throw new Error('COMPACT_CONTRACT_EDITS_ARRAY_REQUIRED');
  if(edits.length===0) throw new Error('COMPACT_CONTRACT_NO_EDITS');
  if(edits.length>12) throw new Error('COMPACT_CONTRACT_TOO_MANY_EDITS');
  let bytes=0;
  for(const edit of edits){
    if(typeof edit.path!=='string'||!edit.path) throw new Error(`COMPACT_CONTRACT_INVALID_PATH: ${edit.path}`);
    if(typeof edit.old!=='string'||!edit.old) throw new Error(`COMPACT_CONTRACT_EMPTY_OLD: ${edit.path}`);
    if(typeof edit.new!=='string'||!edit.new) throw new Error(`COMPACT_CONTRACT_EMPTY_NEW: ${edit.path}`);
    if(edit.old.length>1800) throw new Error(`COMPACT_CONTRACT_OLD_TOO_LARGE: ${edit.path}`);
    if(edit.new.length>3600) throw new Error(`COMPACT_CONTRACT_NEW_TOO_LARGE: ${edit.path}`);
    bytes+=edit.old.length+edit.new.length;
  }
  if(bytes>120000) throw new Error('COMPACT_CONTRACT_TOTAL_SIZE_EXCEEDED');
  return true;
}

export function detectContractTruncation(text){
  const raw=String(text||'').trim();
  if(!raw) return 'empty';
  if(/JSON_OBJECT_INVALID|COMPACT_CONTRACT_OLD_TOO_LARGE|COMPACT_CONTRACT_TOTAL_SIZE_EXCEEDED/i.test(raw)) return 'over_sized';
  if(/JSON_OBJECT_MISSING/i.test(raw)) return 'missing';
  if(/COMPACT_EDIT_SEARCH_MISSING|COMPACT_EDIT_SEARCH_AMBIGUOUS|CODING_COMPACT_EDIT_OLD_NOT_FOUND/i.test(raw)) return 'truncated';
  return 'valid';
}

export function branchName(employeeId,jobId){
  const e=String(employeeId||'nv').toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,20);
  const j=String(jobId||'job').toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(-48);
  return `tigeriq/${e}/${j}`.slice(0,100);
}

export function checkGateState(checkRuns,required=['CI Verify','Queue Hygiene Verify','Vercel Online Verify']){
  const rows=Array.isArray(checkRuns)?checkRuns:[];
  const byName=new Map(rows.map(x=>[String(x?.name||''),x]));
  const states=required.map(name=>({name,status:byName.get(name)?.status||'missing',conclusion:byName.get(name)?.conclusion||null}));
  const failed=states.filter(x=>['failure','cancelled','timed_out','action_required','startup_failure'].includes(String(x.conclusion||'')));
  if(failed.length) return {state:'failed',states};
  if(states.every(x=>x.status==='completed'&&x.conclusion==='success')) return {state:'passed',states};
  return {state:'pending',states};
}

export function changedPathImpact(paths){
  const list=(paths||[]).map(String);
  const web=list.some(p=>/^apps\/tigeriq-core\/web-control(?:\.|-)|^scripts\/tigeriq-core\/run-web-control/i.test(p));
  const coding=list.some(p=>/^apps\/tigeriq-coding-lane\//i.test(p)||/^scripts\/tigeriq-core\/(?:run|install)-coding-lane/i.test(p));
  const core=list.some(p=>/^apps\/tigeriq-core\//i.test(p)&&!/^apps\/tigeriq-core\/web-control(?:\.|-)\i.test(p))||list.some(p=>/^scripts\/tigeriq-core\/(?:run-core|install-core-task)\.ps1$/i.test(p));
  const updater=list.some(p=>p==='scripts/tigeriq-core/update-core-runtime.ps1');
  return {core,web,coding,updater,none:!core&&!web&&!coding&&!updater};
}