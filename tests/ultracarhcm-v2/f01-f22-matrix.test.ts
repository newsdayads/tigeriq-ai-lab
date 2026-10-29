import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Status = 'PARTIAL_SOURCE' | 'SOURCE_IMPLEMENTED_DEVICE_REQUIRED' | 'NOT_IMPLEMENTED';
type Feature = {
  id: string;
  expected: string;
  status: Status;
  sourceEvidence: string[];
  gap: string;
};
type Matrix = {
  schema: string;
  workOrder: string;
  acceptanceRule: string;
  statuses: Status[];
  features: Feature[];
};

const root = process.cwd();
const matrix = JSON.parse(
  readFileSync(new URL('./f01-f22-source-matrix.json', import.meta.url), 'utf8'),
) as Matrix;

describe('GH-5135 R02 F01-F22 source matrix', () => {
  it('contains every feature gate exactly once and in canonical order', () => {
    const expectedIds = Array.from({ length: 22 }, (_, index) =>
      'F' + String(index + 1).padStart(2, '0'),
    );
    expect(matrix.features.map(feature => feature.id)).toEqual(expectedIds);
    expect(new Set(matrix.features.map(feature => feature.id)).size).toBe(22);
  });

  it('never converts source evidence into product PASS or acceptance', () => {
    expect(matrix.acceptanceRule).toMatch(/No row is PASS\/ACCEPTED/);
    for (const feature of matrix.features) {
      expect(['PARTIAL_SOURCE', 'SOURCE_IMPLEMENTED_DEVICE_REQUIRED', 'NOT_IMPLEMENTED'])
        .toContain(feature.status);
      expect(feature.status).not.toMatch(/PASS|ACCEPTED/);
      expect(feature.gap.trim().length).toBeGreaterThan(0);
    }
  });

  it('requires real source evidence for every claimed partial or implemented row', () => {
    for (const feature of matrix.features) {
      if (feature.status === 'NOT_IMPLEMENTED') {
        expect(feature.sourceEvidence).toEqual([]);
        continue;
      }
      expect(feature.sourceEvidence.length, feature.id).toBeGreaterThan(0);
      for (const path of feature.sourceEvidence) {
        expect(
          existsSync(resolve(root, path)),
          feature.id + ' missing source evidence: ' + path,
        ).toBe(true);
      }
    }
  });

  it('keeps hardware-dependent Camera and DeX rows out of accepted state', () => {
    const deviceRequired = matrix.features
      .filter(feature => feature.status === 'SOURCE_IMPLEMENTED_DEVICE_REQUIRED')
      .map(feature => feature.id);
    expect(deviceRequired).toEqual(['F03', 'F04', 'F06']);
    for (const id of deviceRequired) {
      const feature = matrix.features.find(row => row.id === id)!;
      expect(feature.gap).toMatch(/device|DeX|USB|real|QA/i);
    }
  });

  it('records the currently absent business feature groups explicitly', () => {
    const absent = matrix.features
      .filter(feature => feature.status === 'NOT_IMPLEMENTED')
      .map(feature => feature.id);
    expect(absent).toEqual(['F11', 'F12', 'F13', 'F14', 'F15', 'F16', 'F18', 'F19']);
  });
});
