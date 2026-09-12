import test from 'node:test';
import assert from 'node:assert';
import {CodingScopeViolationError,validateJobScope,validateSourceScope} from '../apps/tigeriq-coding-lane/coding-lane.mjs';
import {extractCanonicalAllowedPaths} from '../apps/tigeriq-coding-lane/policy.mjs';

test('coding lane scope validation tests',async(t)=>{
  const allowedPaths=['apps/tigeriq-coding-lane/coding-lane.mjs','apps/tigeriq-coding-lane/policy.mjs','tests/coding-lane-scope.test.mjs','tests/coding-lane-foundation.test.mjs'];

  await t.test('extracts canonical paths from source objective',()=>{
    const objective='## Exact hard scope\nAllowed paths ONLY:\n- apps/tigeriq-coding-lane/coding-lane.mjs\n- `tests/coding-lane-scope.test.mjs`\n\n## Implement\nDo work';
    assert.deepStrictEqual(extractCanonicalAllowedPaths(objective),['apps/tigeriq-coding-lane/coding-lane.mjs','tests/coding-lane-scope.test.mjs']);
  });

  await t.test('extracts inline bullet hard-scope contract',()=>{
    const objective='- Exact hard scope: apps/tigeriq-core/core.mjs; tests/rotating-idle-auditor.test.ts. If needed keep prose after it.\n- Do not broaden scope';
    assert.deepStrictEqual(extractCanonicalAllowedPaths(objective),['apps/tigeriq-core/core.mjs','tests/rotating-idle-auditor.test.ts']);
  });

  await t.test('allowed-only candidate passes',()=>{
    assert.strictEqual(validateSourceScope(['apps/tigeriq-coding-lane/policy.mjs'],allowedPaths),true);
    assert.strictEqual(validateJobScope(allowedPaths,[{path:'apps/tigeriq-coding-lane/policy.mjs',content:'x'}]),true);
  });

  await t.test('source manager scope expansion fails closed',()=>{
    assert.throws(()=>validateSourceScope(['apps/tigeriq-coding-lane/policy.mjs','unauthorized/extra.mjs'],allowedPaths),e=>e instanceof CodingScopeViolationError&&e.code==='CODING_SCOPE_VIOLATION'&&e.offending[0]==='unauthorized/extra.mjs');
  });

  await t.test('generated extra path fails closed',()=>{
    const changes=[{path:'apps/tigeriq-coding-lane/coding-lane.mjs',content:'ok'},{path:'unauthorized/secret-file.js',content:'bad'}];
    assert.throws(()=>validateJobScope(allowedPaths,changes),e=>e instanceof CodingScopeViolationError&&e.code==='CODING_SCOPE_VIOLATION');
  });

  await t.test('no write or PR continuation occurs after violation',async()=>{
    let writeCalled=false,prCreated=false;
    try{
      validateJobScope(allowedPaths,[{path:'unauthorized/path.js',content:'hack'}]);
      writeCalled=true;
      prCreated=true;
    }catch(e){assert.ok(e instanceof CodingScopeViolationError)}
    assert.strictEqual(writeCalled,false);
    assert.strictEqual(prCreated,false);
  });
});
