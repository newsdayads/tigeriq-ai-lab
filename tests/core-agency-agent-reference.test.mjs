import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  AGENCY_CATALOG_PIN, AGENCY_ROLE_REFERENCES, agencyGitBlobSha,
  selectAgencyRoleReferences, loadAgencyRoleReferences,
} from '../apps/tigeriq-core/agency-agent-reference.mjs';
import { readFileSync } from 'node:fs';

test('selects bounded relevant source roles, not every upstream persona',()=>{
  assert.deepEqual(selectAgencyRoleReferences('backend API fix').map(x=>x.id),['backend-architect']);
  assert.deepEqual(selectAgencyRoleReferences('QA review acceptance release').map(x=>x.id),['evidence-collector','reality-checker']);
  assert.equal(selectAgencyRoleReferences('unrelated general chat').length,0);
  assert.equal(AGENCY_ROLE_REFERENCES.length,4);
});
test('refuses missing catalog and floating/mismatched upstream revision',()=>{
  assert.equal(loadAgencyRoleReferences('QA review',{catalogRoot:join(tmpdir(),'tigeriq-agency-not-here')}).status,'CATALOG_NOT_INSTALLED');
  const dir=mkdtempSync(join(tmpdir(),'tigeriq-agency-pin-'));
  try{
    mkdirSync(join(dir,'.git'));
    writeFileSync(join(dir,'.git','HEAD'),'ref: refs/heads/main\n');
    assert.equal(loadAgencyRoleReferences('QA review',{catalogRoot:dir}).status,'CATALOG_PIN_MISMATCH');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('uses only immutable blob-verified references with unchanged Core authority',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tigeriq-agency-fixture-'));
  const content=Buffer.from('# Evidence Collector\nActual evidence over claims.\n');
  const ref={id:'fixture-qa',file:'testing/evidence.md',blob:agencyGitBlobSha(content),match:/QA/,guidance:'Tie claims to evidence.'};
  try{
    mkdirSync(join(dir,'.git'));
    mkdirSync(join(dir,'testing'));
    writeFileSync(join(dir,'.git','HEAD'),AGENCY_CATALOG_PIN);
    writeFileSync(join(dir,'testing','evidence.md'),content);
    const output=loadAgencyRoleReferences('QA',{catalogRoot:dir,references:[ref]});
    assert.equal(output.status,'PINNED_REFERENCE_VERIFIED');
    assert.equal(output.references.length,1);
    assert.match(output.contextBlock,/read-only advisory/);
    assert.match(output.contextBlock,/Tie claims to evidence/);
    assert.doesNotMatch(output.contextBlock,/run upstream scripts as privileged/);
    writeFileSync(join(dir,'testing','evidence.md'),'CHANGED');
    assert.equal(loadAgencyRoleReferences('QA',{catalogRoot:dir,references:[ref]}).status,'AGENT_SOURCE_HASH_MISMATCH');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('skill loader only adds references behind a real ACTIVE skill',()=>{
  const src=readFileSync(new URL('../apps/tigeriq-core/skill-loader.mjs',import.meta.url),'utf8');
  assert.match(src,/const agencyCandidate = ranked\.length && maxSkills > 0 \? loadAgencyRoleReferences/);
  assert.match(src,/const agencyReservedChars = agencyCandidate\.contextBlock\.length/);
  assert.match(src,/const skillBudget = agencyReservedChars/);
  assert.match(src,/loaded\.length \? agencyCandidate/);
  assert.match(src,/agencyReferences: agencyBlock \? agency\.references : \[\]/);
  assert.match(src,/maxChars - totalChars/);
  assert.match(src,/\.filter\(skill => skill\.state === 'ACTIVE'\)/);
});
