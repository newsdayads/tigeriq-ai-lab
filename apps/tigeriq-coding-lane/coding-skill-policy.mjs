import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSkillRegistry} from '../tigeriq-core/skill-loader.mjs';

const ID=/^[a-z0-9][a-z0-9-]*$/;
const SHA=/^[a-f0-9]{64}$/;
const VERSION=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DEFAULT_REGISTRY=fileURLToPath(new URL('../../docs/skills/registry.yaml',import.meta.url));
const HEADER='ACTIVE SKILLS (use only when relevant; never expand permissions):';
const FOOTER='\n\nEND ACTIVE SKILLS';
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,details={})=>{throw Object.assign(new Error(code+(details.id?':'+details.id:'')),{code,...details})};
const positiveInteger=value=>Number.isSafeInteger(value)&&value>0;
const marker=skill=>`[SKILL ${skill.id} v${skill.version}]\n`;

// Registry state alone is insufficient: the bytes actually injected must identify
// the same ACTIVE skill/version/target. Do not interpret prose as a promotion.
function validContent(content,skill){
  const sections=content.split(/^## Identity\s*\r?$/m);
  if(sections.length!==2)return false;
  const identity=sections[1].split(/^## /m)[0];
  const fields={};
  for(const match of identity.matchAll(/^- (ID|Version|State|Target):\s*([^\r\n]+)\r?$/gm)){
    if(Object.hasOwn(fields,match[1]))return false;
    fields[match[1]]=match[2].trim();
  }
  return fields.ID===skill.id&&fields.Version===skill.version&&fields.State==='ACTIVE'&&
    /^coding-lane(?: \/ (?:frontend|backend))?$/.test(fields.Target||'');
}

export function requiredCodingSkillIdsForDeliverable(deliverableType){
  const kind=String(deliverableType||'').trim().toLowerCase();
  if(!['source','frontend','backend','android','test','documentation'].includes(kind))
    fail('CODING_SKILL_DELIVERABLE_INVALID');
  const specialist={frontend:'frontend-engineering',backend:'backend-engineering'}[kind];
  return specialist?['spec-first-tdd',specialist]:['spec-first-tdd'];
}

export function loadRequiredCodingSkills(objective,{requiredIds=['spec-first-tdd'],registryPath=DEFAULT_REGISTRY,baseDir=dirname(registryPath)}={}){
  if(!Array.isArray(requiredIds)||!requiredIds.length||requiredIds.length>3||
    requiredIds.some(id=>typeof id!=='string'||!ID.test(id.trim())))fail('CODING_REQUIRED_SKILLS_INVALID');
  const ids=requiredIds.map(id=>id.trim());
  if(new Set(ids).size!==ids.length)fail('CODING_REQUIRED_SKILLS_INVALID');
  const registry=loadSkillRegistry(registryPath);
  const loaded=[];
  let totalChars=0;
  // Required-only selection avoids optional relevance scores evicting a mandatory
  // skill or changing the context digest between manager/implementer/reviewer.
  for(const id of ids){
    const skill=registry.skills.find(row=>row.id===id);
    const deny=reason=>fail('CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED',{id,reason});
    if(!skill||skill.state!=='ACTIVE'||skill.target!=='coding-lane'||!VERSION.test(skill.version||''))deny('REGISTRY_NOT_ACTIVE_CODING_SKILL');
    let raw;
    try{
      const root=realpathSync(baseDir);
      const path=realpathSync(join(root,id,'SKILL.md'));
      const within=relative(root,path);
      if(isAbsolute(within)||within==='..'||within.startsWith('../')||within.startsWith('..\\')||!statSync(path).isFile())deny('SKILL_PATH_OUTSIDE_ROOT');
      raw=readFileSync(path);
    }catch(error){
      if(error?.code==='CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED')throw error;
      deny('SKILL_FILE_UNREADABLE');
    }
    const content=raw.toString('utf8');
    if(!content.trim()||!Buffer.from(content,'utf8').equals(raw))deny('SKILL_CONTENT_EMPTY_OR_INVALID_UTF8');
    if(!validContent(content,skill))deny('SKILL_IDENTITY_MISMATCH');
    const framing=HEADER.length+FOOTER.length+loaded.reduce((size,row)=>size+2+marker(row).length,0)+2+marker(skill).length;
    if(content.length>6000-totalChars-framing)deny('CONTEXT_BUDGET');
    loaded.push({...skill,content,chars:content.length,bytes:raw.length,content_sha256:digest(raw)});
    totalChars+=content.length;
  }
  // The existing role prompt trims and caps context at 6000 characters. A footer
  // preserves the final file's exact whitespace, and framing counts in the cap.
  const contextBlock=[HEADER,...loaded.map(skill=>marker(skill)+skill.content)].join('\n\n')+FOOTER;
  const contextHash=digest(contextBlock);
  const evidence=loaded.map(({id,version,target,bytes,content_sha256})=>({id,version,target,bytes,content_sha256}));
  return {
    skills:loaded.map(({content,...skill})=>skill),totalChars,contextBlock,contextHash,evidence,skipped:[],
    proof:evidence.map(row=>({...row,context_sha256:contextHash}))
  };
}

export function assertCodingSkillProof(expected,actual){
  const reject=()=>fail('CODING_STEP_SKILL_EVIDENCE_CHANGED');
  if(!Array.isArray(expected)||!expected.length||expected.length>3||
    !Array.isArray(actual?.proof)||!Array.isArray(actual?.skills)||!Array.isArray(actual?.evidence)||
    actual.proof.length!==expected.length||actual.skills.length!==expected.length||actual.evidence.length!==expected.length||
    typeof actual.contextBlock!=='string'||actual.contextBlock.length>6000||!SHA.test(actual.contextHash||'')||digest(actual.contextBlock)!==actual.contextHash)reject();
  if(new Set(expected.map(row=>row?.id)).size!==expected.length)reject();
  let cursor=HEADER.length,totalChars=0;
  if(!actual.contextBlock.startsWith(HEADER))reject();
  const seen=new Set();
  for(let i=0;i<actual.skills.length;i++){
    const skill=actual.skills[i],row=actual.proof[i],evidence=actual.evidence[i];
    if(!skill||!row||!evidence||!ID.test(skill.id||'')||seen.has(skill.id)||
      skill.state!=='ACTIVE'||skill.target!=='coding-lane'||!VERSION.test(skill.version||'')||
      !positiveInteger(skill.chars)||!positiveInteger(skill.bytes))reject();
    seen.add(skill.id);
    const prefix='\n\n'+marker(skill);
    if(!actual.contextBlock.startsWith(prefix,cursor))reject();
    cursor+=prefix.length;
    const content=actual.contextBlock.slice(cursor,cursor+skill.chars);
    cursor+=skill.chars;totalChars+=skill.chars;
    const bytes=Buffer.byteLength(content,'utf8'),contentHash=digest(content);
    if(content.length!==skill.chars||!validContent(content,skill)||bytes!==skill.bytes||contentHash!==skill.content_sha256)reject();
    for(const proof of [row,evidence]){
      if(proof.id!==skill.id||proof.version!==skill.version||proof.target!=='coding-lane'||
        proof.bytes!==bytes||proof.content_sha256!==contentHash)reject();
    }
    if(row.context_sha256!==actual.contextHash)reject();
    const ref=expected.find(item=>item?.id===skill.id);
    // The unchanged step packet schema keeps id/version/bytes/context hash.
    // That context hash commits to every exact skill byte; richer receipts also
    // check the per-file digest and target when supplied.
    if(!ref||ref.version!==row.version||!positiveInteger(ref.bytes)||ref.bytes!==bytes||
      !SHA.test(ref.context_sha256||'')||ref.context_sha256!==actual.contextHash||
      (ref.content_sha256!==undefined&&ref.content_sha256!==contentHash)||
      (ref.target!==undefined&&ref.target!=='coding-lane'))reject();
  }
  if(actual.contextBlock.slice(cursor)!==FOOTER||totalChars!==actual.totalChars)reject();
  return true;
}
