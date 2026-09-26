import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DurableControlPlane } from '../packages/durable-control-plane/src/index.js';
import { FileJournal } from '../packages/event-store/src/index.js';
import { ModelRouter, type ProviderAdapter, type RoutingPolicy } from '../packages/model-router/src/index.js';
import { WorkOrderWorker } from '../packages/worker/src/index.js';
import type { WorkOrder } from '../packages/work-orders/src/index.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const planner = { id: 'chief-of-staff', role: 'planner' as const };
const approver = { id: 'owner-gate', role: 'approver' as const };
const coder = { id: 'pc01-coder', role: 'coder' as const };
const reviewer = { id: 'independent-reviewer', role: 'reviewer' as const };
const judge = { id: 'independent-judge', role: 'judge' as const };
const commitSha = '17ca2c28';

function order(id: string): WorkOrder {
  return {
    id,
    project: 'TigerIQ AI Lab',
    goal: 'Prove durable cloud-to-local execution fallback',
    scope: ['model routing', 'durable execution'],
    invariants: ['no production mutation'],
    acceptanceCriteria: ['local fallback executes', 'independent gates pass'],
    status: 'draft',
  };
}

async function durablePlane() {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-worker-'));
  dirs.push(dir);
  const journal = new FileJournal(join(dir, 'journal.jsonl'));
  return { journal, plane: new DurableControlPlane(journal) };
}

describe('WorkOrderWorker', () => {
  it('recovers a running Work Order after restart and falls back from cloud to local', async () => {
    const { journal, plane } = await durablePlane();
    await plane.create(order('WO-LOCAL-1'), planner);
    await plane.transition('WO-LOCAL-1', 'approved', approver);
    await plane.transition('WO-LOCAL-1', 'running', coder);

    const cloud: ProviderAdapter = {
      provider: 'gemini',
      async execute() { throw new Error('simulated cloud outage'); },
    };
    const local: ProviderAdapter = {
      provider: 'ollama',
      async execute() { return 'LOCAL_EXECUTION_OK'; },
    };
    const policy: RoutingPolicy = {
      primary: { provider: 'gemini', model: 'cloud-model' },
      fallbacks: [{ provider: 'ollama', model: 'qwen2.5-coder:14b', local: true }],
    };

    const restartedPlane = new DurableControlPlane(journal);
    const worker = new WorkOrderWorker({
      controlPlane: restartedPlane,
      router: new ModelRouter([cloud, local], policy),
      actors: { coder, reviewer, judge },
      commitSha,
      reviewer: async ({ routed }) => ({ pass: routed.text === 'LOCAL_EXECUTION_OK' }),
      judge: async ({ workOrder, routed }) => ({
        pass: workOrder.evidence.length === 1 && routed.target.provider === 'ollama',
      }),
    });

    const result = await worker.run('WO-LOCAL-1', 'execute safely');
    expect(result.routed.target.provider).toBe('ollama');
    expect(result.routed.attempts.map((attempt) => attempt.ok)).toEqual([false, true]);
    expect(result.snapshot.order.status).toBe('verified');
    expect(result.snapshot.implementerId).toBe(coder.id);
    expect(result.snapshot.evidence).toHaveLength(1);
    expect(result.snapshot.evidence[0]?.commitSha).toBe(commitSha);
    expect(result.snapshot.decisions.map((decision) => [decision.gate, decision.status])).toEqual([
      ['REVIEW', 'pass'],
      ['DONE', 'pass'],
    ]);

    const recovered = await new DurableControlPlane(journal).get('WO-LOCAL-1');
    expect(recovered.order.status).toBe('verified');
    expect(recovered.evidence[0]?.command).toBe('model-router:ollama/qwen2.5-coder:14b');
  });

  it('fails closed when all model routes fail', async () => {
    const { plane } = await durablePlane();
    await plane.create(order('WO-LOCAL-2'), planner);
    await plane.transition('WO-LOCAL-2', 'approved', approver);

    const failed: ProviderAdapter = {
      provider: 'ollama',
      async execute() { throw new Error('local unavailable'); },
    };
    const policy: RoutingPolicy = {
      primary: { provider: 'ollama', model: 'qwen2.5-coder:14b', local: true },
      fallbacks: [],
    };
    const worker = new WorkOrderWorker({
      controlPlane: plane,
      router: new ModelRouter([failed], policy),
      actors: { coder, reviewer, judge },
      commitSha,
      reviewer: async () => ({ pass: true }),
      judge: async () => ({ pass: true }),
    });

    await expect(worker.run('WO-LOCAL-2', 'execute safely')).rejects.toThrow('all configured model routes failed');
    const snapshot = await plane.get('WO-LOCAL-2');
    expect(snapshot.order.status).toBe('failed');
    expect(snapshot.evidence[0]?.status).toBe('fail');
    expect(snapshot.evidence[0]?.commitSha).toBe(commitSha);
  });

  it('rejects non-independent worker identities', async () => {
    const { plane } = await durablePlane();
    expect(() => new WorkOrderWorker({
      controlPlane: plane,
      router: new ModelRouter([]),
      actors: { coder, reviewer: { id: coder.id, role: 'reviewer' }, judge },
      commitSha,
      reviewer: async () => ({ pass: true }),
      judge: async () => ({ pass: true }),
    })).toThrow('coder, reviewer and judge must be independent');
  });

  it('rejects placeholder or missing commit identity for evidence', async () => {
    const { plane } = await durablePlane();
    expect(() => new WorkOrderWorker({
      controlPlane: plane,
      router: new ModelRouter([]),
      actors: { coder, reviewer, judge },
      commitSha: 'local-worker',
      reviewer: async () => ({ pass: true }),
      judge: async () => ({ pass: true }),
    })).toThrow('worker commitSha must be a real hexadecimal git commit SHA');
  });
});
