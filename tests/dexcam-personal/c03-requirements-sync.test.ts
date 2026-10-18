import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const read = (name:string) => readFileSync(new URL('../../projects/dexcam-personal/'+name,import.meta.url),'utf8');
const trace=JSON.parse(read('c03-requirements-traceability.json'));
const prd=read('01_PRODUCT_REQUIREMENTS.md'),qa=read('05_QUALITY_ACCEPTANCE.md');
const rows = (key:string) => prd.split(/\r?\n/).filter(x=>new RegExp('^\\| '+key+'-\\d{3} \\|').test(x)).map(x=>x.split('|').map(s=>s.trim()));
it('C03 captures every canonical FR/NFR identifier, wording and acceptance condition',()=>{
  const fr=rows('FR'),nf=rows('NFR');
  expect([trace.fr.length,trace.nfr.length]).toEqual([18,10]);
  expect(trace.fr.map((x:any)=>[x.id,x.priority,x.requirement,x.acceptance]))
    .toEqual(fr.map(x=>[x[1],x[2],x[3],x[4]]));
  expect(trace.nfr.map((x:any)=>[x.id,x.requirement,x.acceptance]))
    .toEqual(nf.map(x=>[x[1],x[2],x[3]]));
});
it('C03 preserves planned-test-only provenance without faking device PASS or extensions',()=>{
  for(const row of [...trace.fr,...trace.nfr]){
    expect(row.test_status).toBe('NOT_RUN');
    for(const id of row.planned_test_ids)expect(qa).toContain('| '+id+' |');
  }
  expect(trace.extensions.approved_new_features).toEqual([]);
  expect(trace.fr.find((x:any)=>x.id==='FR-018').extension_status).toBe('NO_NEW_FEATURE_APPROVED');
  expect(trace.acceptance_boundary.app_built).toBe(false);
  expect(trace.acceptance_boundary.issue_done).toBe(false);
  expect(trace.acceptance_boundary.g1).toBe('NOT_ACCEPTED');
  expect(trace.acceptance_boundary.g2).toBe('NOT_ACCEPTED');
});
