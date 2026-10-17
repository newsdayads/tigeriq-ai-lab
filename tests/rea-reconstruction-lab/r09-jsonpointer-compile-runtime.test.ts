import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
// @ts-ignore JSON Pointer demo intentionally ships standalone plain ESM.
import { compile, outcome } from '../../projects/rea-reconstruction-lab/d04-pointer-cli/src/pointer.mjs';

// R09-C: new compile closure coverage, not a replay of R09-T01..T14 or D04 J/K cases.
const sourcePath = new URL('../../projects/rea-reconstruction-lab/d02-node-jsonpointer/jsonpointer.js', import.meta.url);
const cli = fileURLToPath(new URL('../../projects/rea-reconstruction-lab/d04-pointer-cli/bin/rea-pointer-demo.mjs', import.meta.url));
const source = readFileSync(sourcePath);
const blob = createHash('sha1').update(Buffer.from('blob ' + source.length + '\0')).update(source).digest('hex');
if (blob !== 'dad907d763f7369ac0e284e7d1fae2bd5508f477')
  throw new Error('Original MIT jsonpointer source digest drift');
const original: Record<string, any> = {};
runInNewContext(source.toString('utf8'), { exports: original }, { filename: 'pinned-mit-jsonpointer.js', timeout: 1200 });
const json = (value: any) => JSON.parse(JSON.stringify(value));

const cases: any[] = [
  { id: 'RC01_COMPILE_ESCAPED_GET', op: 'compile-get', document: { 'a/b': { 't~': 3 } }, pointer: '/a~1b/t~0' },
  { id: 'RC02_COMPILE_ARRAY_FORM_GET', op: 'compile-get', document: { list: [{ k: 1 }, { k: 9 }] }, pointer: ['', 'list', 1, 'k'] },
  { id: 'RC03_COMPILE_ROOT_GET', op: 'compile-get', document: { x: 1 }, pointer: '' },
  { id: 'RC04_COMPILE_EMPTY_ARRAY_GET', op: 'compile-get', document: { x: 2 }, pointer: [] },
  { id: 'RC05_COMPILE_APPEND_SET', op: 'compile-set', document: { list: [3] }, pointer: '/list/-', value: 4 },
  { id: 'RC06_COMPILE_ESCAPED_SET', op: 'compile-set', document: { 'a/b': { 'k~': 1 } }, pointer: '/a~1b/k~0', value: 7 },
  { id: 'RC07_COMPILE_DELETE_SET', op: 'compile-set', document: { a: 1, b: 2 }, pointer: '/a' },
  { id: 'RC08_COMPILE_DECODE_ONCE', op: 'compile-get', document: { 'a~1b': 4, 'a/b': 5 }, pointer: ['', 'a~01b'] },
  { id: 'RC09_COMPILE_NESTED_CREATE', op: 'compile-set', document: {}, pointer: '/a/0/x', value: 9 },
  { id: 'RC10_COMPILE_ARRAY_NUMBER_SET', op: 'compile-set', document: { items: [{ x: 1 }] }, pointer: ['', 'items', 0, 'x'], value: 4 },
];

function originalResult(test: any) {
  const doc = structuredClone(test.document);
  try {
    const bound = original.compile(test.pointer);
    const result = test.op === 'compile-get' ? bound.get(doc) : bound.set(doc, test.value);
    return {
      id: test.id,
      outcome: 'ok',
      returned: result === undefined ? { $type: 'undefined' } : result,
      documentAfter: doc,
    };
  } catch (e: any) {
    return { id: test.id, outcome: 'error', name: e.name, message: e.message, documentAfter: doc };
  }
}

it('R09-C verifies ten fresh compile-bound get/set cases against original pinned MIT closures and real JSONL CLI', () => {
  expect(new Set(cases.map(p => p.id)).size).toBe(10);
  expect(typeof original.compile).toBe('function');
  const expected = cases.map(p => json(originalResult(p)));
  expect(expected.every(p => p.outcome === 'ok')).toBe(true);
  expect(expected.find(x => x.id === 'RC04_COMPILE_EMPTY_ARRAY_GET')?.returned).toEqual({ $type: 'undefined' });
  expect(expected.find(x => x.id === 'RC08_COMPILE_DECODE_ONCE')?.returned).toBe(4);
  expect(expected.find(x => x.id === 'RC07_COMPILE_DELETE_SET')?.documentAfter).toEqual({ b: 2 });
  expect(cases.map(p => json(outcome(p)))).toEqual(expected);

  const run = spawnSync(process.execPath, [cli, '--jsonl'], {
    input: cases.map(x => JSON.stringify(x)).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 9000,
    maxBuffer: 1024 * 1024,
  });
  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout.trim().split('\n').map(x => JSON.parse(x))).toEqual(expected);
  const digest = createHash('sha256').update(JSON.stringify(expected)).digest('hex');
  console.log('GH4780_R09_COMPILE_ORIGINAL_CLOSURES_CLI=10_OF_10|SHA256=' + digest);
});

it('R09-C retains safe compiled pointer snapshots, and rejects traversal / sparse writes without mutation', () => {
  const pointer = ['', 'a~01b'];
  const saved = compile(pointer);
  pointer[1] = 'wrong';
  expect(saved.get({ 'a~1b': 8 })).toBe(8);

  const unsafe = outcome({ id: 'RC-S1', op: 'compile-get', document: { a: 1 }, pointer: '/constructor' });
  expect(unsafe).toMatchObject({ outcome: 'error', message: 'Unsafe JSON pointer segment.' });

  const sparse = outcome({ id: 'RC-S2', op: 'compile-set', document: { list: [1] }, pointer: '/list/10', value: 9 });
  expect(sparse).toMatchObject({ outcome: 'error', documentAfter: { list: [1] } });

  const invalid = outcome({ id: 'RC-S3', op: 'compile-get', document: { x: 1 }, pointer: 'no-leading-slash' });
  expect(invalid).toMatchObject({ outcome: 'error', message: 'Invalid JSON pointer.' });

  // Functions remain strictly in JS; the JSONL surface does not serialize closures.
  const noFunctionEncoding = outcome({ id: 'RC-S4', op: 'compile', document: {}, pointer: '/x' });
  expect(noFunctionEncoding).toMatchObject({ outcome: 'error', message: 'Unsupported operation.' });
  console.log('GH4780_R09_COMPILE_SECURITY_EXCLUSIONS=4|CLOSURE_JSON_SERIALIZATION=FORBIDDEN');
});
