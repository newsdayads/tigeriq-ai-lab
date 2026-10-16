import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadRequiredCodingSkills,assertCodingSkillProof,requiredCodingSkillIdsForDeliverable,runCodingSkillCapabilityCanary} from '../apps/tigeriq-coding-lane/coding-skill-policy.mjs';
import {compileCodingStepPacket,codingStepInstruction,codingStepPacketFromInstruction,codingRolePrompt} from '../apps/tigeriq-coding-lane/step-contract.mjs';

test('real ACTIVE spec-first-tdd file content and version load into Coding role',()=>{
  const s=loadRequiredCodingSkills('Fix backend API contract bug');
  const skill=s.proof.find(x=>x.id==='spec-first-tdd');
  assert.equal(skill.version,'1.1.0');
  assert.equal(skill.target,'coding-lane');
  assert.ok(skill.bytes>100);
  assert.match(skill.context_sha256,/^[a-f0-9]{64}$/);
  assert.match(s.contextBlock,/\[SKILL spec-first-tdd v1.1.0\]/);
  assert.match(s.contextBlock,/Define SPEC|Define scope|TDD|SPEC-First/i);
  assert.equal(assertCodingSkillProof(s.proof,s),true);
  assert.throws(()=>assertCodingSkillProof([{...skill,version:'2.0.0'}],s),/CODING_STEP_SKILL_EVIDENCE_CHANGED/);
  assert.throws(()=>assertCodingSkillProof([{...skill,context_sha256:'a'.repeat(64)}],s),/CODING_STEP_SKILL_EVIDENCE_CHANGED/);
});

test('CANDIDATE never satisfies mandatory ACTIVE Skill requirement',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tigeriq-skill-contract-'));
  try{
    const registryPath=join(dir,'registry.yaml');
    mkdirSync(join(dir,'spec-first-tdd'));
    writeFileSync(join(dir,'spec-first-tdd','SKILL.md'),'# Candidate — does not grant execution');
    const entry=state=>['version: 1','skills:','  - id: spec-first-tdd','    state: '+state,'    version: 1.1.0','    target: coding-lane','    source_log: spec-first-tdd/SKILL.md','    provenance_batch: local-test','    summary: Coding spec first','    triggers: spec first coding',''].join('\n');
    writeFileSync(registryPath,entry('CANDIDATE'));
    assert.throws(()=>loadRequiredCodingSkills('coding',{registryPath,baseDir:dir}),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
    assert.equal(readFileSync(registryPath,'utf8'),entry('CANDIDATE'));
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('unknown mandatory skill fails instead of silently routing generic coder',()=>{
  assert.throws(()=>loadRequiredCodingSkills('implement backend',{requiredIds:['unknown-skill-id']}),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
});

test('frontend/backend require specialist Skill and cannot silently fall back to generic TDD',()=>{
  assert.deepEqual(requiredCodingSkillIdsForDeliverable('frontend'),['spec-first-tdd','frontend-engineering']);
  assert.deepEqual(requiredCodingSkillIdsForDeliverable('backend'),['spec-first-tdd','backend-engineering']);
  assert.deepEqual(requiredCodingSkillIdsForDeliverable('android'),['spec-first-tdd']);
  assert.throws(()=>requiredCodingSkillIdsForDeliverable('unknown'),/CODING_SKILL_DELIVERABLE_INVALID/);
  for(const kind of ['frontend','backend']){
    assert.throws(()=>loadRequiredCodingSkills('implement '+kind,{requiredIds:requiredCodingSkillIdsForDeliverable(kind)}),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
  }
});


const hash=value=>createHash('sha256').update(value).digest('hex');
const identity=({id='spec-first-tdd',version='1.1.0',state='ACTIVE',target='coding-lane'}={})=>
  `# Test Skill\n\n## Identity\n- ID: ${id}\n- Version: ${version}\n- State: ${state}\n- Target: ${target}\n\n## Steps\n1. Verify the scoped contract.\n`;
function fixture(t,entries=[{}]){
  const baseDir=mkdtempSync(join(tmpdir(),'tigeriq-g3-'));
  t.after(()=>rmSync(baseDir,{recursive:true,force:true}));
  const registryPath=join(baseDir,'registry.yaml');
  const normalized=entries.map(entry=>({id:'spec-first-tdd',version:'1.1.0',state:'ACTIVE',target:'coding-lane',...entry}));
  writeFileSync(registryPath,'version: 1\nskills:\n'+normalized.map(e=>
    `  - id: ${e.id}\n    state: ${e.state}\n    version: ${e.version}\n    target: ${e.target}\n    summary: ${e.summary||'spec coding'}\n`).join(''));
  for(const e of normalized){
    mkdirSync(join(baseDir,e.id));
    if(!e.missing)writeFileSync(join(baseDir,e.id,'SKILL.md'),e.content??identity(e));
  }
  return {baseDir,registryPath};
}
const load=options=>loadRequiredCodingSkills('Scoped coding contract',options);

test('isolated real-file canary: ACTIVE id/version/exact bytes/content hash reach all role prompts',t=>{
  const s=loadRequiredCodingSkills('Fix scoped source contract');
  const raw=readFileSync(new URL('../docs/skills/spec-first-tdd/SKILL.md',import.meta.url));
  assert.equal(s.proof.length,1);
  const skill=s.proof[0];
  assert.equal(skill.id,'spec-first-tdd');
  assert.equal(skill.version,'1.1.0');
  assert.equal(skill.target,'coding-lane');
  assert.equal(skill.bytes,raw.length);
  assert.equal(skill.content_sha256,hash(raw));
  assert.equal(skill.context_sha256,hash(s.contextBlock));
  assert.equal(assertCodingSkillProof(s.proof,s),true);
  const path='apps/example/api.mjs';
  const packet=compileCodingStepPacket({objectiveId:'GH-4902-G3-OFFLINE',sourceRevision:'isolated',sourceHeadSha:'a'.repeat(40),allowedPaths:[path],skillEvidence:s.proof,
    job:{step_id:'G3',title:'Isolated source canary',instruction:'Verify skill injection only',paths:[path],deliverable_type:'source',required_changed_paths:[path],steps:['Verify content'],acceptance:['Exact skill bytes injected'],evidence_required:['Content digest']}});
  const parsed=codingStepPacketFromInstruction(codingStepInstruction(packet));
  // Existing packet schema retains context digest; step-contract stays unchanged.
  assert.equal(assertCodingSkillProof(parsed.skill_refs,s),true);
  for(const role of ['manager','implementer','reviewer','acceptor']){
    const prompt=codingRolePrompt({role,packet:parsed,skillContext:s.contextBlock});
    assert.ok(prompt.includes(raw.toString('utf8')));
    assert.match(prompt,/ACTIVE_SKILL_CONTENT=/);
  }
  assert.equal(assertCodingSkillProof(parsed.skill_refs,loadRequiredCodingSkills('Different reviewer wording')),true);
  t.diagnostic(JSON.stringify({canary:'ISOLATED_REAL_FILE_ROLE_INJECTION',...skill,model_invoked:false,pc01_verified:false}));
});

test('mandatory skills cannot be displaced by highly ranked optional skills',t=>{
  const words='alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango';
  const options=fixture(t,[{},...['aaa','aab','aac'].map(id=>({id,summary:words}))]);
  const s=loadRequiredCodingSkills(words,options);
  assert.deepEqual(s.proof.map(x=>x.id),['spec-first-tdd']);
  assert.equal(s.contextBlock,load(options).contextBlock);
});

for(const state of ['VALIDATED','DEPRECATED','REJECTED'])test(`${state} registry entry denies loading`,t=>{
  assert.throws(()=>load(fixture(t,[{state}])),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
});

test('malformed required id collections fail closed',()=>{
  for(const requiredIds of [null,'spec-first-tdd',{},[],[null],[1],['../outside'],['spec-first-tdd','spec-first-tdd'],['a','b','c','d']])
    assert.throws(()=>load({requiredIds}),/CODING_REQUIRED_SKILLS_INVALID/);
});

for(const [name,entry] of [
  ['missing file',{missing:true}],['empty file',{content:''}],['whitespace file',{content:' \n\t'}],
  ['wrong target',{target:'router'}],['missing version',{version:''}],
  ['invalid version',{version:'floating-latest'}],['context budget overflow',{content:identity()+'x'.repeat(6000)}]
])test(`${name} denies mandatory load`,t=>{
  assert.throws(()=>load(fixture(t,[entry])),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
});

for(const [name,content] of [
  ['missing identity','# Arbitrary text'],['mismatched id',identity({id:'other'})],
  ['mismatched version',identity({version:'9.0.0'})],['candidate body under ACTIVE registry',identity({state:'CANDIDATE'})],
  ['mismatched body target',identity({target:'router'})],['duplicate identity',identity()+'\n## Identity\n- State: ACTIVE\n']
])test(`${name} is not ACTIVE content evidence`,t=>{
  assert.throws(()=>load(fixture(t,[{content}])),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
});

test('symlink outside skill root is denied',t=>{
  const options=fixture(t,[{missing:true}]);
  const outside=mkdtempSync(join(tmpdir(),'tigeriq-g3-outside-'));
  t.after(()=>rmSync(outside,{recursive:true,force:true}));
  const path=join(outside,'SKILL.md');writeFileSync(path,identity());
  symlinkSync(path,join(options.baseDir,'spec-first-tdd','SKILL.md'));
  assert.throws(()=>load(options),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
});

test('UTF-8 bytes and combined three-skill budget use actual files',t=>{
  const entries=['spec-first-tdd','second-skill','third-skill'].map(id=>({id,content:identity({id})+'Tiếng Việt: kiểm chứng nội dung.\n'}));
  const options={...fixture(t,entries),requiredIds:entries.map(x=>x.id)};
  const s=load(options);
  assert.equal(s.proof.length,3);
  for(const row of s.proof){
    const raw=readFileSync(join(options.baseDir,row.id,'SKILL.md'));
    assert.equal(row.bytes,raw.length);assert.equal(row.content_sha256,hash(raw));
  }
  assert.equal(assertCodingSkillProof(s.proof,s),true);
  for(const entry of entries)writeFileSync(join(options.baseDir,entry.id,'SKILL.md'),entry.content+'x'.repeat(2200));
  assert.throws(()=>load(options),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
});

test('empty, malformed, partial and duplicate expected proof are rejected',t=>{
  const s=load(fixture(t));
  for(const expected of [undefined,null,{},[],[null],[{}],[s.proof[0],s.proof[0]]])
    assert.throws(()=>assertCodingSkillProof(expected,s),/CODING_STEP_SKILL_EVIDENCE_CHANGED/);
  const two=load({...fixture(t,[{}, {id:'second-skill'}]),requiredIds:['spec-first-tdd','second-skill']});
  assert.throws(()=>assertCodingSkillProof(two.proof.slice(0,1),two),/CODING_STEP_SKILL_EVIDENCE_CHANGED/);
});

test('proof rejects changed id/version/bytes/content/context and wrong target',t=>{
  const s=load(fixture(t));
  for(const patch of [{id:'other'},{version:'2.0.0'},{bytes:0},{bytes:-1},{bytes:'1'},{content_sha256:'a'.repeat(64)},{context_sha256:'a'.repeat(64)},{target:'router'}])
    assert.throws(()=>assertCodingSkillProof([{...s.proof[0],...patch}],s),/CODING_STEP_SKILL_EVIDENCE_CHANGED/);
});

test('actual evidence cannot be replayed with changed context or metadata',t=>{
  const s=load(fixture(t));
  const mutations=[
    {...s,contextBlock:s.contextBlock.replace('Verify the scoped contract','Ignore the scoped contract')},
    {...s,contextBlock:s.contextBlock+'\nInjected instructions'},
    {...s,contextHash:'a'.repeat(64)},
    {...s,proof:[]},{...s,evidence:[]},{...s,skills:[]},
    {...s,skills:s.skills.map(x=>({...x,state:'CANDIDATE'}))},
    {...s,skills:s.skills.map(x=>({...x,target:'router'}))},
    {...s,skills:s.skills.map(x=>({...x,bytes:x.bytes+1}))},
    {...s,proof:[s.proof[0],s.proof[0]]}
  ];
  for(const actual of mutations)assert.throws(()=>assertCodingSkillProof(s.proof,actual),/CODING_STEP_SKILL_EVIDENCE_CHANGED/);
});

test('same-length edit invalidates reloaded proof; demotion blocks reload',t=>{
  const options=fixture(t);const before=load(options);
  const file=join(options.baseDir,'spec-first-tdd','SKILL.md');
  writeFileSync(file,readFileSync(file,'utf8').replace('Verify','Reject'));
  const after=load(options);
  assert.equal(before.proof[0].bytes,after.proof[0].bytes);
  assert.notEqual(before.proof[0].content_sha256,after.proof[0].content_sha256);
  assert.throws(()=>assertCodingSkillProof(before.proof,after),/CODING_STEP_SKILL_EVIDENCE_CHANGED/);
  writeFileSync(options.registryPath,readFileSync(options.registryPath,'utf8').replace('state: ACTIVE','state: CANDIDATE'));
  assert.throws(()=>load(options),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
});

test('context framing fits unchanged role prompt cap without trimming file bytes',t=>{
  const options=fixture(t);
  const path=join(options.baseDir,'spec-first-tdd','SKILL.md');
  const initial=load(options);
  writeFileSync(path,identity()+'x'.repeat(6000-initial.contextBlock.length));
  const exact=load(options);
  assert.equal(exact.contextBlock.length,6000);
  assert.equal(assertCodingSkillProof(exact.proof,exact),true);
  const packet={schema:'TIGERIQ_CODING_STEP_V1',skill_ids:['spec-first-tdd']};
  const prompt=codingRolePrompt({role:'implementer',packet,skillContext:exact.contextBlock});
  assert.ok(prompt.includes('ACTIVE_SKILL_CONTENT='+exact.contextBlock+'\n'));
  writeFileSync(path,readFileSync(path,'utf8')+'x');
  assert.throws(()=>load(options),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
});

test('invalid UTF-8 and duplicate identity fields are denied',t=>{
  const options=fixture(t);
  const path=join(options.baseDir,'spec-first-tdd','SKILL.md');
  writeFileSync(path,Buffer.concat([Buffer.from(identity()),Buffer.from([0xff])]));
  assert.throws(()=>load(options),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
  writeFileSync(path,identity().replace('- ID: spec-first-tdd','- ID: spec-first-tdd\n- ID: spec-first-tdd'));
  assert.throws(()=>load(options),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
});

// Synthetic model/permission receipts below test the gate, never model competence.
// The only executable source is this fixed, reviewed fixture, not LLM output.
const PORT_FIXTURE='export function normalizePort(value){if(typeof value!=="number"&&typeof value!=="string")return null;if(typeof value==="string"){value=value.trim();if(!/^[0-9]+$/.test(value))return null;value=Number(value)}return Number.isInteger(value)&&value>=1&&value<=65535?value:null}';
function capabilityFixture(){
  const calls={inspect:0,model:0,tool:0};
  const observed={mode:'test-fixture',
    model:{id:'test-fixture/no-live-model',available:true,allowed:true,new_cost:0},
    tool:{id:'test-fixture/node-child',available:true,allowed:true,new_cost:0,isolated:true,source_read_only:true},
    permission_receipts:{model:'fixture:model-grant',tool:'fixture:tool-grant'}};
  const host={
    inspect:async()=>{calls.inspect++;return structuredClone(observed)},
    verifyReceipt:async()=>true,
    invokeModel:async request=>{
      calls.model++;
      const response=JSON.stringify({run_id:request.run_id,step_id:request.step_id,source_sha:request.source_sha,skill_context_sha256:request.skill_context_sha256,code:PORT_FIXTURE});
      return {id:'fixture:model-receipt',run_id:request.run_id,source_sha:request.source_sha,model_id:request.model_id,
        prompt_sha256:request.prompt_sha256,response,response_sha256:hash(response)};
    },
    runTool:async input=>{
      calls.tool++;
      assert.equal(input.code,PORT_FIXTURE,'only fixed reviewed test source can execute');
      const script=PORT_FIXTURE+'\nprocess.stdout.write(JSON.stringify({outputs:'+JSON.stringify(input.cases)+'.map(normalizePort)}));';
      const stdout=execFileSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8',timeout:4000,maxBuffer:16384});
      return {id:'fixture:tool-receipt',run_id:input.run_id,tool_id:input.tool_id,source_sha:input.source_sha,
        model_receipt_id:input.model_receipt_id,code_sha256:input.code_sha256,input_sha256:input.input_sha256,
        exit_code:0,stdout,stdout_sha256:hash(stdout)};
    }
  };
  return {host,observed,calls};
}
const canaryInput=host=>({sourceSha:'c'.repeat(40),skills:loadRequiredCodingSkills('G3 source capability canary'),host});

test('no connected runtime adapter produces BLOCKED, with real ACTIVE proof and a prepared one-step prompt',async()=>{
  const receipt=await runCodingSkillCapabilityCanary(canaryInput());
  assert.equal(receipt.status,'BLOCKED');
  assert.equal(receipt.code,'CODING_CANARY_RUNTIME_ADAPTER_UNAVAILABLE');
  assert.equal(receipt.capability_verified,false);assert.equal(receipt.model_invoked,false);assert.equal(receipt.tool_invoked,false);
  assert.equal(receipt.model_id,null);assert.equal(receipt.response,null);
  assert.match(receipt.prompt,/exactly ONE isolated technical step/);
  assert.equal(receipt.prompt_sha256,hash(receipt.prompt));
  assert.ok(receipt.skill_proof[0].content_sha256);
});

test('fixture model plus actual fixed-code Node tool validates 19 cases but never becomes live capability evidence',async()=>{
  const {host,calls}=capabilityFixture();const r=await runCodingSkillCapabilityCanary(canaryInput(host));
  assert.equal(r.status,'FIXTURE_VALIDATED');assert.equal(r.capability_verified,false);
  assert.equal(r.tested_cases,19);assert.equal(r.model_id,'test-fixture/no-live-model');
  assert.equal(r.response_sha256,hash(r.response));
  assert.equal(r.tool_receipt.stdout_sha256,hash(r.tool_receipt.stdout));
  assert.deepEqual(calls,{inspect:1,model:1,tool:1});
});

for(const [name,mutate,code] of [
  ['missing model',o=>{o.model=null},'MODEL_UNAVAILABLE'],
  ['missing model id',o=>{delete o.model.id},'MODEL_UNAVAILABLE'],
  ['blank model id',o=>{o.model.id=' '},'MODEL_UNAVAILABLE'],
  ['nonboolean model availability',o=>{o.model.available='false'},'MODEL_UNAVAILABLE'],
  ['unavailable model',o=>{o.model.available=false},'MODEL_UNAVAILABLE'],
  ['model permission denied',o=>{o.model.allowed=false},'MODEL_PERMISSION_MISSING'],
  ['missing tool',o=>{o.tool=null},'TOOL_UNAVAILABLE'],
  ['missing tool id',o=>{delete o.tool.id},'TOOL_UNAVAILABLE'],
  ['blank tool id',o=>{o.tool.id=' '},'TOOL_UNAVAILABLE'],
  ['nonboolean tool availability',o=>{o.tool.available='true'},'TOOL_UNAVAILABLE'],
  ['unavailable tool',o=>{o.tool.available=false},'TOOL_UNAVAILABLE'],
  ['tool permission denied',o=>{o.tool.allowed=false},'TOOL_PERMISSION_MISSING'],
  ['missing isolation permission',o=>{delete o.tool.isolated},'TOOL_PERMISSION_MISSING'],
  ['source write permitted',o=>{o.tool.source_read_only=false},'TOOL_PERMISSION_MISSING'],
  ['new model cost',o=>{o.model.new_cost=1},'ZERO_COST_UNVERIFIED'],
  ['unknown model cost',o=>{delete o.model.new_cost},'ZERO_COST_UNVERIFIED'],
  ['new tool cost',o=>{o.tool.new_cost=1},'ZERO_COST_UNVERIFIED'],
  ['unknown tool cost',o=>{delete o.tool.new_cost},'ZERO_COST_UNVERIFIED'],
  ['missing grant receipt',o=>{o.permission_receipts=null},'PERMISSION_EVIDENCE_UNVERIFIED'],
  ['missing model grant receipt',o=>{delete o.permission_receipts.model},'PERMISSION_EVIDENCE_UNVERIFIED'],
  ['missing tool grant receipt',o=>{delete o.permission_receipts.tool},'PERMISSION_EVIDENCE_UNVERIFIED'],
  ['blank model grant receipt',o=>{o.permission_receipts.model=' '},'PERMISSION_EVIDENCE_UNVERIFIED'],
  ['unidentified execution mode',o=>{delete o.mode},'PERMISSION_EVIDENCE_UNVERIFIED']
])test('canary blocks before invocation: '+name,async()=>{
  const {host,observed,calls}=capabilityFixture();mutate(observed);
  const r=await runCodingSkillCapabilityCanary(canaryInput(host));
  assert.equal(r.status,'BLOCKED');assert.equal(r.code,'CODING_CANARY_'+code);
  assert.equal(r.capability_verified,false);assert.equal(calls.model,0);assert.equal(calls.tool,0);
});

for(const kind of ['permission','model','tool'])test('unverified '+kind+' transport receipt cannot be replaced by AI assertion',async()=>{
  const {host,calls}=capabilityFixture();host.verifyReceipt=async type=>type!==kind;
  const r=await runCodingSkillCapabilityCanary(canaryInput(host));
  assert.equal(r.status,'BLOCKED');assert.equal(r.capability_verified,false);
  if(kind==='permission')assert.equal(calls.model,0);
  if(kind!=='tool')assert.equal(calls.tool,0);
});

test('missing source SHA, Skill hash, CANDIDATE or incomplete callbacks cannot invoke model',async()=>{
  const {host,calls}=capabilityFixture();
  for(const sourceSha of [undefined,'not-a-commit','a'.repeat(64)]){
    const r=await runCodingSkillCapabilityCanary({...canaryInput(host),sourceSha});
    assert.equal(r.code,'CODING_CANARY_SOURCE_SHA_REQUIRED');
  }
  for(const change of [s=>{delete s.proof[0].context_sha256},s=>{delete s.proof[0].content_sha256},s=>{s.skills[0].state='CANDIDATE'}]){
    const input=canaryInput(host);change(input.skills);
    const r=await runCodingSkillCapabilityCanary(input);assert.equal(r.code,'CODING_STEP_SKILL_EVIDENCE_CHANGED');
  }
  for(const key of ['inspect','invokeModel','runTool','verifyReceipt']){
    const incomplete={...host};delete incomplete[key];
    assert.equal((await runCodingSkillCapabilityCanary(canaryInput(incomplete))).code,'CODING_CANARY_RUNTIME_ADAPTER_UNAVAILABLE');
  }
  assert.equal(calls.model,0);assert.equal(calls.tool,0);
});

for(const [name,mutate] of [
  ['receipt absent',()=>null],['receipt id absent',r=>{delete r.id;return r}],
  ['different model',r=>({...r,model_id:'unapproved-model'})],['replayed run',r=>({...r,run_id:'old-run'})],
  ['different source',r=>({...r,source_sha:'d'.repeat(40)})],
  ['missing prompt hash',r=>{delete r.prompt_sha256;return r}],
  ['missing response hash',r=>{delete r.response_sha256;return r}],
  ['changed response',r=>({...r,response:r.response+' '})],['empty response',r=>({...r,response:'',response_sha256:hash('')})]
])test('model evidence is denied: '+name,async()=>{
  const {host,calls}=capabilityFixture();const invoke=host.invokeModel;
  host.invokeModel=async request=>mutate(await invoke(request));
  const r=await runCodingSkillCapabilityCanary(canaryInput(host));
  assert.equal(r.code,'CODING_CANARY_MODEL_EVIDENCE_INVALID');assert.equal(calls.tool,0);
});

for(const [name,mutate] of [
  ['extra step',r=>({...r,second_step:'unauthorized'})],['AI PASS assertion',r=>({...r,PASS:true})],
  ['different step',r=>({...r,step_id:'G4'})],['different source',r=>({...r,source_sha:'d'.repeat(40)})],
  ['missing Skill hash',r=>{delete r.skill_context_sha256;return r}],['wrong Skill hash',r=>({...r,skill_context_sha256:'a'.repeat(64)})],
  ['no executable code',r=>({...r,code:''})]
])test('model one-step response is denied: '+name,async()=>{
  const {host,calls}=capabilityFixture();const invoke=host.invokeModel;
  host.invokeModel=async request=>{const r=await invoke(request);r.response=JSON.stringify(mutate(JSON.parse(r.response)));r.response_sha256=hash(r.response);return r};
  const r=await runCodingSkillCapabilityCanary(canaryInput(host));
  assert.equal(r.code,'CODING_CANARY_MODEL_RESPONSE_INVALID');assert.equal(calls.tool,0);
});

for(const [name,mutate] of [
  ['receipt absent',()=>null],['receipt id absent',r=>{delete r.id;return r}],
  ['different tool',r=>({...r,tool_id:'unapproved-tool'})],['replayed run',r=>({...r,run_id:'old-run'})],
  ['different source',r=>({...r,source_sha:'d'.repeat(40)})],['different model receipt',r=>({...r,model_receipt_id:'old-model-call'})],
  ['missing input hash',r=>{delete r.input_sha256;return r}],['missing code hash',r=>{delete r.code_sha256;return r}],
  ['missing output hash',r=>{delete r.stdout_sha256;return r}],['changed output',r=>({...r,stdout:r.stdout+' '})],
  ['tool failure',r=>({...r,exit_code:1})]
])test('tool evidence is denied: '+name,async()=>{
  const {host}=capabilityFixture();const run=host.runTool;host.runTool=async input=>mutate(await run(input));
  const r=await runCodingSkillCapabilityCanary(canaryInput(host));
  assert.equal(r.status,'BLOCKED');assert.equal(r.code,'CODING_CANARY_TOOL_EVIDENCE_INVALID');
});

for(const stdout of ['{"PASS":true}','{"outputs":[]}',JSON.stringify({outputs:Array(19).fill(null)}),'not-json'])
  test('AI or tool PASS labels cannot replace independent functional outputs: '+stdout.slice(0,30),async()=>{
    const {host}=capabilityFixture();const run=host.runTool;
    host.runTool=async input=>({...await run(input),stdout,stdout_sha256:hash(stdout)});
    const r=await runCodingSkillCapabilityCanary(canaryInput(host));
    assert.equal(r.code,'CODING_CANARY_FUNCTIONAL_EVIDENCE_INVALID');assert.equal(r.capability_verified,false);
  });

test('adapter errors block without inventing a model response or a tool result',async()=>{
  for(const method of ['inspect','invokeModel','runTool']){
    const {host}=capabilityFixture();host[method]=async()=>{throw Error('simulated transport failure')};
    const r=await runCodingSkillCapabilityCanary(canaryInput(host));
    assert.equal(r.status,'BLOCKED');assert.equal(r.code,'CODING_CANARY_EXECUTION_FAILED');assert.equal(r.capability_verified,false);
  }
});
