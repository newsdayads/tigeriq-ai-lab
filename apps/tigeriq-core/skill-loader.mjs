import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE=dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SKILL_REGISTRY=resolve(HERE,'../../docs/skills/registry.yaml');
export const DEFAULT_SKILL_ROOT=resolve(HERE,'../../docs/skills');
const DEFAULT_MAX_SKILLS=3;
const DEFAULT_MAX_CHARS=6000;

export function parseSkillRegistryText(raw){
  const parsed=JSON.parse(String(raw||''));
  if(!parsed||typeof parsed!=='object'||!Array.isArray(parsed.skills))throw new Error('SKILL_REGISTRY_INVALID_STRUCTURE');
  return parsed;
}

export function loadSkillRegistry(registryPath=DEFAULT_SKILL_REGISTRY){
  return parseSkillRegistryText(readFileSync(registryPath,'utf8'));
}

function normalizedTokens(value){
  return String(value||'').toLowerCase().split(/[^a-z0-9_-]+/).map(x=>x.trim()).filter(x=>x.length>=3);
}

function relevanceScore(skill,objective){
  const haystack=normalizedTokens(objective);
  if(!haystack.length)return 0;
  const needles=[
    ...(Array.isArray(skill?.triggers)?skill.triggers:[]),
    skill?.id,skill?.title,skill?.target
  ].flatMap(normalizedTokens);
  const unique=new Set(needles);
  let score=0;
  for(const token of haystack)if(unique.has(token))score+=3;
  const objectiveText=String(objective||'').toLowerCase();
  for(const trigger of Array.isArray(skill?.triggers)?skill.triggers:[]){
    const t=String(trigger||'').trim().toLowerCase();
    if(t.length>=3&&objectiveText.includes(t))score+=5;
  }
  return score;
}

function compactSkillText(skill,content,maxChars){
  const header=`[${skill.id}] ${skill.title||skill.id} — target=${skill.target||'general'}`;
  const available=Math.max(0,maxChars-header.length-1);
  return `${header}\n${String(content||'').slice(0,available)}`.trim();
}

export function loadRelevantActiveSkillContext(objective,options={}){
  const registryPath=options.registryPath||DEFAULT_SKILL_REGISTRY;
  const skillRoot=options.skillRoot||DEFAULT_SKILL_ROOT;
  const maxSkills=Math.max(1,Math.min(3,Number(options.maxSkills||DEFAULT_MAX_SKILLS)));
  const maxChars=Math.max(256,Number(options.maxChars||DEFAULT_MAX_CHARS));
  try{
    const registry=loadSkillRegistry(registryPath);
    const ranked=registry.skills
      .filter(skill=>skill&&skill.state==='ACTIVE'&&skill.id)
      .map(skill=>({skill,score:relevanceScore(skill,objective)}))
      .filter(item=>item.score>0)
      .sort((a,b)=>b.score-a.score||String(a.skill.id).localeCompare(String(b.skill.id)));

    const selected=[],skipped=[];
    let remaining=maxChars;
    for(const {skill} of ranked){
      if(selected.length>=maxSkills)break;
      const skillPath=resolve(skillRoot,String(skill.id),'SKILL.md');
      if(!existsSync(skillPath)){skipped.push({id:skill.id,reason:'SKILL_MD_MISSING'});continue;}
      const raw=readFileSync(skillPath,'utf8');
      const text=compactSkillText(skill,raw,remaining);
      if(!text||text.length>remaining){skipped.push({id:skill.id,reason:'CONTEXT_BUDGET'});continue;}
      selected.push({id:skill.id,text});
      remaining-=text.length+(selected.length>1?2:0);
    }
    const text=selected.map(x=>x.text).join('\n\n');
    return {text,skillIds:selected.map(x=>x.id),bytes:Buffer.byteLength(text,'utf8'),skipped,error:null};
  }catch(error){
    return {text:'',skillIds:[],bytes:0,skipped:[],error:String(error?.message||error)};
  }
}
