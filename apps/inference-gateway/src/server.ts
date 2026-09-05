import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DeviceSessionService,
  InferenceGateway,
  InferenceGatewayError,
  type DeviceSessionRequest,
  type GatewayResult,
  type InferenceRequest,
} from '../../../packages/inference-gateway/src/index.js';

const MAX_BODY_BYTES = 256_000;
const MAX_IDEMPOTENCY_RECORDS = 4_096;
const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

export interface InferenceGatewayServerOptions {
  gateway: InferenceGateway;
  sessions: DeviceSessionService;
  host?: string;
  port?: number;
}

interface IdempotentRecord {
  fingerprint: string;
  response: GatewayResult;
}

class HttpInputError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function idempotencyCacheKey(
  claims: { sub: string; nodeId: string; deviceId?: string },
  idempotencyKey: string,
): string {
  const device = claims.deviceId?.trim() || 'NO_DEVICE';
  return [claims.sub, claims.nodeId, device, idempotencyKey]
    .map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`)
    .join('|');
}

export async function startInferenceGatewayServer(options: InferenceGatewayServerOptions) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid port');
  const idempotency = new Map<string, IdempotentRecord>();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    try {
      if (request.method === 'POST' && url.pathname === '/v1/inference/sessions') {
        const data = await jsonBody(request) as unknown as DeviceSessionRequest;
        const credentialId = header(request, 'x-tigeriq-credential-id');
        const bearerToken = bearer(request);
        const session = await options.sessions.mint(data, { credentialId, bearerToken });
        return json(response, 201, { ok: true, session });
      }

      if (request.method === 'POST' && url.pathname === '/v1/inference') {
        const claims = options.sessions.verify(bearer(request));
        const idempotencyKey = header(request, 'idempotency-key');
        if (!idempotencyKey || idempotencyKey.length > 128) throw new HttpInputError(400, 'valid Idempotency-Key is required');
        const data = await jsonBody(request) as unknown as InferenceRequest;
        if (data.employeeId !== claims.sub) {
          throw new InferenceGatewayError('IDENTITY_MISMATCH', 409, 'session employee identity does not match inference request', false);
        }
        const cacheKey = idempotencyCacheKey(claims, idempotencyKey);
        const fingerprint = requestFingerprint(data);
        const existing = idempotency.get(cacheKey);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new HttpInputError(400, 'Idempotency-Key reused for different request');
          return json(response, 200, successBody(existing.response));
        }
        if (idempotency.size >= MAX_IDEMPOTENCY_RECORDS) {
          throw new InferenceGatewayError(
            'PROVIDER_UNAVAILABLE',
            503,
            'gateway idempotency capacity exhausted; refusing new unique request keys',
            true,
          );
        }
        const result = await options.gateway.infer(data);
        idempotency.set(cacheKey, { fingerprint, response: result });
        return json(response, 200, successBody(result));
      }

      if (request.method === 'GET' && url.pathname === '/v1/inference/health') {
        options.sessions.verify(bearer(request));
        return json(response, 200, { ok: true, providers: options.gateway.health(), gatewayVersion: 'v1' });
      }

      return json(response, 404, errorBody('INVALID_REQUEST', 'route not found', false, null));
    } catch (error) {
      if (error instanceof InferenceGatewayError) {
        return json(response, error.status, errorBody(error.code, error.message, error.retryable, error.retryAfterMs, error.attempts));
      }
      if (error instanceof HttpInputError) {
        return json(response, error.status, errorBody('INVALID_REQUEST', error.message, false, null));
      }
      return json(response, 503, errorBody('PROVIDER_UNAVAILABLE', 'inference gateway unavailable', true, null));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    host,
    port: address.port,
    baseUrl: `http://${host}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function successBody(result: GatewayResult) {
  return {
    ok: true,
    requestId: result.requestId,
    employee: { employeeId: result.employeeId },
    result: { text: result.text, decision: result.decision },
    evidence: {
      selectedBackendIdentity: result.selectedBackendIdentity,
      attempts: result.attempts,
      outputSha256: result.outputSha256,
      budget: result.budget,
      gatewayVersion: result.gatewayVersion,
    },
  };
}

function errorBody(
  code: string,
  message: string,
  retryable: boolean,
  retryAfterMs: number | null,
  attempts?: unknown[],
) {
  return {
    ok: false,
    error: {
      code,
      message: String(message).slice(0, 256),
      retryable,
      retryAfterMs,
      ...(attempts?.length ? { attempts } : {}),
    },
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.length;
    if (total > MAX_BODY_BYTES) throw new HttpInputError(413, 'payload too large');
    chunks.push(part);
  }
  if (!chunks.length) throw new HttpInputError(400, 'JSON body is required');
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpInputError(400, 'invalid JSON body');
  }
}

function bearer(request: IncomingMessage): string {
  const value = request.headers.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return typeof value === 'string' ? value.trim() : '';
}

function requestFingerprint(request: InferenceRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}
