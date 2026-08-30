import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DurableWorkforceRuntime } from '../../../packages/workforce/src/runtime.js';
import type { DurableNodeCredentialStore } from '../../../packages/workforce/src/node-credentials.js';
import type { NodePairingService } from '../../../packages/workforce/src/pairing.js';
import { buildWorkforceStatus } from '../../../packages/workforce/src/status.js';
import type { EmployeeAvailability, NodeStatus, WorkerKind } from '../../../packages/workforce/src/index.js';

const MAX_BODY_BYTES = 32_768;
const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

export interface WorkforceControllerOptions {
  runtime: DurableWorkforceRuntime;
  pairing: NodePairingService;
  credentials: DurableNodeCredentialStore;
  adminSecret?: string;
  host?: string;
  port?: number;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.length;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large');
    chunks.push(part);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

function text(value: unknown, max = 256): string {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : '';
}

function stringList(value: unknown, maxItems = 32): string[] {
  if (!Array.isArray(value) || value.length > maxItems) return [];
  const rows = value.map((item) => text(item, 128)).filter(Boolean);
  return rows.length === value.length ? [...new Set(rows)] : [];
}

function numberInRange(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function assertPrivateBind(host: string): void {
  if (host === '0.0.0.0' || host === '::') {
    throw new Error('public wildcard bind is forbidden; use loopback or an explicit private/Tailscale address');
  }
}

function adminAuthorized(request: IncomingMessage, secret: string): boolean {
  if (!secret) return false;
  const supplied = request.headers['x-tigeriq-admin-secret'];
  return typeof supplied === 'string' && safeEqual(supplied, secret);
}

function bearer(request: IncomingMessage): string {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer ')) return '';
  return value.slice(7).trim();
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function startWorkforceController(options: WorkforceControllerOptions) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const adminSecret = options.adminSecret ?? '';
  assertPrivateBind(host);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid port');

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/api/workforce/status') {
        return json(response, 200, { ok: true, workforce: buildWorkforceStatus(options.runtime.registry, options.runtime.queue) });
      }

      if (request.method === 'POST' && url.pathname === '/api/admin/pairing-challenge') {
        if (!adminSecret) throw new HttpError(503, 'admin_auth_not_configured');
        if (!adminAuthorized(request, adminSecret)) throw new HttpError(401, 'unauthorized');
        return json(response, 201, { ok: true, pairing: options.pairing.issueChallenge() });
      }

      if (request.method === 'POST' && url.pathname === '/api/node/pair') {
        const data = await body(request);
        const challengeId = text(data.challengeId, 128);
        const nodeId = text(data.nodeId, 128);
        const publicKey = text(data.publicKey, 4096);
        const proof = text(data.proof, 1024);
        const platform = text(data.platform, 128);
        const agentVersion = text(data.agentVersion, 64);
        const capabilities = stringList(data.capabilities);
        const kind = text(data.kind, 32) as WorkerKind;
        if (!challengeId || !nodeId || !publicKey || !proof || !platform || !agentVersion || !capabilities.length) {
          throw new HttpError(400, 'invalid_pairing_request');
        }
        if (!['android', 'api', 'local', 'browser', 'tool'].includes(kind)) throw new HttpError(400, 'invalid_worker_kind');
        if (options.runtime.registry.getNode(nodeId)) throw new HttpError(409, 'node_already_registered');

        const credential = await options.pairing.pair({ challengeId, nodeId, publicKey, proof });
        await options.credentials.issue(credential, publicKey);
        options.runtime.registry.registerNode({
          nodeId,
          kind,
          platform,
          agentVersion,
          capabilities,
          status: 'online',
          lastHeartbeatAt: new Date().toISOString(),
        });
        await options.runtime.checkpoint();
        return json(response, 201, {
          ok: true,
          node: { nodeId, kind, platform, agentVersion, capabilities, status: 'online' },
          credential,
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/admin/employees') {
        if (!adminSecret) throw new HttpError(503, 'admin_auth_not_configured');
        if (!adminAuthorized(request, adminSecret)) throw new HttpError(401, 'unauthorized');
        const data = await body(request);
        const employeeId = text(data.employeeId, 128);
        const displayName = text(data.displayName, 128);
        const department = text(data.department, 128);
        const team = text(data.team, 128) || undefined;
        const role = text(data.role, 128);
        const nodeId = text(data.nodeId, 128);
        const provider = text(data.provider, 128) || undefined;
        const model = text(data.model, 128) || undefined;
        const capabilities = stringList(data.capabilities);
        const concurrencyLimit = numberInRange(data.concurrencyLimit, 1, 16) ?? 1;
        if (!employeeId || !displayName || !department || !role || !nodeId || !capabilities.length) {
          throw new HttpError(400, 'invalid_employee');
        }
        if (!options.runtime.registry.getNode(nodeId)) throw new HttpError(404, 'node_not_found');
        options.runtime.registry.registerEmployee({
          employeeId, displayName, department, team, role, nodeId, provider, model, capabilities,
          availability: 'idle' satisfies EmployeeAvailability,
          healthScore: 100,
          concurrencyLimit,
        });
        await options.runtime.checkpoint();
        return json(response, 201, { ok: true, employee: options.runtime.registry.getEmployee(employeeId) });
      }

      if (request.method === 'POST' && url.pathname === '/api/node/heartbeat') {
        const credentialId = text(request.headers['x-tigeriq-credential-id'], 128);
        const token = bearer(request);
        const authenticated = await options.credentials.authenticate(credentialId, token, 'heartbeat');
        if (!authenticated) throw new HttpError(401, 'unauthorized');
        const data = await body(request);
        const requestedStatus = text(data.status, 32);
        const status: NodeStatus = requestedStatus === 'degraded' ? 'degraded' : 'online';
        const batteryPct = numberInRange(data.batteryPct, 0, 100);
        const temperatureC = numberInRange(data.temperatureC, -20, 100);
        const agentVersion = text(data.agentVersion, 64) || undefined;
        if (!options.runtime.registry.getNode(authenticated.nodeId)) throw new HttpError(404, 'node_not_found');
        const node = options.runtime.registry.heartbeat(authenticated.nodeId, {
          status,
          lastHeartbeatAt: new Date().toISOString(),
          batteryPct,
          temperatureC,
          agentVersion,
        });
        await options.runtime.checkpoint();
        return json(response, 200, { ok: true, node });
      }

      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof HttpError) return json(response, error.status, { error: error.message });
      const message = error instanceof Error ? error.message : 'workforce_controller_unavailable';
      const known = new Set([
        'pairing challenge not found', 'pairing challenge already used', 'pairing challenge expired',
        'pairing proof verification failed', 'node already exists', 'employee already exists',
      ]);
      return json(response, known.has(message) ? 400 : 503, { error: known.has(message) ? message.replace(/ /g, '_') : 'workforce_controller_unavailable' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://${address.address}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
