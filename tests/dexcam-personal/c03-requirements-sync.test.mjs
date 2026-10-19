import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file = p => readFileSync(new URL('../../projects/dexcam-personal/'+p,import.meta.url),'utf8');
const registry=JSON.parse(file('c03-requirements-traceability.json'));
const prd=file('01_PRODUCT_REQUIREMENTS.md'),qa=file('05_QUALITY_ACCEPTANCE.md'),adr=file('07_DECISIONS_RISKS_EXTENSIONS.md');
const rows = prefix => prd.split(/\r?\n/).filter(x=>new RegExp('^\\| '+prefix+'-\\d{3} \\|').test(x)).map(x=>x.split('|').map(s=>s.trim()));
test('C03 exactly matches source FR001..FR018 and NFR001..NFR010 with identical wording',()=>{
  const fr=rows('FR'),nf=rows('NFR');
  assert.equal(fr.length,18);assert.equal(nf.length,10);
  assert.deepEqual(registry.fr.map(r=>r.id),fr.map(x=>x[1]));
  assert.deepEqual(registry.nfr.map(r=>r.id),nf.map(x=>x[1]));
  for(const [i,r] of registry.fr.entries()){
    assert.equal(r.priority,fr[i][2]);assert.equal(r.requirement,fr[i][3]);assert.equal(r.acceptance,fr[i][4]);
  }
  for(const [i,r] of registry.nfr.entries()){
    assert.equal(r.requirement,nf[i][2]);assert.equal(r.acceptance,nf[i][3]);
  }
});
test('C03 references only known planned CAM/DEX tests and never claims executed acceptance',()=>{
  for(const row of [...registry.fr,...registry.nfr]){
    assert.equal(row.test_status,'NOT_RUN');
    for(const id of row.planned_test_ids){
      assert.match(id,/^(CAM|DEX)-\d{2}$/);
      assert.ok(qa.includes('| '+id+' |'),'Missing QA case '+id);
    }
  }
  assert.equal(registry.evidence_status,'SOURCE_REQUIREMENTS_SYNC_ONLY_NOT_TEST_ACCEPTANCE');
});
test('C03 does not invent Owner-approved extensions or device evidence',()=>{
  assert.equal(registry.fr.find(x=>x.id==='FR-018').extension_status,'NO_NEW_FEATURE_APPROVED');
  assert.deepEqual(registry.extensions.approved_new_features,[]);
  assert.ok(adr.includes('ADR-012')&&adr.includes('CHƯA CHỐT'));
  const a=registry.acceptance_boundary;
  for(const k of ['c01','p01','g1','g2','d01','device_tests'])
    assert.match(a[k],/(UNACCEPTED|NOT_ACCEPTED|NOT_STARTED|NOT_RUN)/);
  assert.equal(a.app_built,false);assert.equal(a.issue_done,false);
});
test('C03 sync file does not silently authorize D01, PC01 or Android install',()=>{
  const doc=file('C03_PREIMPLEMENTATION_REQUIREMENTS_SYNC_20261018.md');
  for(const id of ['FR-001','FR-018','NFR-001','NFR-010']) assert.ok(doc.includes(id));
  assert.ok(doc.includes('không')&&doc.includes('D01'));
});
