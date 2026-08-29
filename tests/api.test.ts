import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startApi } from '../apps/api/src/server.js';
import type { Actor } from '../packages/control-plane/src/index.js';

const actors: [string, Actor][] = [
  ['planner-secret', { id: 'planner-1', role: 'planner' }],
  ['approver-secret', { id: 'approver-1', role: 'approver' }],
  ['coder-secret', { id: 'coder-1', role: 'coder' }],
  ['judge-secret', { id: 'judge-1', role: 'judge' }],
];
const order = {
  id: 'WO-API-1', project: 'TigerIQ', goal: 'Exercise API', scope: ['api'],
  invariants: ['Evidence > AI opinion'], acceptanceCriteria: ['HTTP flow passes'], status: 'draft',
};

let api: Awaited<ReturnType<typeof startApi>>;

beforeEach(async () => { api = await startApi({ tokens: new Map(actors) }); });
afterEach(async () => api.close());

async function call(path: string, token?: string, body?: unknown, key: string = crypto.randomUUID()) {
  return fetch(`${api.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': key }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('HTTP API', () => {
  it('exposes health without leaking protected state', async () => {
    const response = await call('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', phase: 'phase-5' });
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect((await call('/ready')).status).toBe(200);
  });

  it('requires authentication for Work Orders', async () => {
    expect((await call('/v1/work-orders/WO-API-1')).status).toBe(401);
  });

  it('runs an authorized evidence-to-verification flow', async () => {
    expect((await call('/v1/work-orders', 'planner-secret', order)).status).toBe(201);
    expect((await call('/v1/work-orders/WO-API-1/transitions', 'approver-secret', { status: 'approved' })).status).toBe(200);
    expect((await call('/v1/work-orders/WO-API-1/transitions', 'coder-secret', { status: 'running' })).status).toBe(200);
    const evidence = {
      id: 'EV-API-1', workOrderId: order.id, gate: 'DONE', commitSha: 'abcdef123456',
      command: 'npm run ci', exitCode: 0, status: 'pass', timestamp: '2026-08-29T00:00:00Z',
    };
    expect((await call('/v1/work-orders/WO-API-1/evidence', 'coder-secret', evidence)).status).toBe(200);
    const decision = { gate: 'DONE', status: 'pass', evaluatorId: 'judge-1', evidenceIds: ['EV-API-1'], timestamp: '2026-08-29T00:01:00Z' };
    const verified = await call('/v1/work-orders/WO-API-1/gates', 'judge-secret', decision);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ order: { status: 'verified' } });
  });

  it('enforces role separation at the API boundary', async () => {
    const response = await call('/v1/work-orders', 'coder-secret', order);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'only a planner can create a work order' });
  });

  it('replays identical idempotent requests and rejects key reuse', async () => {
    const first = await call('/v1/work-orders', 'planner-secret', order, 'stable-key');
    const replay = await call('/v1/work-orders', 'planner-secret', order, 'stable-key');
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    const conflict = await call('/v1/work-orders', 'planner-secret', { ...order, id: 'WO-OTHER' }, 'stable-key');
    expect(conflict.status).toBe(409);
  });

  it('rejects oversized request bodies', async () => {
    await api.close();
    api = await startApi({ tokens: new Map(actors), maxBodyBytes: 32 });
    expect((await call('/v1/work-orders', 'planner-secret', order)).status).toBe(413);
  });

  it('rejects malformed input at the boundary', async () => {
    const response = await call('/v1/work-orders', 'planner-secret', { ...order, acceptanceCriteria: 'anything' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'acceptanceCriteria must be an array of non-empty strings' });
  });
});
