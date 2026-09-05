import { describe, expect, it } from 'vitest';
import {
  GlobalScheduler,
  ImprovementEngine,
  StateWriteCoalescer,
  assessPerformance,
  runImprovementCycle,
  type Observation,
} from '../packages/self-improvement/src/index.js';

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    fingerprint: 'nv-load-history',
    scope: 'project',
    category: 'performance',
    summary: 'Do not bulk-load history on normal startup',
    impact: 5,
    frequency: 1,
    confidence: 0.9,
    estimated_cost: 1,
    risk: 1,
    observed_at: 100,
    evidence: [{ source: '#458', kind: 'issue', revision: '1' }],
    ...overrides,
  };
}

describe('TigerIQ Self-Improving Core', () => {
  it('dedupes repeated observations into one ranked candidate', () => {
    const engine = new ImprovementEngine();
    const first = engine.ingest(observation());
    const second = engine.ingest(observation({ observed_at: 101, frequency: 3 }));
    expect(second.id).toBe(first.id);
    expect(second.observations).toBe(2);
    expect(second.frequency).toBe(4);
    expect(engine.backlog()).toHaveLength(1);
  });

  it('never promotes an unverified observation to shared knowledge', () => {
    const engine = new ImprovementEngine();
    engine.ingest(observation());
    expect(engine.activeLessons()).toEqual([]);
  });

  it('requires independent implementer reviewer and judge plus evidence', () => {
    const engine = new ImprovementEngine();
    const candidate = engine.ingest(observation());
    expect(() => engine.verify(candidate.id, {
      implementer_id: 'NV02', reviewer_id: 'NV02', judge_id: 'Vy', reviewer_pass: true, judge_pass: true, evidence: [],
    }, 200)).toThrow('INDEPENDENT_GATE_REQUIRED');

    const lesson = engine.verify(candidate.id, {
      implementer_id: 'NV02', reviewer_id: 'NV04', judge_id: 'Vy', reviewer_pass: true, judge_pass: true,
      evidence: [{ source: 'CI#1181', kind: 'test', revision: 'success' }],
    }, 200, 500);
    expect(lesson.status).toBe('ACTIVE');
    expect(engine.activeLessons()).toHaveLength(1);
  });

  it('retires lessons when their review horizon expires', () => {
    const engine = new ImprovementEngine();
    const candidate = engine.ingest(observation());
    engine.verify(candidate.id, {
      implementer_id: 'A', reviewer_id: 'B', judge_id: 'C', reviewer_pass: true, judge_pass: true,
      evidence: [{ source: 'bench', kind: 'benchmark' }],
    }, 200, 300);
    expect(engine.retireStale(299)).toHaveLength(0);
    expect(engine.retireStale(300)).toHaveLength(1);
    expect(engine.activeLessons()).toHaveLength(0);
  });

  it('fails a candidate performance budget instead of hiding regression', () => {
    const result = assessPerformance({
      startup_to_action_ms: 6000,
      source_fetches: 9,
      cache_hit_ratio: 0.2,
      deep_reads: 4,
      write_amplification: 8,
    }, {
      max_startup_to_action_ms: 2500,
      max_source_fetches: 3,
      min_cache_hit_ratio: 0.7,
      max_deep_reads: 0,
      max_write_amplification: 2,
    });
    expect(result.pass).toBe(false);
    expect(result.violations).toEqual([
      'startup_to_action_ms:6000>2500',
      'source_fetches:9>3',
      'cache_hit_ratio:0.2<0.7',
      'deep_reads:4>0',
      'write_amplification:8>2',
    ]);
  });

  it('backpressures shared resources and preserves foreground priority', () => {
    const scheduler = new GlobalScheduler({ github: 1, pc01: 1 });
    expect(scheduler.submit({ task_id: 'bg1', employee_id: 'NV02', priority: 10, resources: [{ class: 'github', key: 'repo' }], submitted_at: 1 }).state).toBe('RUNNING');
    expect(scheduler.submit({ task_id: 'bg2', employee_id: 'NV04', priority: 20, resources: [{ class: 'github', key: 'repo' }], submitted_at: 2 }).state).toBe('QUEUED');
    expect(scheduler.submit({ task_id: 'fg', employee_id: 'NV01', priority: 1, foreground: true, resources: [{ class: 'github', key: 'repo' }], submitted_at: 3 }).state).toBe('QUEUED');
    expect(scheduler.queued()).toEqual(['fg', 'bg2']);
    expect(scheduler.release('bg1')).toEqual(['fg']);
    expect(scheduler.running()).toContain('fg');
  });

  it('locks keyed resources even when class capacity is larger than one', () => {
    const scheduler = new GlobalScheduler({ browser: 4 });
    expect(scheduler.submit({ task_id: 'a', employee_id: 'NV02', priority: 1, resources: [{ class: 'browser', key: 'managed-window' }], submitted_at: 1 }).state).toBe('RUNNING');
    expect(scheduler.submit({ task_id: 'b', employee_id: 'NV04', priority: 1, resources: [{ class: 'browser', key: 'managed-window' }], submitted_at: 2 }).state).toBe('QUEUED');
    expect(scheduler.submit({ task_id: 'c', employee_id: 'NV05', priority: 1, resources: [{ class: 'browser', key: 'other-window' }], submitted_at: 3 }).state).toBe('RUNNING');
  });

  it('coalesces unchanged checkpoint writes but preserves bounded freshness', () => {
    const writes = new StateWriteCoalescer();
    const payload = { state: 'RUNNING', checkpoint: '#1' };
    expect(writes.shouldPersist('NV02', payload, 0, 1000)).toEqual({ persist: true, reason: 'FIRST' });
    writes.markPersisted('NV02', payload, 0);
    expect(writes.shouldPersist('NV02', payload, 500, 1000)).toEqual({ persist: false, reason: 'UNCHANGED' });
    expect(writes.shouldPersist('NV02', payload, 1000, 1000)).toEqual({ persist: true, reason: 'MAX_INTERVAL' });
    expect(writes.shouldPersist('NV02', { ...payload, checkpoint: '#2' }, 100, 1000)).toEqual({ persist: true, reason: 'CHANGED' });
  });

  it('daily improvement cycle only creates backlog; it does not self-adopt', () => {
    const engine = new ImprovementEngine();
    const cycle = runImprovementCycle(engine, [observation()], 1000);
    expect(cycle.backlog).toHaveLength(1);
    expect(cycle.active_lessons).toHaveLength(0);
    expect(cycle.requires_human_or_gate_action).toBe(true);
  });
});
