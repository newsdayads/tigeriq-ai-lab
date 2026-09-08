export type TypedCapability =
  | 'system.resource_snapshot'
  | 'repo.status'
  | 'repo.diff'
  | 'repo.test'
  | 'repo.typecheck'
  | 'repo.build'
  | 'file.read'
  | 'http.get';

export type ExecutionPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface TypedExecutionRequest {
  capability: TypedCapability;
  idempotencyKey: string;
  objective?: string;
  priority?: ExecutionPriority;
  input?: Record<string, unknown>;
}

export interface TypedExecutionReceipt {
  jobId: string;
  stage?: string;
  protocol: 'controller-v1';
}

export interface ExecutionSubmitter {
  submit(request: TypedExecutionRequest): Promise<TypedExecutionReceipt>;
}

const CAPABILITIES = new Set<TypedCapability>([
  'system.resource_snapshot', 'repo.status', 'repo.diff', 'repo.test',
  'repo.typecheck', 'repo.build', 'file.read', 'http.get',
]);

export function listTypedCapabilities(): TypedCapability[] {
  return [...CAPABILITIES];
}
function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : undefined;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function assertIdempotency(value: string): void {
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error('INVALID_IDEMPOTENCY_KEY');
}

function capabilityPayload(request: TypedExecutionRequest): {
  payload: Record<string, unknown>;
  requiredCapabilities: string[];
  requiredPermissions: string[];
  scopeKeys: string[];
} {
  const input = request.input ?? {};
  switch (request.capability) {
    case 'system.resource_snapshot':
      return { payload: { route: 'deterministic', action: 'resource_snapshot' }, requiredCapabilities: [], requiredPermissions: [], scopeKeys: ['pc01/read-only'] };
    case 'repo.status':
      return { payload: { route: 'tool', toolRequest: { operation: 'git', action: 'status' } }, requiredCapabilities: ['git'], requiredPermissions: ['git:read'], scopeKeys: ['workspace/tigeriq'] };
    case 'repo.diff':
      return { payload: { route: 'tool', toolRequest: { operation: 'git', action: 'diff' } }, requiredCapabilities: ['git'], requiredPermissions: ['git:read'], scopeKeys: ['workspace/tigeriq'] };
    case 'repo.test':
    case 'repo.typecheck':
    case 'repo.build': {
      const script = request.capability.split('.')[1];
      return { payload: { route: 'tool', toolRequest: { operation: 'npm', script } }, requiredCapabilities: ['npm'], requiredPermissions: ['npm:execute'], scopeKeys: ['workspace/tigeriq'] };
    }
    case 'file.read': {
      const path = text(input.path, 4096);
      if (!path) throw new Error('INVALID_FILE_PATH');
      const maxBytes = boundedInt(input.maxBytes, 1_000_000, 1, 5_000_000);
      return { payload: { route: 'tool', toolRequest: { operation: 'read_file', path, maxBytes } }, requiredCapabilities: ['filesystem'], requiredPermissions: ['workspace:read'], scopeKeys: ['workspace/tigeriq'] };
    }
    case 'http.get': {
      const url = text(input.url, 4096);
      if (!url) throw new Error('INVALID_HTTP_URL');
      return { payload: { route: 'tool', toolRequest: { operation: 'http', method: 'GET', url } }, requiredCapabilities: ['http_api'], requiredPermissions: ['http:local'], scopeKeys: ['pc01/http-local'] };
    }
  }
}

export function buildControllerV1WorkOrder(request: TypedExecutionRequest, now = new Date()): Record<string, unknown> {
  if (!CAPABILITIES.has(request.capability)) throw new Error('CAPABILITY_UNREGISTERED');
  assertIdempotency(request.idempotencyKey);
  const mapping = capabilityPayload(request);
  if (request.objective !== undefined && !text(request.objective, 4096)) throw new Error('INVALID_OBJECTIVE');
  const objective = text(request.objective, 4096) ?? `Execute typed capability ${request.capability}`;
  const priority = request.priority ?? 'P1';
  if (!['P0', 'P1', 'P2', 'P3'].includes(priority)) throw new Error('INVALID_PRIORITY');
  const jobId = `TYPED-${request.idempotencyKey}`.slice(0, 160);
  return {
    jobId,
    idempotencyKey: request.idempotencyKey,
    title: `Typed execution · ${request.capability}`,
    objective,
    payload: mapping.payload,
    targetEmployeeId: 'EMP-PC01-NATIVE',
    requiredPermissions: mapping.requiredPermissions,
    requiredCapabilities: mapping.requiredCapabilities,
    allowedWorkerKinds: ['pc01'],
    expectedEvidence: ['json'],
    scopeKeys: mapping.scopeKeys,
    dependencies: [],
    maxAttempts: 2,
    independentReview: false,
    judgeRequired: false,
    priority,
    requestedAt: now.toISOString(),
  };
}
function assertPrivateControllerUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:') throw new Error('CONTROLLER_URL_MUST_BE_PRIVATE_HTTP');
  const host = url.hostname;
  const parts = host.split('.').map(Number);
  const ipv4 = parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  const privateHost = host === 'localhost' || host === '127.0.0.1' || (ipv4 && (
    parts[0] === 10 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
  ));
  if (!privateHost) throw new Error('CONTROLLER_URL_OUTSIDE_PRIVATE_BOUNDARY');
  return url;
}

export class WorkforceControllerV1Client implements ExecutionSubmitter {
  readonly #baseUrl: URL;
  constructor(
    baseUrl: string,
    private readonly ingressToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.#baseUrl = assertPrivateControllerUrl(baseUrl);
    if (ingressToken.trim().length < 32) throw new Error('WORKFORCE_INGRESS_TOKEN_NOT_CONFIGURED');
  }

  async submit(request: TypedExecutionRequest): Promise<TypedExecutionReceipt> {
    const body = buildControllerV1WorkOrder(request);
    const response = await this.fetcher(new URL('/api/v1/work-orders', this.#baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.ingressToken}` },
      body: JSON.stringify(body),
    });
    const parsed = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`WORKFORCE_SUBMIT_FAILED_${response.status}`);
    const workOrder = parsed.workOrder && typeof parsed.workOrder === 'object' ? parsed.workOrder as Record<string, unknown> : undefined;
    const job = workOrder?.job && typeof workOrder.job === 'object' ? workOrder.job as Record<string, unknown> : workOrder;
    const jobId = text(job?.jobId, 160) ?? text(body.jobId, 160);
    if (!jobId) throw new Error('WORKFORCE_RECEIPT_INVALID');
    return { jobId, stage: text(workOrder?.stage, 64), protocol: 'controller-v1' };
  }
}
