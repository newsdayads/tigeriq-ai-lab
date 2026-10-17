import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const directory = new URL('./', import.meta.url);
export const UPSTREAM = Object.freeze({
  repository: 'janl/node-jsonpointer',
  tag: 'v5.0.1',
  commit: '4a253c0d8f0d4d7f4c01f566bf8bf16f775dcdca',
  sourceBlob: 'dad907d763f7369ac0e284e7d1fae2bd5508f477',
  licenseBlob: 'ac32f5dfdd49682b416374dcbed58a7f17fa4e24',
  packageVersionAtTag: '5.0.0',
});

const cases = [
  { id: 'J01_NESTED_GET', op: 'get', document: { a: { b: 7 } }, pointer: '/a/b' },
  { id: 'J02_ESCAPED_SLASH_GET', op: 'get', document: { 'a/b': 12 }, pointer: '/a~1b' },
  { id: 'J03_ESCAPED_TILDE_GET', op: 'get', document: { 'm~n': 'tilde' }, pointer: '/m~0n' },
  { id: 'J04_MISSING_GET', op: 'get', document: { a: 1 }, pointer: '/missing' },
  { id: 'J05_SET_REPLACE', op: 'set', document: { a: 1 }, pointer: '/a', value: 9 },
  { id: 'J06_SET_NESTED_ARRAY', op: 'set', document: {}, pointer: '/items/0/name', value: 'Lin' },
  { id: 'J07_SET_ARRAY_APPEND', op: 'set', document: { items: [1] }, pointer: '/items/-', value: 2 },
  { id: 'J08_SET_ESCAPED_SLASH', op: 'set', document: { 'a/b': 2 }, pointer: '/a~1b', value: 5 },
  { id: 'J09_BAD_RELATIVE_POINTER', op: 'get', document: { a: 1 }, pointer: 'a' },
  { id: 'J10_BAD_INPUT_OBJECT', op: 'get', document: 42, pointer: '/a' },
];

function gitBlobSha(bytes) {
  const normalized = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha1').update(Buffer.from('blob ' + normalized.length + '\0')).update(normalized).digest('hex');
}
function asValue(value) { return value === undefined ? { $type: 'undefined' } : value; }
function originalModule() {
  const source = readFileSync(new URL('./jsonpointer.js', directory));
  const license = readFileSync(new URL('./LICENSE.md', directory));
  assert.equal(gitBlobSha(source), UPSTREAM.sourceBlob, 'original source Git blob mismatch');
  assert.equal(gitBlobSha(license), UPSTREAM.licenseBlob, 'original MIT license Git blob mismatch');
  const exports = Object.create(null);
  // Isolated original CommonJS source: no require, process or filesystem globals.
  runInNewContext(source.toString('utf8'), { exports }, { timeout: 1000, filename: 'jsonpointer.js' });
  assert.equal(typeof exports.get, 'function');
  assert.equal(typeof exports.set, 'function');
  return exports;
}
export function executeOriginalCases() {
  const api = originalModule();
  const rows = cases.map(test => {
    const obj = structuredClone(test.document);
    try {
      const value = test.op === 'get' ? api.get(obj, test.pointer) : api.set(obj, test.pointer, test.value);
      return { id: test.id, outcome: 'ok', returned: asValue(value), documentAfter: obj };
    } catch (error) {
      return { id: test.id, outcome: 'error', name: error.name, message: error.message, documentAfter: obj };
    }
  });
  assert.equal(rows.length, 10, 'golden oracle must retain ten distinct cases');
  assert.equal(new Set(rows.map(row => row.id)).size, 10, 'duplicate golden case ID');
  assert.equal(rows.filter(x => x.outcome === 'error').length, 2, 'must retain error observations');
  return rows;
}
function ndjson(rows) { return rows.map(r => JSON.stringify(r)).join('\n') + '\n'; }
export function verifyGoldenCases() {
  const actual = ndjson(executeOriginalCases());
  const expected = readFileSync(new URL('./golden.ndjson', directory), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(Buffer.from(expected, 'utf8')).digest('hex'), 'eab897112bd5948b432c90ab63040da07db6e72a32ec0963982e61d8e4bad955', 'pinned golden file SHA256 mismatch');
  assert.equal(actual, expected, 'original observed stdout differs from pinned golden bytes');
  return { cases: 10, errorCases: 2, sourceBlob: UPSTREAM.sourceBlob,
    goldenSha256: createHash('sha256').update(actual).digest('hex') };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--observe')) {
    // Used to independently emit the upstream behavior (does not alter pinned golden).
    process.stdout.write(ndjson(executeOriginalCases()));
  } else {
    process.stdout.write(JSON.stringify({ status: 'pass', ...verifyGoldenCases() }) + '\n');
  }
}
