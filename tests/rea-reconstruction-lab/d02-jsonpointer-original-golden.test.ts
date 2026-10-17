import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../projects/rea-reconstruction-lab/d02-node-jsonpointer/', import.meta.url));
const expectedGoldenSha256 = 'eab897112bd5948b432c90ab63040da07db6e72a32ec0963982e61d8e4bad955';
const expectedOriginalBlob = 'dad907d763f7369ac0e284e7d1fae2bd5508f477';
function run(dir: string, observe = false) {
  return spawnSync(process.execPath, [join(dir, 'runner.mjs'), ...(observe ? ['--observe'] : [])], {
    encoding: 'utf8', timeout: 15000,
  });
}
function tamper(check: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'nv02-d02-jsonpointer-'));
  try {
    cpSync(source, directory, { recursive: true });
    check(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

describe('NV02 D02: exact upstream MIT JavaScript original vs 10 golden cases', () => {
  it('replays all ten original behaviors and validates exact Git blob and golden hash', () => {
    const result = run(source);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout.trim());
    expect(receipt).toEqual({
      status: 'pass', cases: 10, errorCases: 2,
      sourceBlob: expectedOriginalBlob, goldenSha256: expectedGoldenSha256,
    });
    const observations = run(source, true);
    expect(observations.status, observations.stderr).toBe(0);
    expect(observations.stdout).toBe(readFileSync(join(source, 'golden.ndjson'), 'utf8'));
    expect(observations.stdout.trim().split('\n')).toHaveLength(10);
  });

  it('fails closed if the pinned upstream implementation changes', () => {
    tamper(dir => {
      appendFileSync(join(dir, 'jsonpointer.js'), '\n// unexpected source change\n');
      const result = run(dir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('original source Git blob mismatch');
    });
  });

  it('fails closed if the observed golden output is rewritten', () => {
    tamper(dir => {
      appendFileSync(join(dir, 'golden.ndjson'), '{"fake":true}\n');
      const result = run(dir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('pinned golden file SHA256 mismatch');
    });
  });

  it('fails closed if the upstream MIT notice changes', () => {
    tamper(dir => {
      appendFileSync(join(dir, 'LICENSE.md'), '\n');
      const result = run(dir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('original MIT license Git blob mismatch');
    });
  });
});
