import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMutationEnvelope,wrapPatch,wrapCreate} from '../apps/tigeriq-coding-lane/envelope.mjs';

test('mutation envelope preserves raw UTF-8 source exactly',()=>{
  const old='const s = "a\\\\b";\r\n\tconst u = "Tiếng Việt 🐯";\r\n';
  const next='const s = `x\\\\y`;\r\n\tconst u = "Việt Nam ✅";\r\n';
  const created='export const text = "quotes: \\\" and slash \\\\";\n';
  const parsed=parseMutationEnvelope(wrapPatch('apps/demo/a.mjs',old,next)+'\n'+wrapCreate('tests/demo.test.mjs',created));
  assert.deepEqual(parsed.edits,[{path:'apps/demo/a.mjs',old,new:next}]);
  assert.deepEqual(parsed.creates,[{path:'tests/demo.test.mjs',content:created}]);
});

test('mutation envelope rejects malformed, duplicate create, and create/edit collision',()=>{
  assert.throws(()=>parseMutationEnvelope('not-an-envelope'),/MUTATION_ENVELOPE/);
  assert.throws(()=>parseMutationEnvelope(wrapCreate('a.mjs','x')+'\n'+wrapCreate('a.mjs','y')),/DUPLICATE_CREATE/);
  assert.throws(()=>parseMutationEnvelope(wrapPatch('a.mjs','x','y')+'\n'+wrapCreate('a.mjs','z')),/CREATE_EDIT_COLLISION/);
});
