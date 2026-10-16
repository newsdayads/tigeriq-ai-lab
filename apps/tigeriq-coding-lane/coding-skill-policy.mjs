import {createHash,randomUUID} from 'node:crypto';
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

const CANARY_STEP='G3_MODEL_TOOL_01';
const PORT_CASES=[80,' 443 ',1,65535,0,65536,-1,1.5,null,true,[],{},'1e3','0x50','80.0','','  ','00080','+80'];
const PORT_EXPECTED=[80,443,1,65535,null,null,null,null,null,null,null,null,null,null,null,null,null,80,null];

// Host callbacks must come from the connected execution surface, never from an
// AI reply, registry entry or serialized receipt. This helper grants no access
// and does not discover endpoints, credentials or models. No adapter = BLOCKED.
export async function runCodingSkillCapabilityCanary({sourceSha,skills,host}={}){
  const receipt={schema:'TIGERIQ_G3_CAPABILITY_CANARY_V1',run_id:randomUUID(),step_id:CANARY_STEP,
    started_at:new Date().toISOString(),source_sha:sourceSha||null,status:'BLOCKED',
    capability_verified:false,model_invoked:false,tool_invoked:false,model_id:null,tool_id:null,
    skill_proof:skills?.proof||[],prompt:null,prompt_sha256:null,response:null,response_sha256:null,
    model_receipt:null,tool_receipt:null,permission_receipts:null};
  const block=code=>({...receipt,status:'BLOCKED',code,finished_at:new Date().toISOString()});
  try{
    if(typeof sourceSha!=='string'||!(/^[a-f0-9]{40}$/).test(sourceSha))return block('CODING_CANARY_SOURCE_SHA_REQUIRED');
    assertCodingSkillProof(skills?.proof,skills);
    receipt.prompt=[
      'Perform exactly ONE isolated technical step. Do not modify repository files, permissions, PC01 or services.',
      `RUN_ID=${receipt.run_id}\nSTEP_ID=${CANARY_STEP}\nSOURCE_SHA=${sourceSha}`,
      `SKILL_CONTEXT_SHA256=${skills.contextHash}`,
      'Implement one pure ECMAScript export function normalizePort(value). Accept integer numbers 1..65535 and trimmed ASCII digit strings whose numeric value is 1..65535. Otherwise return null. Reject booleans, arrays, objects, fractions, signs, hex, exponent and decimal strings. Leading zero digit strings are allowed.',
      'Return ONLY JSON {run_id,step_id,source_sha,skill_context_sha256,code}. code contains that function only. Never claim tests/tool access or PASS; the authorized host runs independent cases.',
      skills.contextBlock
    ].join('\n\n');
    receipt.prompt_sha256=digest(receipt.prompt);
    if(!host||!['inspect','invokeModel','runTool','verifyReceipt'].every(key=>typeof host[key]==='function'))
      return block('CODING_CANARY_RUNTIME_ADAPTER_UNAVAILABLE');
    const observed=await host.inspect();
    receipt.permission_receipts=observed?.permission_receipts||null;
    receipt.model_id=observed?.model?.id||null;receipt.tool_id=observed?.tool?.id||null;
    if(typeof observed?.model?.id!=='string'||!observed.model.id.trim()||observed.model.available!==true)
      return block('CODING_CANARY_MODEL_UNAVAILABLE');
    if(observed.model.allowed!==true)return block('CODING_CANARY_MODEL_PERMISSION_MISSING');
    if(typeof observed.tool?.id!=='string'||!observed.tool.id.trim()||observed.tool.available!==true)
      return block('CODING_CANARY_TOOL_UNAVAILABLE');
    if(observed.tool.allowed!==true||observed.tool.isolated!==true||observed.tool.source_read_only!==true)
      return block('CODING_CANARY_TOOL_PERMISSION_MISSING');
    if(observed.model.new_cost!==0||observed.tool.new_cost!==0)return block('CODING_CANARY_ZERO_COST_UNVERIFIED');
    if(!['live','test-fixture'].includes(observed.mode)||
      !['model','tool'].every(key=>typeof observed.permission_receipts?.[key]==='string'&&observed.permission_receipts[key].trim())||
      await host.verifyReceipt('permission',observed,receipt)!==true)return block('CODING_CANARY_PERMISSION_EVIDENCE_UNVERIFIED');
    const request={run_id:receipt.run_id,step_id:CANARY_STEP,source_sha:sourceSha,model_id:receipt.model_id,
      tool_id:receipt.tool_id,prompt:receipt.prompt,prompt_sha256:receipt.prompt_sha256,skill_context_sha256:skills.contextHash};
    receipt.model_invoked=true;
    const model=await host.invokeModel({...request});receipt.model_receipt=model||null;
    if(!model?.id||model.run_id!==receipt.run_id||model.model_id!==receipt.model_id||model.source_sha!==sourceSha||
      model.prompt_sha256!==receipt.prompt_sha256||typeof model.response!=='string'||!model.response.trim()||model.response.length>16000||
      !SHA.test(model.response_sha256||'')||digest(model.response)!==model.response_sha256||
      await host.verifyReceipt('model',model,request)!==true)return block('CODING_CANARY_MODEL_EVIDENCE_INVALID');
    receipt.response=model.response;receipt.response_sha256=model.response_sha256;
    let reply;try{reply=JSON.parse(model.response)}catch{return block('CODING_CANARY_MODEL_RESPONSE_INVALID')}
    if(!reply||Object.keys(reply).sort().join(',')!=='code,run_id,skill_context_sha256,source_sha,step_id'||
      reply.run_id!==receipt.run_id||reply.step_id!==CANARY_STEP||reply.source_sha!==sourceSha||reply.skill_context_sha256!==skills.contextHash||
      typeof reply.code!=='string'||!reply.code.trim()||reply.code.length>4000)return block('CODING_CANARY_MODEL_RESPONSE_INVALID');
    const input={...request,model_receipt_id:model.id,code:reply.code,code_sha256:digest(reply.code),cases:structuredClone(PORT_CASES)};
    input.input_sha256=digest(JSON.stringify(input));
    receipt.tool_invoked=true;
    // Only an explicitly authorized isolation tool may execute model code.
    // No eval, VM, shell, network or filesystem execution occurs in this module.
    const tool=await host.runTool(structuredClone(input));receipt.tool_receipt=tool||null;
    if(!tool?.id||tool.run_id!==receipt.run_id||tool.tool_id!==receipt.tool_id||tool.source_sha!==sourceSha||
      tool.model_receipt_id!==model.id||tool.input_sha256!==input.input_sha256||tool.code_sha256!==input.code_sha256||
      tool.exit_code!==0||typeof tool.stdout!=='string'||!SHA.test(tool.stdout_sha256||'')||digest(tool.stdout)!==tool.stdout_sha256||
      await host.verifyReceipt('tool',tool,input)!==true)return block('CODING_CANARY_TOOL_EVIDENCE_INVALID');
    let output;try{output=JSON.parse(tool.stdout)}catch{return block('CODING_CANARY_FUNCTIONAL_EVIDENCE_INVALID')}
    if(!Array.isArray(output?.outputs)||JSON.stringify(output.outputs)!==JSON.stringify(PORT_EXPECTED))
      return block('CODING_CANARY_FUNCTIONAL_EVIDENCE_INVALID');
    const live=observed.mode==='live';
    return {...receipt,status:live?'LIVE_EVIDENCE_VERIFIED':'FIXTURE_VALIDATED',
      capability_verified:live,code:live?'CODING_CANARY_LIVE_EVIDENCE_VERIFIED':'CODING_CANARY_FIXTURE_ONLY',
      tested_cases:PORT_CASES.length,finished_at:new Date().toISOString()};
  }catch(error){
    return block(error?.code==='CODING_STEP_SKILL_EVIDENCE_CHANGED'?error.code:'CODING_CANARY_EXECUTION_FAILED');
  }
}
