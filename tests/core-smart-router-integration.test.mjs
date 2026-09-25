import { describe, it, expect } from 'vitest';
import { evaluateWorkRoutingPolicy } from '../apps/tigeriq-core/work-handoff.mjs';

describe('Core Smart Router Integration & Work Routing Policy', () => {
  it('automatically dispatches backlog to idle workers and prevents P0 auto-take', () => {
    const backlog = [
      { id: 'JOB-1', capability: 'reasoning', title: 'Analyze logs' },
      { id: 'JOB-2', capability: 'general', title: 'General task' }
    ];
    const workers = [
      { employee_id: 'P0', status: 'ready' },
      { employee_id: 'NV09', status: 'ready', capabilities: ['reasoning', 'general'] }
    ];
    const activeLeases = new Map();
    const retryCounts = new Map();

    const result = evaluateWorkRoutingPolicy({ backlog, workers, activeLeases, retryCounts });
    expect(result.dispatches.length).toBe(1);
    expect(result.dispatches[0].workerId).toBe('NV09');
    expect(result.dispatches[0].jobId).toBe('JOB-1');
    expect(activeLeases.has('JOB-1')).toBe(true);
  });

  it('detects ROUTING_FAULT, releases lease, and performs bounded recovery', () => {
    const activeLeases = new Map([['JOB-FAIL', { workerId: 'NV09', faulty: true, error: 'ROUTING_FAULT' }]]);
    const retryCounts = new Map();
    const result = evaluateWorkRoutingPolicy({ backlog: [], workers: [], activeLeases, retryCounts });

    expect(result.faults.length).toBe(1);
    expect(result.faults[0].error).toBe('ROUTING_FAULT');
    expect(result.releasedLeases).toContain('JOB-FAIL');
    expect(activeLeases.has('JOB-FAIL')).toBe(false);
  });
});
