import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startApi } from '../apps/api/src/server.js';
import type { Actor } from '../packages/control-plane/src/index.js';

const actors: [string, Actor][] = [
  ['planner-secret', { id: 'planner-1', role: 'planner' }],
  ['approver-secret', { id: 'approver-1', role: 'approver' }],
  ['coder-secret', { id: 'NV12', role: 'coder' }],
  ['judge-secret', { id: 'NV19', role: 'judge' }],
];

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

describe('WorkItem projection API', () => {
  it('exposes owner-visible Coding Lane projection without creating a second queue', async () => {
    const workOrder = {
      id: 'CORE-API-1033',
      project: 'TigerIQ',
      goal: 'Core WorkItem V1',
      scope: ['packages/control-plane/src/index.ts', 'apps/api/src/server.ts'],
      invariants: ['No second queue'],
      acceptanceCriteria: ['owner-visible projection'],
      status: 'draft',
      issueRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/1033',
      sourceRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/1033',
      pr: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/1087',
      kind: 'coding',
      priority: 'P0',
      stage: 'coding-lane',
      nextAction: 'Implement projection',
    };

    expect((await call('/v1/work-orders', 'planner-secret', workOrder)).status).toBe(201);
    expect((await call('/v1/work-orders/CORE-API-1033/transitions', 'approver-secret', { status: 'approved' })).status).toBe(200);
    expect((await call('/v1/work-orders/CORE-API-1033/transitions', 'coder-secret', { status: 'running' })).status).toBe(200);

    const projection = await call('/v1/work-items/CORE-API-1033', 'planner-secret');
    expect(projection.status).toBe(200);
    expect(await projection.json()).toMatchObject({
      workItemId: 'CORE-API-1033',
      status: 'WORKING',
      sourceRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/1033',
      issueRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/1033',
      pr: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/1087',
      kind: 'coding',
      assignedExecutor: 'NV12',
      implementer: 'NV12',
      stage: 'coding-lane',
      priority: 'P0',
      scopeLease: { ownerId: 'NV12', state: 'active' },
      blockers: [],
      nextAction: 'Implement projection',
    });

    const alias = await call('/v1/work-orders/CORE-API-1033/work-item', 'planner-secret');
    expect(alias.status).toBe(200);
    expect(await alias.json()).toMatchObject({ workItemId: 'CORE-API-1033', status: 'WORKING' });
  });
});
