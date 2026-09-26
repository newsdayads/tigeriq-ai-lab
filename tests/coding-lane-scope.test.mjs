import {test as vitestTest} from 'vitest';
const test=(name,fn)=>vitestTest(name,async()=>{const t={test:async(_name,subfn)=>subfn(t)};return fn(t)});
import assert from 'node:assert';
import {CodingScopeViolationError,parseCompactEditJson,salvageCompactEditsJson,validateJobScope,validateSourceScope} from '../apps/tigeriq-coding-lane/coding-lane.mjs';
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

  await t.test('parses ALLOW_PATH_PREFIX and preserves exact-vs-directory semantics',()=>{
    const objective='ALLOW_PATH_PREFIX=apps/x/file.mjs,tests/\n\n## GOAL\nScoped change';
    const canonical=extractCanonicalAllowedPaths(objective);
    assert.deepStrictEqual(canonical,['apps/x/file.mjs','tests/']);
    assert.strictEqual(validateSourceScope(['apps/x/file.mjs'],canonical),true);
    assert.throws(()=>validateSourceScope(['apps/x/file.mjs/evil.js'],canonical),e=>e instanceof CodingScopeViolationError&&e.offending[0]==='apps/x/file.mjs/evil.js');
    assert.strictEqual(validateSourceScope(['tests/example.test.mjs'],canonical),true);
    assert.throws(()=>validateSourceScope(['src/unrelated.mjs'],canonical),e=>e instanceof CodingScopeViolationError&&e.offending[0]==='src/unrelated.mjs');
  });

  await t.test('rejects unsafe or wildcard ALLOW_PATH_PREFIX widening',()=>{
    assert.deepStrictEqual(extractCanonicalAllowedPaths('ALLOW_PATH_PREFIX=../escape,tests/*,tests/'),['tests/']);
  });


  await t.test('salvages complete compact edits from a truncated JSON response',()=>{
    const broken='{"summary":"partial","edits":[{"path":"apps/tigeriq-coding-lane/coding-lane.mjs","search":"old","replace":"new"},{"path":"tests/coding-lane-scope.test.mjs","search":"unterminated';
    assert.deepStrictEqual(salvageCompactEditsJson(broken),{
      summary:'salvaged complete compact edits from truncated model response',
      edits:[{path:'apps/tigeriq-coding-lane/coding-lane.mjs',search:'old',replace:'new'}],
    });
    assert.deepStrictEqual(parseCompactEditJson(broken),{
      summary:'partial',
      edits:[{path:'apps/tigeriq-coding-lane/coding-lane.mjs',search:'old',replace:'new'}],
    });
  });

  await t.test('does not salvage incomplete first edit',()=>{
    assert.throws(()=>parseCompactEditJson('{"edits":[{"path":"x","search":"unterminated'),/JSON_OBJECT_/);
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
