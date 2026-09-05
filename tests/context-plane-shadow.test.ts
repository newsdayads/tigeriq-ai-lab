import { describe, expect, it } from 'vitest';
import { assessStartupBudget, compareShadow } from '../packages/context-plane/src/shadow.js';
import type { StartupResult } from '../packages/context-plane/src/index.js';

function candidate(): StartupResult {
  return {
    ok: true,
    command: '2',
    employee_id: 'NV02',
    background: true,
    activation_state: 'ACTIVE',
    requires_deep_read: false,
    state: {
      schema: 'tigeriq-hot-state/v1',
      employee_id: 'NV02',
      revision: 's1',
      authority_revision: { central: 'c1', registry: 'r1' },
      current_work: '#441',
      lease: null,
      checkpoint: { key: 'NV02/CHECKPOINT.md', revision: 'p1', kind: 'checkpoint' },
      next_action: 'continue',
      blockers: [],
      open_gates: [],
      evidence: [],
      updated_at: 1,
    },
    metrics: { read_calls: 2, source_fetches: 2, cache_hits: 0, coalesced_reads: 0, bytes_loaded: 700, deep_reads: 0 },
  };
}

describe('Context Plane shadow gates', () => {
  it('accepts exact legacy parity', () => {
    const result = compareShadow({
      command: '2',
      employee_id: 'NV02',
      background: true,
      activation_state: 'ACTIVE',
      current_work: '#441',
      checkpoint_key: 'NV02/CHECKPOINT.md',
    }, candidate());
    expect(result.match).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it('blocks adoption on any routing/state divergence', () => {
    const next = candidate();
    next.employee_id = 'NV04';
    const result = compareShadow({
      command: '2',
      employee_id: 'NV02',
      background: true,
      activation_state: 'ACTIVE',
      current_work: '#441',
      checkpoint_key: 'NV02/CHECKPOINT.md',
    }, next);
    expect(result.match).toBe(false);
    expect(result.mismatches).toContain('employee_id');
  });

  it('enforces normal cold-start budget with zero deep reads', () => {
    expect(assessStartupBudget(candidate().metrics, {
      max_source_fetches: 2,
      max_deep_reads: 0,
      max_bytes_loaded: 1024,
    })).toEqual({ pass: true, violations: [] });
  });

  it('reports budget regression instead of hiding it', () => {
    const result = assessStartupBudget({
      read_calls: 12,
      source_fetches: 7,
      cache_hits: 0,
      coalesced_reads: 0,
      bytes_loaded: 50_000,
      deep_reads: 3,
    }, {
      max_source_fetches: 2,
      max_deep_reads: 0,
      max_bytes_loaded: 2048,
    });
    expect(result.pass).toBe(false);
    expect(result.violations).toEqual([
      'source_fetches:7>2',
      'deep_reads:3>0',
      'bytes_loaded:50000>2048',
    ]);
  });
});
