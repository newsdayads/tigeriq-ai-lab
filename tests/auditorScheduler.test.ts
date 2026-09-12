import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  filterEligibleNodes,
  selectAuditorNode,
  runAuditCycle,
  startAuditorScheduler,
  stopAuditorScheduler,
  NVNode
} from '../packages/runtime/src/auditorScheduler.js';
import * as runtimeTruthModule from '../packages/runtime/src/runtimeTruth.js';
import * as auditHelpersModule from '../packages/runtime/src/auditHelpers.js';
import * as workOrderSystemModule from '../packages/runtime/src/workOrderSystem.js';

vi.mock('../packages/runtime/src/runtimeTruth.js', () => ({
  getRuntimeTruth: vi.fn(),
  updateRuntimeTruth: vi.fn()
}));

vi.mock('../packages/runtime/src/auditHelpers.js', () => ({
  scanCore: vi.fn(),
  verifyFindings: vi.fn(),
  dedupeFindings: vi.fn(),
  dispatchFinding: vi.fn()
}));

vi.mock('../packages/runtime/src/workOrderSystem.js', () => ({
  createWorkItem: vi.fn()
}));

describe('auditorScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopAuditorScheduler();
    vi.useRealTimers();
  });

  it('filters out busy/offline nodes correctly', () => {
    const nodes: NVNode[] = [
      { id: 'node-1', status: 'READY', lastIdleTimestamp: 100, activeLoad: 1 },
      { id: 'node-2', status: 'BUSY', lastIdleTimestamp: 200, activeLoad: 0 },
      { id: 'node-3', status: 'IDLE', lastIdleTimestamp: 150, activeLoad: 2 },
      { id: 'node-4', status: 'OFFLINE', lastIdleTimestamp: 300, activeLoad: 0 }
    ];
    const eligible = filterEligibleNodes(nodes);
    expect(eligible.map(n => n.id)).toEqual(['node-1', 'node-3']);
  });

  it('selects the least loaded or longest idle node', () => {
    const nodes: NVNode[] = [
      { id: 'node-1', status: 'READY', lastIdleTimestamp: 200, activeLoad: 2 },
      { id: 'node-2', status: 'ONLINE', lastIdleTimestamp: 100, activeLoad: 1 },
      { id: 'node-3', status: 'IDLE', lastIdleTimestamp: 50, activeLoad: 1 }
    ];
    const selected = selectAuditorNode(nodes);
    expect(selected?.id).toBe('node-3');
  });

  it('handles no suitable NV available by logging AUDIT_DEFERRED_NO_IDLE_RESOURCE', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(runtimeTruthModule, 'getRuntimeTruth').mockResolvedValue({
      nodes: [{ id: 'node-1', status: 'BUSY', lastIdleTimestamp: 100, activeLoad: 5 }],
      auditorState: null
    });

    await runAuditCycle(false);
    expect(consoleSpy).toHaveBeenCalledWith('AUDIT_DEFERRED_NO_IDLE_RESOURCE');
    consoleSpy.mockRestore();
  });

  it('performs audit steps and creates a work item when finding is detected', async () => {
    vi.spyOn(runtimeTruthModule, 'getRuntimeTruth').mockResolvedValue({
      nodes: [{ id: 'node-1', status: 'READY', lastIdleTimestamp: 100, activeLoad: 0 }],
      auditorState: null
    });
    vi.spyOn(runtimeTruthModule, 'updateRuntimeTruth').mockResolvedValue(true);
    vi.spyOn(auditHelpersModule, 'scanCore').mockResolvedValue([{ id: 'f-1', description: 'Bug found' }]);
    vi.spyOn(auditHelpersModule, 'verifyFindings').mockResolvedValue([{ id: 'f-1', description: 'Bug found' }]);
    vi.spyOn(auditHelpersModule, 'dedupeFindings').mockResolvedValue([{ id: 'f-1', description: 'Bug found' }]);
    vi.spyOn(auditHelpersModule, 'dispatchFinding').mockResolvedValue(true);
    const createWorkItemSpy = vi.spyOn(workOrderSystemModule, 'createWorkItem').mockResolvedValue('item-1');

    await runAuditCycle(false);

    expect(auditHelpersModule.scanCore).toHaveBeenCalled();
    expect(auditHelpersModule.verifyFindings).toHaveBeenCalled();
    expect(auditHelpersModule.dedupeFindings).toHaveBeenCalled();
    expect(auditHelpersModule.dispatchFinding).toHaveBeenCalled();
    expect(createWorkItemSpy).toHaveBeenCalledWith(expect.objectContaining({
      source: 'auditorScheduler'
    }));
    expect(runtimeTruthModule.updateRuntimeTruth).toHaveBeenCalled();
  });

  it('schedules light and deep scans via setInterval', () => {
    const runCycleSpy = vi.fn();
    startAuditorScheduler();

    // Verify timers are registered
    expect(vi.getTimerCount()).toBe(2);
  });
});
