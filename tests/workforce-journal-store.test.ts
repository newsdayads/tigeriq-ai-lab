import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJournal } from '../packages/event-store/src/index.js';
import { CapabilityScheduler, TaskQueue, WorkforceRegistry, type TaskPacket } from '../packages/workforce/src/index.js';
import { FileJournalWorkforceStateStore } from '../packages/workforce/src/journal-store.js';
import { DurableWorkforceRuntime } from '../packages/workforce/src/runtime.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempJournal() {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-workforce-'));
  dirs.push(dir);
  const path = join(dir, 'workforce.jsonl');
  return { path, journal: new FileJournal(path) };
}

function addEmployee(registry: WorkforceRegistry): void {
  registry.registerNode({
    nodeId: 'node-RES-01', kind: 'simulator', platform: 'test', agentVersion: '1.0.0',
    capabilities: ['research'], status: 'online', lastHeartbeatAt: new Date().toISOString(),
  });
  registry.registerEmployee({
    employeeId: 'RES-01', displayName: 'Researcher 01', department: 'research', role: 'researcher',
    nodeId: 'node-RES-01', provider: 'gemini', capabilities: ['research'], availability: 'idle',
    healthScore: 95, concurrencyLimit: 1,
  });
}

function task(): TaskPacket {
  return {
    taskId: 'DURABLE-1', idempotencyKey: 'durable-1', objective: 'prove journal restart recovery', priority: 'P0',
    requiredCapabilities: ['research'], constraints: ['no secrets'], inputs: [], expectedArtifacts: ['result'],
    deadline: new Date(Date.now() + 60_000).toISOString(), maxAttempts: 2,
    reviewPolicy: { independentReview: false, judgeRequired: false, preferProviderDiversity: false },
  };
}

describe('FileJournalWorkforceStateStore', () => {
  it('persists completed work across a real file-backed restart and suppresses duplicate execution', async () => {
    const { path, journal } = await tempJournal();
    const store1 = new FileJournalWorkforceStateStore(journal);
    const registry1 = new WorkforceRegistry();
    addEmployee(registry1);
    const queue1 = new TaskQueue();
    const runtime1 = new DurableWorkforceRuntime(registry1, queue1, new CapabilityScheduler(registry1), store1);
    let calls1 = 0;
    runtime1.registerAdapter({
      kind: 'simulator',
      async execute(input, employee) {
        calls1 += 1;
        return {
          taskId: input.taskId, employeeId: employee.employeeId, status: 'completed', conclusion: 'done', confidence: 1,
          artifacts: [{ kind: 'json', ref: 'memory://done' }], risks: [], completedAt: new Date().toISOString(),
        };
      },
    });
    await runtime1.execute(task());
    expect(calls1).toBe(1);

    const registry2 = new WorkforceRegistry();
    const queue2 = new TaskQueue();
    const store2 = new FileJournalWorkforceStateStore(new FileJournal(path));
    const runtime2 = await DurableWorkforceRuntime.restore(registry2, queue2, new CapabilityScheduler(registry2), store2);
    let calls2 = 0;
    runtime2.registerAdapter({
      kind: 'simulator',
      async execute(input, employee) {
        calls2 += 1;
        return {
          taskId: input.taskId, employeeId: employee.employeeId, status: 'completed', conclusion: 'duplicate', confidence: 1,
          artifacts: [{ kind: 'json', ref: 'memory://duplicate' }], risks: [], completedAt: new Date().toISOString(),
        };
      },
    });

    const alias = { ...task(), taskId: 'DURABLE-ALIAS' };
    const result = await runtime2.execute(alias);
    expect(result.taskId).toBe('DURABLE-1');
    expect(calls2).toBe(0);
    expect(queue2.get('DURABLE-1').stage).toBe('completed');

    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const parsed = lines.map((line) => JSON.parse(line));
    expect(parsed.every((entry) => typeof entry.hash === 'string' && entry.hash.length === 64)).toBe(true);
  });

  it('uses a dedicated append-only stream and returns the latest valid snapshot', async () => {
    const { journal } = await tempJournal();
    const store = new FileJournalWorkforceStateStore(journal, { streamId: 'workforce:test', actor: 'test-controller' });
    const base = {
      version: 1 as const,
      savedAt: '2026-08-30T17:00:00.000Z',
      nodes: [], employees: [], tasks: [],
    };
    await store.save(base);
    await store.save({ ...base, savedAt: '2026-08-30T17:01:00.000Z' });
    expect((await store.load())?.savedAt).toBe('2026-08-30T17:01:00.000Z');
    expect((await journal.readStream('workforce:test')).length).toBe(2);
  });
});
