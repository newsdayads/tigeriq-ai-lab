import { expect, it } from 'vitest';
import original from '../../projects/rea-reconstruction-lab/r06-real-upstream-production-closure.json' with { type: 'json' };
import inventory from '../../projects/rea-reconstruction-lab/r02-tagged-upstream-license-inventory.json' with { type: 'json' };

// Authenticated tagged-repository LICENSE blobs already verified for GH-4780.
// Do not accept any arbitrary 40-hex value as proof of the pinned source text.
const PINNED_NOTICE_PROVENANCE: Record<string, {
  repository: string; tag: string; licenseTextPath: string; gitBlob: string;
}> = {
  'node_modules/glob': { repository: 'isaacs/node-glob', tag: 'v13.0.6', licenseTextPath: 'LICENSE.md', gitBlob: '881248b6d7f0ca2c4f65c41c0af5e02bb0680601' },
  'node_modules/lru-cache': { repository: 'isaacs/node-lru-cache', tag: 'v11.5.2', licenseTextPath: 'LICENSE.md', gitBlob: 'c5402b9577a8cdd966c0974e5b74cc7b85f536c5' },
  'node_modules/minimatch': { repository: 'isaacs/minimatch', tag: 'v10.2.5', licenseTextPath: 'LICENSE.md', gitBlob: '8cb5cc6e616c0d9259b4965f9d2ce8528e4d2828' },
  'node_modules/minipass': { repository: 'isaacs/minipass', tag: 'v7.1.3', licenseTextPath: 'LICENSE.md', gitBlob: 'c5402b9577a8cdd966c0974e5b74cc7b85f536c5' },
  'node_modules/path-scurry': { repository: 'isaacs/path-scurry', tag: 'v2.0.2', licenseTextPath: 'LICENSE.md', gitBlob: 'c5402b9577a8cdd966c0974e5b74cc7b85f536c5' },
  'node_modules/pako': { repository: 'nodeca/pako', tag: '1.0.11', licenseTextPath: 'LICENSE', gitBlob: 'a934ef8db478453e38b2f29af67610916fa9fc99' },
  'node_modules/sha.js': { repository: 'browserify/sha.js', tag: 'v2.4.12', licenseTextPath: 'LICENSE', gitBlob: '11888c13502a50ad98371cb5bc48acff9d210aa6' },
};

function auditSnapshot(data: typeof inventory): string[] {
  const issues: string[] = [];
  if (data.source.repository !== 'morluto/rea' ||
      data.source.commit !== original.source.commit ||
      data.source.lockGitBlob !== original.source.lockfileGitBlobSha1 ||
      data.source.productionClosureGitBlob !== 'dbd61f2cb166076898ed798f653be91e930f3e37') issues.push('PROVENANCE_DRIFT');
  if (data.declarations.length !== 148) issues.push('ROW_COUNT');
  const byPath = new Map(data.declarations.map(x => [x.path, x]));
  if (byPath.size !== data.declarations.length) issues.push('DUPLICATE_PATH');
  for (const row of original.productionClosure) {
    const item = byPath.get(row.path);
    if (!item || item.version !== row.version || item.integrity !== row.integrity ||
        typeof item.license !== 'string' || !item.license.trim()) issues.push('ROW_PROVENANCE_OR_LICENSE');
  }
  const tally: Record<string, number> = {};
  for (const item of data.declarations) tally[item.license] = (tally[item.license] ?? 0) + 1;
  if (JSON.stringify(Object.entries(tally).sort()) !== JSON.stringify(Object.entries(data.counts.licenses).sort()))
    issues.push('LICENSE_HISTOGRAM_DRIFT');
  const flagged = data.declarations.filter(x => x.license === 'BlueOak-1.0.0' || x.license.includes(' AND '));
  const notices = new Map(data.noticeCases.map(x=>[x.path,x]));
  if (flagged.length !== 7 || notices.size !== 7 || data.noticeCases.length !== 7) issues.push('NOTICE_COUNT');
  for (const item of flagged) {
    const n = notices.get(item.path);
    const pin = PINNED_NOTICE_PROVENANCE[item.path];
    if (!n || !pin || n.version !== item.version || n.licenseDeclaration !== item.license ||
        !n.noticeReviewRequired || !n.taggedPackageVersionAndLicenseMatch ||
        !n.taggedSourceLicenseTextRead || n.repository !== pin.repository ||
        n.tag !== pin.tag || n.licenseTextPath !== pin.licenseTextPath ||
        n.taggedLicenseTextGitBlob !== pin.gitBlob)
      issues.push('NOTICE_PROVENANCE_DRIFT');
  }
  // Also walk pinned notices in reverse: a tampered AND license disappears
  // from the flagged subset, but must still be rejected, not downgraded.
  for (const n of data.noticeCases) {
    const item = byPath.get(n.path);
    if (!item || item.version !== n.version || item.license !== n.licenseDeclaration)
      issues.push('NOTICE_PROVENANCE_DRIFT');
  }
  for (const [flag,value] of Object.entries(data.gates)) {
    if (flag === 'sourceOnly' ? value !== true : value !== false) issues.push('UNAUTHORIZED_ACCEPTANCE_FLAG');
  }
  return issues;
}

it('R02 148/148 pinned production paths and notice provenance form a consistent snapshot', () => {
  expect(auditSnapshot(inventory)).toEqual([]);
  expect(inventory.counts.productionSourceRows).toBe(148);
  expect(inventory.counts.licenseMetadataPresent).toBe(148);
});

it('R02 preserves complete dual-license expressions and five BlueOak declarations', () => {
  expect(inventory.counts.licenses).toEqual({
    'MIT':115, 'Apache-2.0':7, 'BSD-3-Clause':7, 'BlueOak-1.0.0':5,
    'ISC':11, '(MIT AND Zlib)':1, 'BSD-2-Clause':1, '(MIT AND BSD-3-Clause)':1,
  });
  expect(inventory.declarations.find(x=>x.path==='node_modules/pako')?.license).toBe('(MIT AND Zlib)');
  expect(inventory.declarations.find(x=>x.path==='node_modules/sha.js')?.license).toBe('(MIT AND BSD-3-Clause)');
});

it('R02 seven upstream tagged license notices are pinned without exposing runtime authority', () => {
  expect(inventory.noticeCases.map(x=>x.path).sort()).toEqual(
    ['glob','lru-cache','minimatch','minipass','pako','path-scurry','sha.js']
      .map(x=>'node_modules/'+x).sort(),
  );
  expect(inventory.counts.taggedLicenseSourceTextVerified).toBe(7);
  expect(inventory.gates.packageTarballLicenseTextVerified).toBe(false);
  expect(inventory.gates.legalDistributionApproved).toBe(false);
  expect(inventory.gates.installAuthorized).toBe(false);
});

it('R02 rejects missing source row, tampered integrity, and silent MIT-only downgrade', () => {
  const missing=structuredClone(inventory);missing.declarations.pop();
  expect(auditSnapshot(missing)).toContain('ROW_COUNT');
  const integrity=structuredClone(inventory);integrity.declarations[0].integrity='sha512-FAKE';
  expect(auditSnapshot(integrity)).toContain('ROW_PROVENANCE_OR_LICENSE');
  const downgraded=structuredClone(inventory);
  downgraded.declarations.find(x=>x.path==='node_modules/pako')!.license='MIT';
  expect(auditSnapshot(downgraded)).toContain('LICENSE_HISTOGRAM_DRIFT');
  expect(auditSnapshot(downgraded)).toContain('NOTICE_PROVENANCE_DRIFT');
});

it('R02 rejects dropped license notices and forged installation approvals', () => {
  const missingNotice=structuredClone(inventory);missingNotice.noticeCases.pop();
  expect(auditSnapshot(missingNotice)).toContain('NOTICE_COUNT');
  const leak=structuredClone(inventory);leak.gates.leaseOwned=true;leak.gates.installAuthorized=true;
  expect(auditSnapshot(leak)).toContain('UNAUTHORIZED_ACCEPTANCE_FLAG');
});

it('R02 rejects valid-shaped forged LICENSE blob, tag, source repo, and filename', () => {
  const mutations: Array<(item: (typeof inventory.noticeCases)[number]) => void> = [
    item => { item.taggedLicenseTextGitBlob = 'a'.repeat(40); },
    item => { item.tag = 'v0.0.0'; },
    item => { item.repository = 'attacker/sha.js'; },
    item => { item.licenseTextPath = 'OTHER_LICENSE'; },
  ];
  for (const mutation of mutations) {
    const forged = structuredClone(inventory);
    const item = forged.noticeCases.find(x => x.path === 'node_modules/sha.js');
    expect(item).toBeDefined();
    mutation(item!);
    expect(auditSnapshot(forged)).toContain('NOTICE_PROVENANCE_DRIFT');
  }
});
