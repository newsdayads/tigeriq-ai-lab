import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableControlPlane } from '../../dist/packages/durable-control-plane/src/index.js';
import { FileJournal } from '../../dist/packages/event-store/src/index.js';
import { ModelRouter, createOllamaAdapter } from '../../dist/packages/model-router/src/index.js';
import { WorkOrderWorker } from '../../dist/packages/worker/src/index.js';

const model = process.env.TIGERIQ_OLLAMA_MODEL || 'qwen2.5-coder:14b';
const commitSha = process.env.TIGERIQ_COMMIT_SHA;
if (!commitSha || !/^[0-9a-f]{7,64}$/i.test(commitSha)) {
  throw new Error('TIGERIQ_COMMIT_SHA must be a real hexadecimal git commit SHA');
}

const dir = await mkdtemp(join(tmpdir(), 'tigeriq-wo007-e2e-'));
const journalPath = join(dir, 'journal.jsonl');
const journal = new FileJournal(journalPath);
const planner = { id: 'chief-of-staff-e2e', role: 'planner' };
const approver = { id: 'owner-gate-e2e', role: 'approver' };
const coder = { id: 'pc01-coder-e2e', role: 'coder' };
const reviewer = { id: 'pc01-reviewer-e2e', role: 'reviewer' };
const judge = { id: 'pc01-judge-e2e', role: 'judge' };
const workOrderId = `WO-007-E2E-${Date.now()}`;

try {
  const plane = new DurableControlPlane(journal);
  await plane.create({
    id: workOrderId,
    project: 'TigerIQ AI Lab',
    goal: 'Physical PC01 cloud-outage to Ollama fallback proof',
    scope: ['model routing', 'local Ollama', 'durable restart recovery'],
    invariants: ['no MAIN mutation', 'no Production mutation', 'no secrets in evidence'],
    acceptanceCriteria: ['cloud route fails', 'Ollama route succeeds', 'restart recovery preserves verified state'],
    status: 'draft',
  }, planner);
  await plane.transition(workOrderId, 'approved', approver);
  await plane.transition(workOrderId, 'running', coder);

  // Reconstruct the durable plane before execution to prove restart recovery of RUNNING state.
  const restartedPlane = new DurableControlPlane(new FileJournal(journalPath));
  const cloudOutage = {
    provider: 'gemini',
    async execute() { throw new Error('WO-007 simulated cloud outage'); },
  };
  const router = new ModelRouter([
    cloudOutage,
    createOllamaAdapter({ model, baseUrl: 'http://127.0.0.1:11434', timeoutMs: 180000 }),
  ], {
    primary: { provider: 'gemini', model: 'simulated-cloud' },
    fallbacks: [{ provider: 'ollama', model, local: true }],
  });

  const worker = new WorkOrderWorker({
    controlPlane: restartedPlane,
    router,
    actors: { coder, reviewer, judge },
    commitSha,
    reviewer: async ({ routed }) => ({
      pass: routed.target.provider === 'ollama' && routed.attempts.length >= 2 && routed.attempts[0]?.ok === false,
      reason: 'independent deterministic route/evidence review',
    }),
    judge: async ({ workOrder, routed }) => ({
      pass: workOrder.evidence.some((item) => item.status === 'pass') && routed.target.provider === 'ollama',
      reason: 'independent deterministic DONE gate',
    }),
  });

  const result = await worker.run(workOrderId, 'Reply exactly: TIGERIQ_WO007_LOCAL_FALLBACK_OK');
  const recovered = await new DurableControlPlane(new FileJournal(journalPath)).get(workOrderId);
  const pass = result.routed.target.provider === 'ollama'
    && result.routed.attempts[0]?.ok === false
    && result.routed.attempts.at(-1)?.ok === true
    && result.snapshot.order.status === 'verified'
    && recovered.order.status === 'verified'
    && recovered.evidence.some((item) => item.command === `model-router:ollama/${model}` && item.commitSha === commitSha);

  const output = {
    ok: pass,
    workOrderId,
    commitSha,
    model,
    provider: result.routed.target.provider,
    attempts: result.routed.attempts,
    status: result.snapshot.order.status,
    recoveredStatus: recovered.order.status,
    response: result.routed.text.trim().slice(0, 500),
    evidence: recovered.evidence,
    decisions: recovered.decisions,
  };
  console.log(JSON.stringify(output, null, 2));
  if (!pass) process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
