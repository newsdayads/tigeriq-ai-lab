import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Audited advisory references only, not agents, commands, tool permissions,
// a second Registry, or an external execution queue.
export const AGENCY_CATALOG_PIN = 'b37b5bb33b78f2c1d6567d98e25ca818e3259219';
const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)), '..', '..', 'Sources', 'agency-agents');

export const AGENCY_ROLE_REFERENCES = Object.freeze([
  {
    id:'senior-project-manager',
    file:'project-management/project-manager-senior.md',
    blob:'52bb3a7012fb249e30a2d2f6ae3ed3287e6024d1',
    match:/\b(plan|planning|scope|sprint|project|manager|milestone|decompose)\b|kế hoạch|phân rã/i,
    guidance:'Translate the exact owner specification into one small deliverable, scope, acceptance criteria and explicit blockers; never invent requirements.',
  },
  {
    id:'backend-architect',
    file:'engineering/engineering-backend-architect.md',
    blob:'f3731dd50da10c71d2c40a5ff319d7984afe7efd',
    match:/\b(core|backend|api|database|architecture|schema|coding|implementation|fix|bug)\b|mã nguồn|sửa lỗi|lập trình/i,
    guidance:'Prefer a small compatible change. Preserve existing API/schema, lease/idempotency, timeouts, retry budgets and security boundaries; verify with executable tests.',
  },
  {
    id:'evidence-collector',
    file:'testing/testing-evidence-collector.md',
    blob:'321ce36bd2586254b0d7194c5f62965204170532',
    match:/\b(qa|review|test|testing|evidence|screenshot|verify|acceptance)\b|kiểm thử|bằng chứng|nghiệm thu/i,
    guidance:'Bind each feature claim to an actual artifact, assertion, receipt or screenshot. Visual proof does not prove persistence or behavior; identify untested scope.',
  },
  {
    id:'reality-checker',
    file:'testing/testing-reality-checker.md',
    blob:'e534cfbd20d3115d5265387f19db7d3b25649421',
    match:/\b(release|publish|deploy|production|integration|gate|verification|acceptance)\b|phát hành|nghiệm thu/i,
    guidance:'Cross-check source, test results, installed runtime and user journey before accepting DONE. State PASS only for verified criteria; report blockers without fabricated failures.',
  },
]);

export function agencyGitBlobSha(buffer) {
  const bytes=Buffer.isBuffer(buffer)?buffer:Buffer.from(String(buffer),'utf8');
  return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}

export function selectAgencyRoleReferences(objective, limit=2, references=AGENCY_ROLE_REFERENCES) {
  const text=String(objective||'');
  const bounded=Math.max(0,Math.min(2,Number(limit)||0));
  return references.filter(ref=>ref.match.test(text)).slice(0,bounded);
}

export function loadAgencyRoleReferences(objective, options={}) {
  const roles=selectAgencyRoleReferences(objective,options.maxRoles??2,options.references||AGENCY_ROLE_REFERENCES);
  if(!roles.length)return {status:'NOT_RELEVANT',contextBlock:'',references:[]};
  const root=resolve(options.catalogRoot||process.env.TIGERIQ_AGENCY_AGENTS_ROOT||ROOT);
  const pin=options.pin||AGENCY_CATALOG_PIN; // explicit overrides only for isolated tests
  if(!existsSync(root))return {status:'CATALOG_NOT_INSTALLED',contextBlock:'',references:[]};
  let head;
  try{head=readFileSync(join(root,'.git','HEAD'),'utf8').trim();}
  catch{return {status:'CATALOG_HEAD_UNREADABLE',contextBlock:'',references:[]};}
  if(head!==pin)return {status:'CATALOG_PIN_MISMATCH',contextBlock:'',references:[]};
  const verified=[];
  for(const ref of roles){
    const path=join(root,...ref.file.split('/'));
    let bytes;
    try{bytes=readFileSync(path);}
    catch{return {status:'AGENT_SOURCE_UNREADABLE',contextBlock:'',references:[]};}
    if(agencyGitBlobSha(bytes)!==ref.blob)return {status:'AGENT_SOURCE_HASH_MISMATCH',contextBlock:'',references:[]};
    verified.push({id:ref.id,source:ref.file,blob:ref.blob,pin});
  }
  // Curated, bounded operational hints instead of injecting third-party
  // commands/permissions/identity into privileged Core execution packets.
  const lines=['AGENCY ROLE REFERENCE (read-only advisory; existing TigerIQ Core policies and acceptance gates take precedence):'];
  for(const ref of roles)lines.push('['+ref.id+' at '+ref.file+'] '+ref.guidance);
  lines.push('Do not run upstream scripts or create agent identities. A persona is not an available worker or a verified result.');
  return {status:'PINNED_REFERENCE_VERIFIED',contextBlock:lines.join('\n'),references:verified};
}
