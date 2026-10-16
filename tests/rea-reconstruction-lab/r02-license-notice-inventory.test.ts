import { expect, it } from 'vitest';
import original from '../../projects/rea-reconstruction-lab/r06-real-upstream-production-closure.json';
import inventory from '../../projects/rea-reconstruction-lab/r02-tagged-upstream-license-inventory.json';

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
    if (!n || n.version !== item.version || n.licenseDeclaration !== item.license ||
        !n.noticeReviewRequired || !n.taggedPackageVersionAndLicenseMatch ||
        !n.taggedSourceLicenseTextRead || !/^[a-f0-9]{40}$/.test(n.taggedLicenseTextGitBlob))
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
