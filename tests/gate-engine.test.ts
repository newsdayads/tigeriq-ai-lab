import { describe, expect, it } from 'vitest';
import { canAdvance, nextGate } from '../packages/gate-engine/src/index.js';

describe('gate engine', () => {
  it('rejects PASS without deterministic evidence', () => {
    expect(canAdvance('TEST', [{ gate: 'TEST', status: 'pass' }])).toBe(false);
  });

  it('accepts PASS only with command, commit and zero exit code', () => {
    expect(canAdvance('TEST', [{ gate: 'TEST', status: 'pass', commitSha: 'abcdef1', command: 'npm test', exitCode: 0 }])).toBe(true);
  });

  it('does not advance on fail', () => {
    expect(canAdvance('TEST', [{ gate: 'TEST', status: 'fail', commitSha: 'abcdef1', command: 'npm test', exitCode: 1 }])).toBe(false);
  });

  it('advances in the declared order', () => {
    expect(nextGate('TEST')).toBe('TYPECHECK');
  });
});
