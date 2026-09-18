import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error runtime module is JavaScript and intentionally has no TypeScript declaration file.
import {loadRelevantActiveSkillContext,parseSkillRegistryText} from '../apps/tigeriq-core/skill-loader.mjs';

function fixture(skills:any[]){
  const root=mkdtempSync(join(tmpdir(),'tigeriq-skill-'));
  const registryPath=join(root,'registry.yaml');
  const skillRoot=join(root,'skills');
  mkdirSync(skillRoot,{recursive:true});
  writeFileSync(registryPath,JSON.stringify({version:1,skills}), 'utf8');
  return {root,registryPath,skillRoot};
}
function addSkill(root:string,id:string,content:string){
  const dir=join(root,id);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'SKILL.md'),content,'utf8');
}

describe('active skill loader',()=>{
  it('fails closed on malformed registry',()=>{
    const f=fixture([]);writeFileSync(f.registryPath,'not-json','utf8');
    const result=loadRelevantActiveSkillContext('routing model',{registryPath:f.registryPath,skillRoot:f.skillRoot});
    expect(result.skillIds).toEqual([]);expect(result.text).toBe('');expect(result.error).toBeTruthy();
    rmSync(f.root,{recursive:true,force:true});
  });

  it('loads ACTIVE relevant skills but never CANDIDATE or irrelevant ACTIVE',()=>{
    const f=fixture([
      {id:'active-routing',title:'Routing',state:'ACTIVE',target:'router',triggers:['routing','model']},
      {id:'candidate-routing',title:'Candidate',state:'CANDIDATE',target:'router',triggers:['routing']},
      {id:'active-unrelated',title:'Billing',state:'ACTIVE',target:'billing',triggers:['invoice']}
    ]);
    addSkill(f.skillRoot,'active-routing','# Routing\nroute models');
    addSkill(f.skillRoot,'candidate-routing','# Candidate');
    addSkill(f.skillRoot,'active-unrelated','# Billing');
    const result=loadRelevantActiveSkillContext('route model by routing capability',{registryPath:f.registryPath,skillRoot:f.skillRoot});
    expect(result.skillIds).toEqual(['active-routing']);
    expect(result.text).not.toContain('Candidate');
    expect(result.text).not.toContain('Billing');
    rmSync(f.root,{recursive:true,force:true});
  });

  it('skips ACTIVE skills without SKILL.md',()=>{
    const f=fixture([{id:'missing',state:'ACTIVE',title:'Missing',target:'router',triggers:['routing']}]);
    const result=loadRelevantActiveSkillContext('routing',{registryPath:f.registryPath,skillRoot:f.skillRoot});
    expect(result.skillIds).toEqual([]);
    expect(result.skipped).toEqual([{id:'missing',reason:'SKILL_MD_MISSING'}]);
    rmSync(f.root,{recursive:true,force:true});
  });

  it('enforces max 3 skills and context budget',()=>{
    const skills=Array.from({length:5},(_,i)=>({id:`s${i}`,state:'ACTIVE',title:`S${i}`,target:'routing',triggers:['routing']}));
    const f=fixture(skills);for(const s of skills)addSkill(f.skillRoot,s.id,'x'.repeat(500));
    const result=loadRelevantActiveSkillContext('routing',{registryPath:f.registryPath,skillRoot:f.skillRoot,maxSkills:3,maxChars:1200});
    expect(result.skillIds.length).toBeLessThanOrEqual(3);
    expect(result.bytes).toBeLessThanOrEqual(1200);
    rmSync(f.root,{recursive:true,force:true});
  });

  it('registry on main promotes exactly two learned skills',()=>{
    const registry=parseSkillRegistryText(readFileSync('docs/skills/registry.yaml','utf8'));
    const active=registry.skills.filter((s:any)=>s.state==='ACTIVE').map((s:any)=>s.id).sort();
    expect(active).toEqual(['capability-aware-model-routing','role-separated-execution']);
    expect(registry.skills.filter((s:any)=>s.state==='CANDIDATE')).toHaveLength(6);
  });

  it('Core injects only loader output into manager context and emits evidence',()=>{
    const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
    expect(core).toContain("loadRelevantActiveSkillContext");
    expect(core).toContain("ACTIVE_SKILLS_LOADED");
    expect(core).toContain("ACTIVE_SKILLS_FAIL_CLOSED");
    expect(core).toContain("Relevant ACTIVE skills (apply only when relevant)");
  });
});
