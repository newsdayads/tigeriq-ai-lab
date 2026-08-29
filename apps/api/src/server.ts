import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ControlPlane, type Actor, type GateDecision, type WorkOrderSnapshot } from '../../../packages/control-plane/src/index.js';
import { DurableControlPlane } from '../../../packages/durable-control-plane/src/index.js';
import type { EvidenceRecord } from '../../../packages/evidence/src/index.js';
import { FileJournal } from '../../../packages/event-store/src/index.js';
import { JournalIdempotencyStore, MemoryIdempotencyStore, type IdempotencyStore } from '../../../packages/idempotency/src/index.js';
import type { WorkOrder, WorkOrderStatus } from '../../../packages/work-orders/src/index.js';
import { health } from './index.js';

interface ApiOptions {
  tokens: ReadonlyMap<string, Actor>;
  port?: number;
  host?: string;
  maxBodyBytes?: number;
  journalPath?: string;
  idempotencyPath?: string;
}

export async function startApi(options: ApiOptions) {
  if (options.tokens.size === 0) throw new Error('at least one API token is required');
  const plane: Plane = options.journalPath
    ? new DurableControlPlane(new FileJournal(options.journalPath))
    : new ControlPlane();
  const idempotency: IdempotencyStore = options.journalPath
    ? new JournalIdempotencyStore(options.idempotencyPath ?? `${options.journalPath}.idempotency`)
    : new MemoryIdempotencyStore();
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  const server = createServer(async (request, response) => {
    response.setHeader('x-request-id', safeRequestId(header(request, 'x-request-id')) ?? randomUUID());
    try {
      await route(request, response, plane, options.tokens, idempotency, maxBodyBytes);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : domainStatus(error);
      send(response, status, { error: status === 500 ? 'internal_error' : error instanceof Error ? error.message : 'request_failed' });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://${address.address}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  plane: Plane,
  tokens: ReadonlyMap<string, Actor>,
  cache: IdempotencyStore,
  maxBodyBytes: number,
): Promise<void> {
  const method = request.method ?? 'GET';
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (method === 'GET' && path === '/health') return send(response, 200, health());
  if (method === 'GET' && path === '/ready') return send(response, 200, { status: 'ready' });

  const actor = authenticate(request, tokens);
  const match = /^\/v1\/work-orders\/([^/]+)(?:\/(transitions|evidence|gates))?$/.exec(path);
  if (method === 'GET' && match?.[1] && !match[2]) return send(response, 200, await plane.get(decodeURIComponent(match[1])));
  if (method !== 'POST') throw new HttpError(404, 'not_found');

  const idempotencyKey = header(request, 'idempotency-key');
  if (!idempotencyKey || idempotencyKey.length > 128) throw new HttpError(400, 'valid idempotency-key is required');
  if (!header(request, 'content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'application/json is required');
  const raw = await readBody(request, maxBodyBytes);
  const fingerprint = createHash('sha256').update(`${method}\n${path}\n${raw}`).digest('hex');
  const cached = await cache.get(actor.id, idempotencyKey);
  if (cached) {
    if (cached.fingerprint !== fingerprint) throw new HttpError(409, 'idempotency-key reused with different request');
    return send(response, cached.status, cached.body);
  }
  const body = parseObject(raw);
  let result: unknown;
  let status = 200;
  if (path === '/v1/work-orders') {
    result = await plane.create(asWorkOrder(body), actor);
    status = 201;
  } else if (match?.[1] && match[2] === 'transitions') {
    result = await plane.transition(decodeURIComponent(match[1]), asStatus(body.status), actor);
  } else if (match?.[1] && match[2] === 'evidence') {
    result = await plane.recordEvidence(decodeURIComponent(match[1]), asEvidence(body), actor);
  } else if (match?.[1] && match[2] === 'gates') {
    result = await plane.recordGateDecision(decodeURIComponent(match[1]), asDecision(body), actor);
  } else {
    throw new HttpError(404, 'not_found');
  }
  await cache.put(actor.id, idempotencyKey, { fingerprint, status, body: result });
  send(response, status, result);
}

function authenticate(request: IncomingMessage, tokens: ReadonlyMap<string, Actor>): Actor {
  const authorization = header(request, 'authorization');
  if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'authentication_required');
  const candidate = Buffer.from(createHash('sha256').update(authorization.slice(7)).digest());
  for (const [token, actor] of tokens) {
    const expected = Buffer.from(createHash('sha256').update(token).digest());
    if (timingSafeEqual(candidate, expected)) return actor;
  }
  throw new HttpError(401, 'invalid_token');
}

async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > limit) throw new HttpError(413, 'request_body_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'body must be a JSON object');
  }
}

function asWorkOrder(body: Record<string, unknown>): WorkOrder {
  return {
    id: requiredString(body, 'id'), project: requiredString(body, 'project'), goal: requiredString(body, 'goal'),
    scope: stringArray(body, 'scope'), invariants: stringArray(body, 'invariants'),
    acceptanceCriteria: stringArray(body, 'acceptanceCriteria'), status: asStatus(body.status),
    ...(body.dependencies === undefined ? {} : { dependencies: stringArray(body, 'dependencies') }),
    ...(body.edgeCases === undefined ? {} : { edgeCases: stringArray(body, 'edgeCases') }),
    ...(body.rollback === undefined ? {} : { rollback: requiredString(body, 'rollback') }),
  };
}

function asEvidence(body: Record<string, unknown>): EvidenceRecord {
  const status = requiredString(body, 'status');
  if (!['pass', 'fail', 'error'].includes(status)) throw new HttpError(400, 'invalid evidence status');
  if (typeof body.exitCode !== 'number' || !Number.isInteger(body.exitCode)) throw new HttpError(400, 'exitCode must be an integer');
  return {
    id: requiredString(body, 'id'), workOrderId: requiredString(body, 'workOrderId'), gate: requiredString(body, 'gate'),
    commitSha: requiredString(body, 'commitSha'), command: requiredString(body, 'command'), exitCode: body.exitCode,
    status: status as EvidenceRecord['status'], timestamp: requiredString(body, 'timestamp'),
    ...(body.artifactUris === undefined ? {} : { artifactUris: stringArray(body, 'artifactUris') }),
    ...(body.logDigest === undefined ? {} : { logDigest: requiredString(body, 'logDigest') }),
  };
}

function asDecision(body: Record<string, unknown>): GateDecision {
  const status = requiredString(body, 'status');
  if (!['pass', 'fail', 'blocked'].includes(status)) throw new HttpError(400, 'invalid gate status');
  return {
    gate: requiredString(body, 'gate') as GateDecision['gate'], status: status as GateDecision['status'],
    evaluatorId: requiredString(body, 'evaluatorId'), evidenceIds: stringArray(body, 'evidenceIds'),
    timestamp: requiredString(body, 'timestamp'),
    ...(body.reason === undefined ? {} : { reason: requiredString(body, 'reason') }),
  };
}

function asStatus(value: unknown): WorkOrderStatus {
  if (typeof value !== 'string' || !['draft', 'approved', 'running', 'failed', 'blocked', 'verified'].includes(value)) {
    throw new HttpError(400, 'invalid work order status');
  }
  return value as WorkOrderStatus;
}

function stringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new HttpError(400, `${key} must be an array of non-empty strings`);
  }
  return value;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${key} is required`);
  return value;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function safeRequestId(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : undefined;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface Plane {
  create(order: WorkOrder, actor: Actor): WorkOrderSnapshot | Promise<WorkOrderSnapshot>;
  transition(id: string, status: WorkOrderStatus, actor: Actor): WorkOrderSnapshot | Promise<WorkOrderSnapshot>;
  recordEvidence(id: string, evidence: EvidenceRecord, actor: Actor): WorkOrderSnapshot | Promise<WorkOrderSnapshot>;
  recordGateDecision(id: string, decision: GateDecision, actor: Actor): WorkOrderSnapshot | Promise<WorkOrderSnapshot>;
  get(id: string): WorkOrderSnapshot | Promise<WorkOrderSnapshot>;
}

function domainStatus(error: unknown): number {
  if (!(error instanceof Error)) return 500;
  if (/only a|requires an|requires reviewer|cannot evaluate/.test(error.message)) return 403;
  if (/not found/.test(error.message)) return 404;
  if (/invalid transition|already exists|mismatch|expected version|journal is locked/.test(error.message)) return 409;
  if (/invalid|required|must|unknown evidence|failing evidence/.test(error.message)) return 400;
  return 500;
}
