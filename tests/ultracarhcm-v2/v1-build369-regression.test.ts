import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const contract = JSON.parse(readFileSync(resolve(root,'tests/ultracarhcm-v2/v1-build369-regression.json'),'utf8'));
const v1 = JSON.parse(readFileSync(resolve(root,'apps/ultracarhcm-v1/release/current-release.json'),'utf8'));
const v2 = JSON.parse(readFileSync(resolve(root,'tests/ultracarhcm-v2/f01-f22-source-matrix.json'),'utf8'));

describe('GH-5135 V1 Build 369 full-function baseline gate', () => {
  it('anchors the baseline to the actually accepted V1 release, not legacy v240', () => {
    expect(contract.workOrder).toBe('GH-5135');
    expect(contract.source.version).toBe('1.2.23');
    expect(contract.source.versionCode).toBe(v1.versionCode);
    expect(contract.source.packageName).toBe(v1.packageName);
    expect(contract.source.apkSha256).toBe(v1.sha256);
    expect(contract.targetPackage).toBe('ai.tigeriq.ultracarhcm.v2');
    expect(contract.source.packageName).not.toBe(contract.targetPackage);
  });

  it('covers every new D01-D10 regression and maps each to existing F01-F22', () => {
    const ids = Array.from({length:10},(_,i)=>'D'+String(i+1).padStart(2,'0'));
    expect(contract.cases.map((c: any)=>c.id)).toEqual(ids);
    const groupIds = new Set(v2.features.map((f: any)=>f.id));
    expect(v2.features).toHaveLength(22);
    for (const c of contract.cases) {
      expect(c.features.length).toBeGreaterThan(0);
      for (const f of c.features) expect(groupIds.has(f),c.id+': '+f).toBe(true);
      expect(c.expected.trim()).not.toBe('');
      expect(c.acceptance.trim()).not.toBe('');
      expect(c.requiredEvidence.length).toBeGreaterThan(0);
    }
  });

  it('never claims real device PASS from static source evidence alone', () => {
    expect(contract.acceptance).toBe('NO_AUTOMATIC_PASS_SOURCE_CODE_OR_MOCK_TEST_ONLY');
    for (const c of contract.cases) {
      expect(c.state).toBe('NOT_TESTED');
      expect(c.artifactSha256).toBeNull();
      expect(c.deviceEvidence).toBeNull();
    }
    for (const f of v2.features) expect(f.testStatus).not.toMatch(/ACCEPTED|PASS/);
  });
});
