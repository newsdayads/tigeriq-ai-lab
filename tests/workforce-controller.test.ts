import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isTailscaleAddress, startWorkforceController } from '../apps/workforce-controller/src/server.js';
import { FileJournal } from '../packages/event-store/src/index.js';
import { CapabilityScheduler, TaskQueue, WorkforceRegistry } from '../packages/workforce/src/index.js';
import { MemoryWorkforceStateStore, DurableWorkforceRuntime } from '../packages/workforce/src/runtime.js';
import { DurableNodeCredentialStore } from '../packages/workforce/src/node-credentials.js';
import { NodePairingService, verifyAndroidP256PairingProof } from '../packages/workforce/src/pairing.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture(options: { allowTailnetSelfPair?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-controller-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const registry = new WorkforceRegistry();
  const queue = new TaskQueue();
  const runtime = new DurableWorkforceRuntime(registry, queue, new CapabilityScheduler(registry), new MemoryWorkforceStateStore());
  const credentials = new DurableNodeCredentialStore(new FileJournal(join(dir, 'credentials.jsonl')));
  const pairing = new NodePairingService(verifyAndroidP256PairingProof);
  const controller = await startWorkforceController({
    runtime,
    credentials,
    pairing,
    adminSecret: 'admin-secret',
    allowTailnetSelfPair: options.allowTailnetSelfPair,
    host: '127.0.0.1',
    port: 0,
  });
  cleanups.push(controller.close);
  return { ...controller, registry, runtime };
}

function deviceProof(challenge: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    proof: sign('sha256', Buffer.from(challenge, 'utf8'), privateKey).toString('base64url'),
  };
}

async function json(response: Response) {
  return await response.json() as any;
}

describe('Workforce Controller API', () => {
  it('pairs a physical-node identity, persists scoped auth, accepts heartbeat, self-enrolls its employee and projects status', async () => {
    const app = await fixture();

    const unauthorized = await fetch(`${app.url}/api/admin/pairing-challenge`, { method: 'POST' });
    expect(unauthorized.status).toBe(401);

    const challengeResponse = await fetch(`${app.url}/api/admin/pairing-challenge`, {
      method: 'POST', headers: { 'x-tigeriq-admin-secret': 'admin-secret' },
    });
    expect(challengeResponse.status).toBe(201);
    const challengeBody = await json(challengeResponse);
    const signed = deviceProof(challengeBody.pairing.challenge);

    const pairResponse = await fetch(`${app.url}/api/node/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challengeBody.pairing.challengeId,
        nodeId: 'PHONE-01',
        publicKey: signed.publicKey,
        proof: signed.proof,
        kind: 'android',
        platform: 'Android 16 / Z Flip 7',
        agentVersion: '0.3.0-pairing',
        capabilities: ['android-ui', 'research', 'gemini'],
      }),
    });
    expect(pairResponse.status).toBe(201);
    const paired = await json(pairResponse);
    expect(paired.node.nodeId).toBe('PHONE-01');
    expect(paired.credential.token).toBeTruthy();

    const nodeHeaders = {
      'content-type': 'application/json',
      'x-tigeriq-credential-id': paired.credential.credentialId,
      authorization: `Bearer ${paired.credential.token}`,
    };

    const badHeartbeat = await fetch(`${app.url}/api/node/heartbeat`, {
      method: 'POST',
      headers: { ...nodeHeaders, authorization: 'Bearer wrong' },
      body: JSON.stringify({ batteryPct: 75 }),
    });
    expect(badHeartbeat.status).toBe(401);

    const heartbeat = await fetch(`${app.url}/api/node/heartbeat`, {
      method: 'POST',
      headers: nodeHeaders,
      body: JSON.stringify({ status: 'online', batteryPct: 75, temperatureC: 34, agentVersion: '0.3.0-pairing' }),
    });
    expect(heartbeat.status).toBe(200);
    const heartbeatBody = await json(heartbeat);
    expect(heartbeatBody.node.batteryPct).toBe(75);
    expect(heartbeatBody.node.agentVersion).toBe('0.3.0-pairing');

    const employeeResponse = await fetch(`${app.url}/api/node/employee`, {
      method: 'POST',
      headers: nodeHeaders,
      body: JSON.stringify({
        employeeId: 'EMP-001', displayName: 'EMP-001 · Researcher', department: 'Research', role: 'Researcher',
        provider: 'Gemini', capabilities: ['research', 'gemini'],
      }),
    });
    expect(employeeResponse.status).toBe(201);
    const employee = await json(employeeResponse);
    expect(employee.employee.nodeId).toBe('PHONE-01');
    expect(employee.employee.provider).toBe('Gemini');

    const idempotentEmployee = await fetch(`${app.url}/api/node/employee`, {
      method: 'POST', headers: nodeHeaders,
      body: JSON.stringify({
        employeeId: 'EMP-001', displayName: 'EMP-001 · Researcher', department: 'Research', role: 'Researcher',
        provider: 'Gemini', capabilities: ['research', 'gemini'],
      }),
    });
    expect(idempotentEmployee.status).toBe(200);
    expect((await json(idempotentEmployee)).idempotent).toBe(true);

    const statusResponse = await fetch(`${app.url}/api/workforce/status`);
    expect(statusResponse.status).toBe(200);
    const status = await json(statusResponse);
    expect(status.workforce.nodes.total).toBe(1);
    expect(status.workforce.nodes.byKind.android).toBe(1);
    expect(status.workforce.employees.total).toBe(1);
    expect(status.workforce.employees.departments.Research).toBe(1);
  });

  it('recognizes Tailscale CGNAT peers and keeps self-pair closed unless explicitly enabled', async () => {
    expect(isTailscaleAddress('100.64.0.1')).toBe(true);
    expect(isTailscaleAddress('100.97.23.87')).toBe(true);
    expect(isTailscaleAddress('::ffff:100.127.255.254')).toBe(true);
    expect(isTailscaleAddress('100.128.0.1')).toBe(false);
    expect(isTailscaleAddress('192.168.1.10')).toBe(false);

    const disabled = await fixture();
    const disabledResponse = await fetch(`${disabled.url}/api/node/pairing-challenge`, { method: 'POST' });
    expect(disabledResponse.status).toBe(403);
    expect((await json(disabledResponse)).error).toBe('tailnet_self_pair_disabled');

    const enabledButLoopback = await fixture({ allowTailnetSelfPair: true });
    const loopbackResponse = await fetch(`${enabledButLoopback.url}/api/node/pairing-challenge`, { method: 'POST' });
    expect(loopbackResponse.status).toBe(403);
    expect((await json(loopbackResponse)).error).toBe('tailnet_peer_required');
  });

  it('refuses public wildcard binding', async () => {
    const registry = new WorkforceRegistry();
    const runtime = new DurableWorkforceRuntime(registry, new TaskQueue(), new CapabilityScheduler(registry));
    const dir = await mkdtemp(join(tmpdir(), 'tigeriq-controller-bind-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const credentials = new DurableNodeCredentialStore(new FileJournal(join(dir, 'credentials.jsonl')));
    const pairing = new NodePairingService(() => true);
    await expect(startWorkforceController({ runtime, credentials, pairing, host: '0.0.0.0', port: 0 })).rejects.toThrow('public wildcard bind is forbidden');
  });
});
