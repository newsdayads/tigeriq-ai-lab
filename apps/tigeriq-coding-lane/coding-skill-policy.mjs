import {createHash} from 'node:crypto';
import {matchAndLoadSkills} from '../tigeriq-core/skill-loader.mjs';

const ID=/^[a-z0-9][a-z0-9-]*$/;
const SHA=/^[a-f0-9]{64}$/;

export function loadRequiredCodingSkills(objective,{requiredIds=['spec-first-tdd'],registryPath,baseDir}={}){
  const ids=[...new Set(requiredIds.map(x=>String(x||'').trim()))];
  if(!ids.length||ids.length>3||ids.some(id=>!ID.test(id)))
    throw Object.assign(new Error('CODING_REQUIRED_SKILLS_INVALID'),{code:'CODING_REQUIRED_SKILLS_INVALID'});
  const result=matchAndLoadSkills(String(objective||'')+'\n'+ids.join(' '),{
    ...(registryPath?{registryPath}:{}),...(baseDir?{baseDir}:{}),maxSkills:3,maxChars:6000
  });
  for(const id of ids){
    if(!result.evidence.some(s=>s.id===id&&s.version&&s.bytes>0&&s.target==='coding-lane'))
      throw Object.assign(new Error('CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED:'+id),{
        code:'CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED',id,skipped:result.skipped
      });
  }
  const contextHash=createHash('sha256').update(result.contextBlock,'utf8').digest('hex');
  return {...result,contextHash,proof:result.evidence.map(e=>({...e,context_sha256:contextHash}))};
}

export function assertCodingSkillProof(expected,actual){
  const a=Array.isArray(actual?.proof)?actual.proof:[];
  const missing=(expected||[]).filter(e=>
    !a.some(x=>x.id===e.id&&x.version===e.version&&x.bytes===e.bytes&&
      SHA.test(String(x.context_sha256||''))&&x.context_sha256===e.context_sha256));
  if(missing.length)throw Object.assign(new Error('CODING_STEP_SKILL_EVIDENCE_CHANGED:'+missing.map(x=>x.id).join(',')),{
    code:'CODING_STEP_SKILL_EVIDENCE_CHANGED',missing:missing.map(x=>x.id)
  });
  return true;
}
