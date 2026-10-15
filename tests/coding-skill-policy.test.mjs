import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadRequiredCodingSkills,assertCodingSkillProof} from '../apps/tigeriq-coding-lane/coding-skill-policy.mjs';

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
    writeFileSync(registryPath,entry('ACTIVE'));
    const real=loadRequiredCodingSkills('coding',{registryPath,baseDir:dir});
    assert.ok(real.contextBlock.includes('Candidate — does not grant execution'));
    assert.equal(real.proof.length,1);
    writeFileSync(join(dir,'spec-first-tdd','SKILL.md'),'');
    assert.throws(()=>loadRequiredCodingSkills('coding',{registryPath,baseDir:dir}),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('unknown mandatory skill fails instead of silently routing generic coder',()=>{
  assert.throws(()=>loadRequiredCodingSkills('implement backend',{requiredIds:['unknown-skill-id']}),/CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED/);
});
