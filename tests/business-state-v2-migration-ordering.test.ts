import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contract = readFileSync(
  new URL('../docs/architecture/TIGERIQ_BUSINESS_STATE_V2_CONTRACT.md', import.meta.url),
  'utf8',
);

describe('Business State V2 migration ordering contract', () => {
  it('reserves 003 after the canonical operational-state and device-replay migrations', () => {
    expect(contract).toContain('`001_operational_state_v1`');
    expect(contract).toContain('`002_device_proof_replay_v1`');
    expect(contract).toContain('`003_business_state_v2`');
    expect(contract).not.toContain('`002_business_state_v2`');
  });

  it('defines migration sequence as global across the single PC01 operational datastore', () => {
    expect(contract).toContain('the three-digit migration sequence is global across the canonical PC01 operational datastore');
    expect(contract).toContain("allocate the next unused sequence");
    expect(contract).toContain('duplicate sequence numbers fail integration');
  });
});
