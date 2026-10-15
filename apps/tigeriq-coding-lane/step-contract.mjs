import {createHash} from 'node:crypto';

export const CODING_STEP_PACKET_VERSION='TIGERIQ_CODING_STEP_V1';
const TYPES=new Set(['source','frontend','backend','android','test','documentation']);
const string=x=>String(x??'').trim();
const safePath=p=>/^[A-Za-z0-9._/-]{1,220}$/.test(p)&&!p.startsWith('/')&&!p.includes('..')&&!p.includes('\\');
function strings(values,field,{max=8,allowEmpty=false}={}){
  if(!Array.isArray(values)||values.length>max||(!allowEmpty&&!values.length))throw Error('CODING_STEP_'+field+'_INVALID');
  const out=values.map(string);
  if(out.some(x=>!x||x.length>1200)||new Set(out).size!==out.length)throw Error('CODING_STEP_'+field+'_INVALID');
  return out;
}
export function compileCodingStepPacket({objectiveId,sourceRevision,job,allowedPaths=[],skillEvidence=[]}={}){
  if(!string(objectiveId)||!string(sourceRevision))throw Error('CODING_STEP_IDENTITY_MISSING');
  if(!job||typeof job!=='object'||Array.isArray(job))throw Error('CODING_STEP_JOB_INVALID');
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(string(job.step_id)))throw Error('CODING_STEP_STEP_ID_INVALID');
  if(!string(job.title)||!string(job.instruction)||string(job.instruction).length>12000)throw Error('CODING_STEP_INSTRUCTION_INVALID');
  const paths=strings(job.paths,'PATHS');
  const allowed=new Set(strings(allowedPaths,'ALLOWED_PATHS',{max:80}));
  if(paths.some(p=>!safePath(p)||!allowed.has(p)))throw Error('CODING_STEP_SCOPE_MISMATCH');
  const kind=string(job.deliverable_type);
  if(!TYPES.has(kind))throw Error('CODING_STEP_DELIVERABLE_INVALID');
  const required=strings(job.required_changed_paths,'REQUIRED_PATHS');
  if(required.some(p=>!safePath(p)||!paths.includes(p)))throw Error('CODING_STEP_REQUIRED_PATH_OUT_OF_SCOPE');
  if(kind==='android'&&!required.some(p=>/(\.kt|\.java|\.gradle\.kts|AndroidManifest\.xml)$/.test(p)))throw Error('CODING_STEP_ANDROID_SOURCE_REQUIRED');
  if(kind==='frontend'&&!required.some(p=>/\.(tsx?|jsx?|vue|svelte|html|css)$/.test(p)))throw Error('CODING_STEP_FRONTEND_SOURCE_REQUIRED');
  if(kind==='backend'&&!required.some(p=>/\.(mjs|cjs|js|ts|py|go|rs|java|kt)$/.test(p)))throw Error('CODING_STEP_BACKEND_SOURCE_REQUIRED');
  const packet={
    schema:CODING_STEP_PACKET_VERSION,objective_id:string(objectiveId),source_revision:string(sourceRevision),
    step_id:string(job.step_id),title:string(job.title),instruction:string(job.instruction),
    paths,deliverable_type:kind,required_changed_paths:required,
    steps:strings(job.steps,'STEPS'),acceptance:strings(job.acceptance,'ACCEPTANCE'),
    evidence_required:strings(job.evidence_required,'EVIDENCE'),
    skill_refs:skillEvidence.map(x=>({id:string(x.id),version:string(x.version),bytes:Number(x.bytes)||0}))
  };
  packet.skill_ids=packet.skill_refs.map(x=>x.id);
  packet.prompt_revision=createHash('sha256').update(JSON.stringify(packet)).digest('hex').slice(0,24);
  return packet;
}
export function codingStepInstruction(packet){
  if(packet?.schema!==CODING_STEP_PACKET_VERSION)throw Error('CODING_STEP_PACKET_INVALID');
  return packet.instruction+'\n\nCODING_STEP_PACKET_JSON='+JSON.stringify(packet);
}
export function codingStepPacketFromInstruction(instruction){
  const match=string(instruction).match(/^CODING_STEP_PACKET_JSON=(\{[^\r\n]*\})$/m);
  if(!match)return null;
  try{
    const packet=JSON.parse(match[1]);
    if(packet?.schema===CODING_STEP_PACKET_VERSION&&packet.prompt_revision)return packet;
  }catch{}
  throw Error('CODING_STEP_PACKET_CORRUPT');
}
export function codingRolePrompt({role,packet,skillContext='',context='',diff=''}={}){
  const rules={
    manager:'Define one bounded step with explicit actions, artifacts, acceptance and evidence; never declare the project complete.',
    implementer:'Read real source, edit only authorized files, run meaningful scoped tests and return artifact/test evidence; a markdown description is not executable code.',
    reviewer:'Check every acceptance criterion against actual diff, required artifacts, and tests; report precise failures. Never self-review.',
    acceptor:'Confirm every acceptance with trusted artifacts and functional tests for the exact source SHA. Waiver is not technical PASS.'
  };
  if(!rules[role])throw Error('CODING_STEP_ROLE_INVALID');
  if(packet?.schema!==CODING_STEP_PACKET_VERSION)throw Error('CODING_STEP_PACKET_INVALID');
  return [
    'ROLE='+role,
    'Do not change permissions, secrets, Production or App Chrome. The canonical source and allowed scope override the AI response.',
    rules[role],
    'STEP_ID='+packet.step_id,
    'PROMPT_REVISION='+packet.prompt_revision,
    'SOURCE_REVISION='+packet.source_revision,
    'SKILLS='+packet.skill_ids.join(','),
    'PACKET_JSON='+JSON.stringify(packet),
    'CONTEXT='+string(context).slice(0,14000),
    'ACTIVE_SKILL_CONTENT='+string(skillContext).slice(0,6000),
    'REVIEW_DIFF='+string(diff).slice(0,30000),
    'OUTPUT: step_id, source_revision, changed_paths, test receipts, criterion-specific evidence, and next-step or blocked reason.'
  ].join('\n');
}
export function verifyCodingDeliverable({packet,changes=[]}={}){
  if(packet?.schema!==CODING_STEP_PACKET_VERSION)throw Error('CODING_STEP_PACKET_INVALID');
  const files=new Map((Array.isArray(changes)?changes:[]).map(x=>[string(x?.path),string(x?.content)]));
  const missing=packet.required_changed_paths.filter(p=>!files.has(p)||!files.get(p));
  const outside=[...files.keys()].filter(p=>!packet.paths.includes(p));
  const requiredExtension={
    android:/\.(kt|java|gradle\.kts)$/,
    frontend:/\.(tsx?|jsx?|vue|svelte|html|css)$/,
    backend:/\.(mjs|cjs|js|ts|py|go|rs|java|kt)$/
  }[packet.deliverable_type];
  const typeMissing=requiredExtension&&![...files.keys()].some(p=>requiredExtension.test(p));
  const reasons=[
    ...(missing.length?['REQUIRED_CHANGED_PATHS_MISSING:'+missing.join(',')]:[]),
    ...(outside.length?['OUT_OF_SCOPE:'+outside.join(',')]:[]),
    ...(typeMissing?['DELIVERABLE_SOURCE_TYPE_MISSING']:[])
  ];
  return {pass:!reasons.length,code:reasons.length?'CODING_DELIVERABLE_REJECTED':'CODING_DELIVERABLE_STRUCTURE_PASSED',reasons};
}
export function repeatedCodingAttemptDecision({workOrderId,stepId,sourceRevision,failureSignature='',history=[],maxSameFailure=2}={}){
  if(!string(workOrderId)||!string(stepId)||!string(sourceRevision))return {allow:false,code:'CODING_ATTEMPT_IDENTITY_UNVERIFIED'};
  const comparable=(Array.isArray(history)?history:[]).filter(x=>string(x.workOrderId)===string(workOrderId)&&string(x.stepId)===string(stepId)&&string(x.sourceRevision)===string(sourceRevision));
  if(comparable.some(x=>x.status==='accepted'))return {allow:false,code:'CODING_STEP_ALREADY_ACCEPTED'};
  if(string(failureSignature)&&comparable.filter(x=>x.status==='failed'&&string(x.failureSignature)===string(failureSignature)).length>=Math.max(1,Number(maxSameFailure)||2))return {allow:false,code:'CODING_SAME_FAILURE_STOP'};
  return {allow:true,code:'CODING_ATTEMPT_ALLOWED'};
}
