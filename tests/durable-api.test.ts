import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startApi } from '../apps/api/src/server.js';
import type { Actor } from '../packages/control-plane/src/index.js';

const tokens = new Map<string, Actor>([
  ['planner-secret', { id: 'planner-1', role: 'planner' }],
  ['approver-secret', { id: 'approver-1', role: 'approver' }],
]);
const directories: string[] = [];
const order = {
  id: 'WO-DURABLE-1', project: 'TigerIQ', goal: 'Survive restart', scope: ['api'],
  invariants: ['Evidence > AI opinion'], acceptanceCriteria: ['state recovers'], status: 'draft',
};

afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('durable HTTP API', () => {
  it('recovers Work Order state and audit history after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tigeriq-durable-api-'));
    directories.push(directory);
    const journalPath = join(directory, 'events.jsonl');
    let api = await startApi({ tokens, journalPath });
    const create = await fetch(`${api.url}/v1/work-orders`, {
      method: 'POST', headers: { authorization: 'Bearer planner-secret', 'content-type': 'application/json', 'idempotency-key': 'create-1' },
      body: JSON.stringify(order),
    });
    expect(create.status).toBe(201);
    const approve = await fetch(`${api.url}/v1/work-orders/${order.id}/transitions`, {
      method: 'POST', headers: { authorization: 'Bearer approver-secret', 'content-type': 'application/json', 'idempotency-key': 'approve-1' },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(approve.status).toBe(200);
    await api.close();

    api = await startApi({ tokens, journalPath });
    const recovered = await fetch(`${api.url}/v1/work-orders/${order.id}`, { headers: { authorization: 'Bearer planner-secret' } });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ order: { status: 'approved' }, audit: [{ action: 'work-order.created' }, { action: 'work-order.approved' }] });
    await api.close();
  });

  it('rejects duplicate creation after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tigeriq-durable-api-'));
    directories.push(directory);
    const journalPath = join(directory, 'events.jsonl');
    let api = await startApi({ tokens, journalPath });
    const request = () => fetch(`${api.url}/v1/work-orders`, {
      method: 'POST', headers: { authorization: 'Bearer planner-secret', 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(order),
    });
    expect((await request()).status).toBe(201);
    await api.close();
    api = await startApi({ tokens, journalPath });
    expect((await request()).status).toBe(409);
    await api.close();
  });
});
