import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
// @ts-ignore Standalone JSONPointer module intentionally exports untyped ESM.
import { compile, set, outcome } from '../../projects/rea-reconstruction-lab/d04-pointer-cli/src/pointer.mjs';

// R09-D distinct negative fixture: old valid JSON object/array deletion parity
// does NOT imply safety of deleting a slot in a dense JSON array.
const originalSource = readFileSync(new URL('../../projects/rea-reconstruction-lab/d02-node-jsonpointer/jsonpointer.js', import.meta.url));
const sourceBlob = createHash('sha1')
  .update(Buffer.from('blob ' + originalSource.length + '\0'))
  .update(originalSource).digest('hex');
if (sourceBlob !== 'dad907d763f7369ac0e284e7d1fae2bd5508f477')
  throw Error('R09 pinned MIT source has changed.');
const upstream: Record<string, any> = {};
runInNewContext(originalSource.toString('utf8'), { exports: upstream }, { filename: 'pinned-mit-jsonpointer.js', timeout: 1200 });
const cliPath = fileURLToPath(new URL('../../projects/rea-reconstruction-lab/d04-pointer-cli/bin/rea-pointer-demo.mjs', import.meta.url));

it('R09-D confirms original MIT delete makes array hole; D04 must reject before modifying JSON', () => {
  const original = { items: ['left', 'right'] };
  upstream.set(original, '/items/0', undefined);
  expect(original.items.length).toBe(2);
  expect(Object.hasOwn(original.items, '0')).toBe(false);
  expect(JSON.stringify(original)).toBe('{"items":[null,"right"]}');

  const direct = { items: ['left', 'right'] };
  expect(() => set(direct, '/items/0', undefined)).toThrow('Sparse array deletion forbidden.');
  expect(direct).toEqual({ items: ['left', 'right'] });
  expect(Object.hasOwn(direct.items, '0')).toBe(true);

  const compiled = { items: ['left', 'right'] };
  expect(() => compile('/items/0').set(compiled, undefined)).toThrow('Sparse array deletion forbidden.');
  expect(compiled).toEqual({ items: ['left', 'right'] });
  console.log('GH4780_R09_ARRAY_DELETE_ORIGINAL_HOLE_CONFIRMED|D04_DIRECT_AND_COMPILED_FAIL_CLOSED=2');
});

it('R09-D checks both JSONL operations reject array deletion while preserving response document', () => {
  const rows = [
    { id: 'R09-D01-ARRAY-SET-MISSING-VALUE', op: 'set', document: { items: ['left', 'right'] }, pointer: '/items/0' },
    { id: 'R09-D02-ARRAY-COMPILE-SET-MISSING-VALUE', op: 'compile-set', document: { items: ['left', 'right'] }, pointer: '/items/1' },
    { id: 'R09-D03-MISSING-PARENT-ARRAY', op: 'compile-set', document: {}, pointer: '/items/0' },
  ];
  const expected = rows.map(r => outcome(r));
  for (const result of expected) {
    expect(result).toMatchObject({ outcome: 'error', message: 'Sparse array deletion forbidden.' });
  }
  expect(expected[0].documentAfter).toEqual({ items: ['left', 'right'] });
  expect(expected[1].documentAfter).toEqual({ items: ['left', 'right'] });
  expect(expected[2].documentAfter).toEqual({});

  const run = spawnSync(process.execPath, [cliPath, '--jsonl'], {
    input: rows.map(x => JSON.stringify(x)).join('\n') + '\n',
    encoding: 'utf8', timeout: 9000, maxBuffer: 1024 * 1024,
  });
  expect(run.status, run.stderr).toBe(0); // a structured row error is not malformed JSONL framing
  const actual = run.stdout.trim().split('\n').map(x => JSON.parse(x));
  expect(actual).toEqual(JSON.parse(JSON.stringify(expected)));
  console.log('GH4780_R09_ARRAY_DELETE_JSONL_FAIL_CLOSED=3_OF_3|DOCUMENT_PRESERVED=true');
});
