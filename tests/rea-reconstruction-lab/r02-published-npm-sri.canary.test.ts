import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import catalog from '../../projects/rea-reconstruction-lab/r02-tagged-upstream-license-inventory.json' with { type: 'json' };

// Bounded, one-revision, read-only npm package-byte canary.
// Run once on the designated PR SHA only; later CI builds skip the public GET.
// Manual authorized replay: REA_R02_TARBALL_PROBE=1 npx vitest run tests/rea-reconstruction-lab/r02-published-npm-sri.canary.test.ts
const ADMITTED_BRANCH = 'p2/4780-r02-published-npm-archives-20261016-nv02';
const admit = process.env.REA_R02_TARBALL_PROBE === '1' ||
  (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_HEAD_REF === ADMITTED_BRANCH);
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 60 * 1024 * 1024;
const REQUIRED = ['glob', 'lru-cache', 'minimatch', 'minipass', 'path-scurry', 'pako', 'sha.js'];

type Proof = { name: string; version: string; bytes: number; sha512: string;
  expectedSRI: string; matched: boolean; licenseFiles: Array<{path:string; sha256:string; bytes:number}> };

function tarReadOctal(block: Buffer): number {
  const value = block.toString('ascii').replace(/\0/g, '').trim();
  if (!/^[0-7]+$/.test(value)) throw new Error('TAR_SIZE_INVALID');
  const n = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(n)) throw new Error('TAR_SIZE_INVALID');
  return n;
}

function extractNoticeDigests(bytes: Buffer) {
  const archive = gunzipSync(bytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  const notices: Proof['licenseFiles'] = [];
  let offset = 0;
  while (offset + 512 <= archive.byteLength) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const size = tarReadOctal(header.subarray(124,136));
    const name = header.subarray(0,100).toString('utf8').split('\0')[0];
    const prefix = header.subarray(345,500).toString('utf8').split('\0')[0];
    const path = prefix ? prefix + '/' + name : name;
    const start = offset + 512, end = start + size;
    if (end > archive.byteLength || end < start) throw new Error('TAR_TRUNCATED');
    if (/^(?:package\/)?(?:license|licence|copying|notice)(?:[.\-_].*)?$/i.test(path) ||
        /^(?:package\/)?(?:lib\/zlib\/)?(?:LICENSE|LICENCE)(?:[.\-_].*)?$/i.test(path)) {
      const part = archive.subarray(start,end);
      notices.push({path,sha256:createHash('sha256').update(part).digest('hex'),bytes:part.byteLength});
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  if (offset > archive.byteLength) throw new Error('TAR_BOUNDARY_INVALID');
  return notices;
}

async function readBounded(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'registry.npmjs.org' ||
      parsed.username || parsed.password || parsed.search || parsed.hash ||
      !/^\/[a-z0-9.-]+\/-\/[a-z0-9.-]+-\d+\.\d+\.\d+\.tgz$/.test(parsed.pathname))
    throw new Error('NPM_URL_REJECTED');
  const response = await fetch(parsed.toString(), { redirect:'error', signal:AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new Error('NPM_HTTP_' + response.status);
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_ARCHIVE_BYTES) {
    await response.body.cancel(); throw new Error('NPM_ARCHIVE_TOO_LARGE');
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0, done = false;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) { done = true; break; }
      total += step.value.byteLength;
      if (total > MAX_ARCHIVE_BYTES) throw new Error('NPM_ARCHIVE_TOO_LARGE');
      chunks.push(Buffer.from(step.value));
    }
  } finally {
    if (!done) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks,total);
}

it.runIf(admit)('GH-4780 R02: seven real npm archives match immutable upstream SHA512 SRI and have recorded notice digests', async () => {
  const results: Proof[] = [];
  for (const name of REQUIRED) {
    const manifest = catalog.declarations.find(x => x.path === 'node_modules/' + name);
    expect(manifest).toBeDefined();
    const { version, integrity } = manifest!;
    expect(integrity).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/);
    const url = 'https://registry.npmjs.org/' + name + '/-/' + name + '-' + version + '.tgz';
    const bytes = await readBounded(url);
    const sri = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    const matched = sri === integrity;
    const proof: Proof = { name, version, bytes: bytes.length, sha512:sri, expectedSRI: integrity,
      matched, licenseFiles: matched ? extractNoticeDigests(bytes) : [] };
    // Log full content digests but never tarball bytes, credentials, network token or license files.
    console.log('REA_R02_REAL_NPM_ARCHIVE=' + JSON.stringify(proof));
    results.push(proof);
    expect(matched, 'Immutable upstream SRI mismatch for '+name+'@'+version).toBe(true);
  }
  expect(results).toHaveLength(7);
  expect(results.every(x => x.matched)).toBe(true);
}, 200000);

it('GH-4780 archive gate is a one-revision read-only canary and never authorizes install', () => {
  expect(catalog.gates.installAuthorized).toBe(false);
  expect(catalog.gates.actualConsumerSbomVerified).toBe(false);
  expect(catalog.gates.legalDistributionApproved).toBe(false);
  expect(catalog.gates.packageTarballLicenseTextVerified).toBe(false);
  expect(REQUIRED).toHaveLength(7);
});
