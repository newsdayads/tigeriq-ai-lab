const SAFE_PATH_RE=/^[A-Za-z0-9._/-]+$/;
const PROTECTED=[
  /^\.github\/workflows\//i,
  /^\.github\/CODEOWNERS$/i,
  /^\.env(?:\.|$)/i,
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

function repairInvalidJsonEscapes(input){
  const s=String(input||'');
  let out='';
  let inString=false;
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(!inString){
      out+=ch;
      if(ch==='"') inString=true;
      continue;
    }
    if(ch==='"'){
      let backslashes=0;
      for(let j=i-1;j>=0&&s[j]==='\\';j--) backslashes++;
      out+=ch;
      if(backslashes%2===0) inString=false;
      continue;
    }
    if(ch==='\\'){
      const next=s[i+1];
      if(next&&'"\\/bfnrtu'.includes(next)) out+='\\';
      else out+='\\\\';
      continue;
    }
    out+=ch;
  }
  return out;
}

export function parseJsonObject(text){
  const clean=String(text||'').replace(/```json|```/gi,'').trim();
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
  const core=list.some(p=>/^apps\/tigeriq-core\//i.test(p)&&!/^apps\/tigeriq-core\/web-control(?:\.|-)/i.test(p))||list.some(p=>/^scripts\/tigeriq-core\/(?:run-core|install-core-task)\.ps1$/i.test(p));
  const updater=list.some(p=>p==='scripts/tigeriq-core/update-core-runtime.ps1');
  return {core,web,coding,updater,none:!core&&!web&&!coding&&!updater};
}
