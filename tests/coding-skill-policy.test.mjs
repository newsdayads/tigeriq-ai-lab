import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadRequiredCodingSkills,assertCodingSkillProof,requiredCodingSkillIdsForDeliverable} from '../apps/tigeriq-coding-lane/coding-skill-policy.mjs';
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
