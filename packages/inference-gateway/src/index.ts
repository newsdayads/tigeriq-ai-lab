import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type GatewayProvider = 'gemini' | 'groq' | 'openrouter';
export type GatewayRole = 'executor' | 'reviewer' | 'judge';
export type GatewayTaskKind = 'general' | 'coding' | 'analysis' | 'research';
export type GatewayRisk = 'low' | 'medium' | 'high';
export type GatewayFailureKind =
  | 'quota'
  | 'outage'
  | 'timeout'
  | 'auth'
  | 'invalid_response'
  | 'configuration'
  | 'budget'
  | 'health';
export type GatewayErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'SCOPE_DENIED'
  | 'IDENTITY_MISMATCH'
  | 'INDEPENDENT_BACKEND_UNAVAILABLE'
  | 'GATEWAY_BUDGET_EXHAUSTED'
  | 'ROUTES_EXHAUSTED'
  | 'PROVIDER_UNAVAILABLE';

export interface BackendTarget {
  provider: GatewayProvider;
  model: string;
  tier: 'primary' | 'fallback';
  costRank: number;
  qualityRank: number;
  kinds: GatewayTaskKind[];
  roles?: GatewayRole[];
  enabled?: boolean;
}

export interface BackendRequest {
  prompt: string;
  signal?: AbortSignal;
}

export interface BackendAdapter {
  provider: GatewayProvider;
  execute(target: BackendTarget, request: BackendRequest): Promise<string>;
}

export interface InferenceTask {
  kind: GatewayTaskKind;
  risk: GatewayRisk;
  prompt: string;
  acceptanceCriteria?: string[];
  minQuality?: number;
}

export interface InferenceRoutingRequest {
  requiredDistinctFrom: string[];
  maxAttempts?: number;
}

export interface InferenceRequest {
  requestId: string;
  employeeId: string;
  workId?: string;
  role: GatewayRole;
  task: InferenceTask;
  routing: InferenceRoutingRequest;
  budgetClass: 'free-first';
}

export interface GatewayAttemptEvidence {
  sequence: number;
  backendIdentity: string;
  outcome: 'success' | 'failure';
  failureKind: GatewayFailureKind | null;
}

export interface GatewayResult {
  requestId: string;
  employeeId: string;
  text: string;
  decision: 'PASS' | 'FAIL' | null;
  selectedBackendIdentity: string;
  attempts: GatewayAttemptEvidence[];
  outputSha256: string;
  budget: {
    class: 'free-first';
    consumedUnits: number;
    remainingUnits: number;
  };
  gatewayVersion: 'v1';
}

export interface ProviderHealthSnapshot {
  provider: GatewayProvider;
  backendIdentity: string;
  health: 'healthy' | 'degraded' | 'cooling_down';
  consecutiveFailures: number;
  cooldownUntil: string | null;
  budgetLimit: number;
  consumedUnits: number;
  remainingUnits: number;
  budgetWindowStartedAt: string;
}

interface ProviderRuntimeState {
  health: 'healthy' | 'degraded' | 'cooling_down';
  consecutiveFailures: number;
  cooldownUntilMs: number;
  budgetLimit: number;
  consumedUnits: number;
  budgetWindowStartedAtMs: number;
}

export class BackendRequestError extends Error {
  constructor(
    public readonly provider: GatewayProvider,
    public readonly kind: Exclude<GatewayFailureKind, 'budget' | 'health'>,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'BackendRequestError';
  }
}

export class InferenceGatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs: number | null = null,
    public readonly attempts: GatewayAttemptEvidence[] = [],
  ) {
    super(message);
    this.name = 'InferenceGatewayError';
  }
}

export interface InferenceGatewayOptions {
  targets: BackendTarget[];
  budgets?: Partial<Record<GatewayProvider, number>>;
  maxAttempts?: number;
  cooldownMs?: number;
  healthFailureThreshold?: number;
  budgetWindowMs?: number;
  now?: () => number;
}

export class InferenceGateway {
  private readonly adapters = new Map<GatewayProvider, BackendAdapter>();
  private readonly targets: BackendTarget[];
  private readonly state = new Map<GatewayProvider, ProviderRuntimeState>();
  private readonly maxAttempts: number;
  private readonly cooldownMs: number;
  private readonly healthFailureThreshold: number;
  private readonly budgetWindowMs: number;
  private readonly now: () => number;

  constructor(adapters: BackendAdapter[], options: InferenceGatewayOptions) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.provider)) throw new Error(`duplicate backend adapter: ${adapter.provider}`);
      this.adapters.set(adapter.provider, adapter);
    }
    this.targets = options.targets.map((target) => ({ ...target, kinds: [...target.kinds], roles: target.roles ? [...target.roles] : undefined }));
    this.maxAttempts = clampInteger(options.maxAttempts ?? 3, 1, 3);
    this.cooldownMs = Math.max(1_000, options.cooldownMs ?? 30_000);
    this.healthFailureThreshold = clampInteger(options.healthFailureThreshold ?? 2, 1, 10);
    this.budgetWindowMs = Math.max(60_000, options.budgetWindowMs ?? 24 * 60 * 60_000);
    this.now = options.now ?? Date.now;

    for (const provider of ['gemini', 'groq', 'openrouter'] as GatewayProvider[]) {
      const budgetLimit = normalizeBudget(options.budgets?.[provider] ?? 1000);
      this.state.set(provider, {
        health: 'healthy',
        consecutiveFailures: 0,
        cooldownUntilMs: 0,
        budgetLimit,
        consumedUnits: 0,
        budgetWindowStartedAtMs: this.now(),
      });
    }
  }

  async infer(request: InferenceRequest, signal?: AbortSignal): Promise<GatewayResult> {
    validateInferenceRequest(request);
    this.assertIndependenceContext(request);
    const requiredDistinct = new Set(request.routing.requiredDistinctFrom.map((value) => value.trim().toLowerCase()));
    const requestedAttempts = clampInteger(request.routing.maxAttempts ?? this.maxAttempts, 1, this.maxAttempts);
    const attempts: GatewayAttemptEvidence[] = [];
    const candidates = this.selectCandidates(request, requiredDistinct);

    if (!candidates.length) {
      const independenceCandidates = this.selectCandidates(request, new Set());
      if (independenceCandidates.length && requiredDistinct.size > 0) {
        throw new InferenceGatewayError(
          'INDEPENDENT_BACKEND_UNAVAILABLE',
          409,
          'no distinct backend is available for this verification stage',
          false,
        );
      }
      if (this.allCapableCandidatesOverBudget(request)) {
        throw new InferenceGatewayError('GATEWAY_BUDGET_EXHAUSTED', 429, 'gateway provider budget exhausted', true);
      }
      throw new InferenceGatewayError('PROVIDER_UNAVAILABLE', 503, 'no healthy capable provider backend is available', true);
    }

    for (const target of candidates.slice(0, requestedAttempts)) {
      if (signal?.aborted) throw new Error('inference request aborted');
      const adapter = this.adapters.get(target.provider);
      if (!adapter) continue;
      const providerState = this.providerState(target.provider);
      this.refreshWindow(providerState);
      if (providerState.consumedUnits >= providerState.budgetLimit) continue;
      providerState.consumedUnits += 1;
      const backendIdentity = identity(target);

      try {
        const text = await adapter.execute(target, { prompt: buildPrompt(request), signal });
        if (!text.trim()) throw new BackendRequestError(target.provider, 'invalid_response', 'empty backend response');
        const decision = request.role === 'executor' ? null : parseDecision(text);
        if (request.role !== 'executor' && !decision) {
          throw new BackendRequestError(target.provider, 'invalid_response', 'verification response must start with PASS or FAIL');
        }
        this.recordSuccess(target.provider);
        attempts.push({ sequence: attempts.length + 1, backendIdentity, outcome: 'success', failureKind: null });
        const current = this.providerState(target.provider);
        return {
          requestId: request.requestId,
          employeeId: request.employeeId,
          text,
          decision,
          selectedBackendIdentity: backendIdentity,
          attempts,
          outputSha256: createHash('sha256').update(text).digest('hex'),
          budget: {
            class: 'free-first',
            consumedUnits: current.consumedUnits,
            remainingUnits: Math.max(0, current.budgetLimit - current.consumedUnits),
          },
          gatewayVersion: 'v1',
        };
      } catch (error) {
        if (signal?.aborted) throw new Error('inference request aborted');
        const backendError = error instanceof BackendRequestError
          ? error
          : new BackendRequestError(target.provider, 'outage', 'backend request failed');
        this.recordFailure(target.provider, backendError);
        attempts.push({
          sequence: attempts.length + 1,
          backendIdentity,
          outcome: 'failure',
          failureKind: backendError.kind,
        });
      }
    }

    const retryAfter = this.nextRetryAfterMs();
    throw new InferenceGatewayError(
      'ROUTES_EXHAUSTED',
      503,
      'all eligible inference routes failed within the bounded attempt limit',
      true,
      retryAfter,
      attempts,
    );
  }

  health(): ProviderHealthSnapshot[] {
    const now = this.now();
    const representative = new Map<GatewayProvider, BackendTarget>();
    for (const target of this.targets) if (!representative.has(target.provider)) representative.set(target.provider, target);
    return (['gemini', 'groq', 'openrouter'] as GatewayProvider[]).map((provider) => {
      const state = this.providerState(provider);
      this.refreshWindow(state);
      if (state.health === 'cooling_down' && state.cooldownUntilMs <= now) {
        state.health = state.consecutiveFailures > 0 ? 'degraded' : 'healthy';
        state.cooldownUntilMs = 0;
      }
      const target = representative.get(provider);
      return {
        provider,
        backendIdentity: target ? identity(target) : `${provider}/unconfigured`,
        health: state.health,
        consecutiveFailures: state.consecutiveFailures,
        cooldownUntil: state.cooldownUntilMs > now ? new Date(state.cooldownUntilMs).toISOString() : null,
        budgetLimit: state.budgetLimit,
        consumedUnits: state.consumedUnits,
        remainingUnits: Math.max(0, state.budgetLimit - state.consumedUnits),
        budgetWindowStartedAt: new Date(state.budgetWindowStartedAtMs).toISOString(),
      };
    });
  }

  private selectCandidates(request: InferenceRequest, requiredDistinct: Set<string>): BackendTarget[] {
    const minQuality = request.task.minQuality ?? minimumQuality(request.task.risk);
    const now = this.now();
    return this.targets
      .filter((target) => target.enabled !== false)
      .filter((target) => this.adapters.has(target.provider))
      .filter((target) => target.kinds.includes(request.task.kind))
      .filter((target) => !target.roles || target.roles.includes(request.role))
      .filter((target) => target.qualityRank >= minQuality)
      .filter((target) => !requiredDistinct.has(identity(target).toLowerCase()))
      .filter((target) => {
        const state = this.providerState(target.provider);
        this.refreshWindow(state);
        if (state.health === 'cooling_down' && state.cooldownUntilMs > now) return false;
        return state.consumedUnits < state.budgetLimit;
      })
      .sort((a, b) => {
        const tier = tierRank(a.tier) - tierRank(b.tier);
        if (tier) return tier;
        const health = healthRank(this.providerState(a.provider).health) - healthRank(this.providerState(b.provider).health);
        if (health) return health;
        return a.costRank - b.costRank || b.qualityRank - a.qualityRank || identity(a).localeCompare(identity(b));
      });
  }

  private allCapableCandidatesOverBudget(request: InferenceRequest): boolean {
    const minQuality = request.task.minQuality ?? minimumQuality(request.task.risk);
    const capable = this.targets
      .filter((target) => target.enabled !== false)
      .filter((target) => this.adapters.has(target.provider))
      .filter((target) => target.kinds.includes(request.task.kind))
      .filter((target) => !target.roles || target.roles.includes(request.role))
      .filter((target) => target.qualityRank >= minQuality);
    return capable.length > 0 && capable.every((target) => {
      const state = this.providerState(target.provider);
      this.refreshWindow(state);
      return state.consumedUnits >= state.budgetLimit;
    });
  }

  private assertIndependenceContext(request: InferenceRequest): void {
    const distinct = new Set(request.routing.requiredDistinctFrom.map((value) => value.trim()).filter(Boolean));
    if (request.role === 'reviewer' && distinct.size < 1) {
      throw new InferenceGatewayError('INVALID_REQUEST', 400, 'reviewer requires prior backend identity evidence', false);
    }
    if (request.role === 'judge') {
      const required = request.task.kind === 'coding' || request.task.risk === 'high' ? 2 : 1;
      if (distinct.size < required) {
        throw new InferenceGatewayError('INVALID_REQUEST', 400, 'judge requires prior independent backend identity evidence', false);
      }
    }
  }

  private providerState(provider: GatewayProvider): ProviderRuntimeState {
    const state = this.state.get(provider);
    if (!state) throw new Error(`missing provider state: ${provider}`);
    return state;
  }

  private refreshWindow(state: ProviderRuntimeState): void {
    const now = this.now();
    if (now - state.budgetWindowStartedAtMs >= this.budgetWindowMs) {
      state.budgetWindowStartedAtMs = now;
      state.consumedUnits = 0;
    }
  }

  private recordSuccess(provider: GatewayProvider): void {
    const state = this.providerState(provider);
    state.health = 'healthy';
    state.consecutiveFailures = 0;
    state.cooldownUntilMs = 0;
  }

  private recordFailure(provider: GatewayProvider, error: BackendRequestError): void {
    const state = this.providerState(provider);
    state.consecutiveFailures += 1;
    if (error.kind === 'quota') {
      state.health = 'cooling_down';
      state.cooldownUntilMs = this.now() + Math.max(this.cooldownMs, error.retryAfterMs ?? 0);
      return;
    }
    if (error.kind === 'auth' || error.kind === 'configuration') {
      state.health = 'cooling_down';
      state.cooldownUntilMs = this.now() + this.cooldownMs * 10;
      return;
    }
    if (error.kind === 'outage' || error.kind === 'timeout') {
      if (state.consecutiveFailures >= this.healthFailureThreshold) {
        state.health = 'cooling_down';
        state.cooldownUntilMs = this.now() + this.cooldownMs;
      } else {
        state.health = 'degraded';
      }
      return;
    }
    state.health = 'degraded';
  }

  private nextRetryAfterMs(): number | null {
    const now = this.now();
    const waits = [...this.state.values()]
      .map((state) => state.cooldownUntilMs - now)
      .filter((value) => value > 0);
    return waits.length ? Math.min(...waits) : null;
  }
}

export interface BootstrapAuthenticationInput {
  credentialId: string;
  bearerToken: string;
  employeeId: string;
  nodeId: string;
  deviceId?: string;
}

export interface BootstrapIdentity {
  employeeId: string;
  nodeId: string;
  deviceId?: string;
  scopes: string[];
}

export interface BootstrapAuthenticator {
  authenticate(input: BootstrapAuthenticationInput): Promise<BootstrapIdentity | undefined>;
}

export interface DeviceSessionRequest {
  employeeId: string;
  nodeId: string;
  deviceId?: string;
  requestedScopes: Array<'inference:invoke'>;
  client: { name: string; version: string };
}

export interface DeviceSessionClaims {
  v: 1;
  iss: 'tigeriq-inference';
  aud: 'tigeriq-inference';
  sub: string;
  nodeId: string;
  deviceId?: string;
  scopes: Array<'inference:invoke'>;
  iat: number;
  exp: number;
  jti: string;
}

export interface DeviceSessionResponse {
  accessToken: string;
  tokenType: 'Bearer';
  employeeId: string;
  nodeId: string;
  deviceId?: string;
  scopes: Array<'inference:invoke'>;
  expiresAt: string;
}

export class DeviceSessionService {
  private readonly ttlSeconds: number;
  private readonly now: () => number;

  constructor(
    private readonly secret: string,
    private readonly authenticator: BootstrapAuthenticator,
    options: { ttlSeconds?: number; now?: () => number } = {},
  ) {
    if (secret.length < 32) throw new Error('inference session secret must be at least 32 characters');
    this.ttlSeconds = clampInteger(options.ttlSeconds ?? 300, 30, 900);
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async mint(
    request: DeviceSessionRequest,
    auth: { credentialId: string; bearerToken: string },
  ): Promise<DeviceSessionResponse> {
    validateDeviceSessionRequest(request);
    if (!auth.credentialId.trim() || !auth.bearerToken) {
      throw new InferenceGatewayError('UNAUTHORIZED', 401, 'device bootstrap credential is required', false);
    }
    const identity = await this.authenticator.authenticate({
      credentialId: auth.credentialId,
      bearerToken: auth.bearerToken,
      employeeId: request.employeeId,
      nodeId: request.nodeId,
      deviceId: request.deviceId,
    });
    if (!identity) throw new InferenceGatewayError('UNAUTHORIZED', 401, 'device bootstrap authentication failed', false);
    if (identity.employeeId !== request.employeeId || identity.nodeId !== request.nodeId) {
      throw new InferenceGatewayError('IDENTITY_MISMATCH', 409, 'device credential does not own requested TigerIQ identity', false);
    }
    if (request.deviceId && identity.deviceId && request.deviceId !== identity.deviceId) {
      throw new InferenceGatewayError('IDENTITY_MISMATCH', 409, 'device identity mismatch', false);
    }
    if (!identity.scopes.includes('inference:invoke')) {
      throw new InferenceGatewayError('SCOPE_DENIED', 403, 'device credential cannot mint inference scope', false);
    }
    const now = this.now();
    const claims: DeviceSessionClaims = {
      v: 1,
      iss: 'tigeriq-inference',
      aud: 'tigeriq-inference',
      sub: request.employeeId,
      nodeId: request.nodeId,
      deviceId: request.deviceId,
      scopes: ['inference:invoke'],
      iat: now,
      exp: now + this.ttlSeconds,
      jti: randomBytes(18).toString('base64url'),
    };
    const accessToken = this.sign(claims);
    return {
      accessToken,
      tokenType: 'Bearer',
      employeeId: request.employeeId,
      nodeId: request.nodeId,
      deviceId: request.deviceId,
      scopes: ['inference:invoke'],
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    };
  }

  verify(accessToken: string, requiredScope: 'inference:invoke' = 'inference:invoke'): DeviceSessionClaims {
    const parts = accessToken.split('.');
    if (parts.length !== 3 || parts[0] !== 'tiq1' || !parts[1] || !parts[2]) {
      throw new InferenceGatewayError('UNAUTHORIZED', 401, 'invalid inference session token', false);
    }
    const payload = parts[1];
    const signature = parts[2];
    const expected = createHmac('sha256', this.secret).update(payload).digest('base64url');
    if (!safeEqual(signature, expected)) {
      throw new InferenceGatewayError('UNAUTHORIZED', 401, 'invalid inference session token', false);
    }
    let claims: DeviceSessionClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DeviceSessionClaims;
    } catch {
      throw new InferenceGatewayError('UNAUTHORIZED', 401, 'invalid inference session token', false);
    }
    if (claims.v !== 1 || claims.iss !== 'tigeriq-inference' || claims.aud !== 'tigeriq-inference' || !claims.sub || !claims.nodeId) {
      throw new InferenceGatewayError('UNAUTHORIZED', 401, 'invalid inference session claims', false);
    }
    if (claims.exp <= this.now()) {
      throw new InferenceGatewayError('TOKEN_EXPIRED', 401, 'inference session token expired', false);
    }
    if (!Array.isArray(claims.scopes) || !claims.scopes.includes(requiredScope)) {
      throw new InferenceGatewayError('SCOPE_DENIED', 403, 'inference session scope denied', false);
    }
    return claims;
  }

  private sign(claims: DeviceSessionClaims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return `tiq1.${payload}.${signature}`;
  }
}

interface ProviderHttpOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface GeminiBackendOptions extends ProviderHttpOptions {}
export interface GroqBackendOptions extends ProviderHttpOptions {}
export interface OpenRouterBackendOptions extends ProviderHttpOptions {
  appName?: string;
  appUrl?: string;
}

export function createGeminiBackendAdapter(options: GeminiBackendOptions = {}): BackendAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
  return {
    provider: 'gemini',
    async execute(target, request) {
      const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
      if (!apiKey) throw new BackendRequestError('gemini', 'configuration', 'gemini api key not configured');
      const response = await providerFetch('gemini', fetchImpl, `${baseUrl}/models/${encodeURIComponent(target.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: request.prompt }] }] }),
      }, request.signal, timeoutMs);
      const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? '';
      if (!text.trim()) throw new BackendRequestError('gemini', 'invalid_response', 'empty gemini response');
      return text;
    },
  };
}

export function createGroqBackendAdapter(options: GroqBackendOptions = {}): BackendAdapter {
  return createOpenAICompatibleAdapter('groq', {
    ...options,
    baseUrl: options.baseUrl ?? 'https://api.groq.com/openai/v1',
  });
}

export function createOpenRouterBackendAdapter(options: OpenRouterBackendOptions = {}): BackendAdapter {
  const adapter = createOpenAICompatibleAdapter('openrouter', {
    ...options,
    baseUrl: options.baseUrl ?? 'https://openrouter.ai/api/v1',
  }, {
    ...(options.appUrl ? { 'HTTP-Referer': options.appUrl } : {}),
    ...(options.appName ? { 'X-Title': options.appName } : {}),
  });
  return adapter;
}

function createOpenAICompatibleAdapter(
  provider: 'groq' | 'openrouter',
  options: ProviderHttpOptions,
  extraHeaders: Record<string, string> = {},
): BackendAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
  return {
    provider,
    async execute(target, request) {
      const apiKey = options.apiKey ?? (provider === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENROUTER_API_KEY);
      if (!apiKey) throw new BackendRequestError(provider, 'configuration', `${provider} api key not configured`);
      const response = await providerFetch(provider, fetchImpl, `${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          ...extraHeaders,
        },
        body: JSON.stringify({
          model: target.model,
          messages: [{ role: 'user', content: request.prompt }],
          stream: false,
        }),
      }, request.signal, timeoutMs);
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = body.choices?.[0]?.message?.content ?? '';
      if (!text.trim()) throw new BackendRequestError(provider, 'invalid_response', `empty ${provider} response`);
      return text;
    },
  };
}

export function defaultServerTargets(env: NodeJS.ProcessEnv = process.env): BackendTarget[] {
  return [
    {
      provider: 'gemini',
      model: env.TIGERIQ_GEMINI_MODEL?.trim() || 'gemini-3.7-flash',
      tier: 'primary',
      costRank: 0,
      qualityRank: 4,
      kinds: ['general', 'coding', 'analysis', 'research'],
    },
    {
      provider: 'groq',
      model: env.TIGERIQ_GROQ_MODEL?.trim() || 'openai/gpt-oss-20b',
      tier: 'primary',
      costRank: 0,
      qualityRank: 4,
      kinds: ['general', 'coding', 'analysis', 'research'],
    },
    {
      provider: 'openrouter',
      model: env.TIGERIQ_OPENROUTER_MODEL?.trim() || 'openai/gpt-oss-20b',
      tier: 'fallback',
      costRank: 1,
      qualityRank: 4,
      kinds: ['general', 'coding', 'analysis', 'research'],
    },
  ];
}

function buildPrompt(request: InferenceRequest): string {
  const acceptance = request.task.acceptanceCriteria?.length
    ? request.task.acceptanceCriteria.map((item) => `- ${item}`).join('\n')
    : '- Produce a correct and complete result.';
  const gate = request.role === 'executor'
    ? ''
    : '\nReturn PASS or FAIL as the first token, followed by concise evidence.';
  return `TIGERIQ_EMPLOYEE: ${request.employeeId}\nROLE: ${request.role.toUpperCase()}\nWORK_ID: ${request.workId ?? 'none'}\nTASK_KIND: ${request.task.kind}\nTASK_RISK: ${request.task.risk}\nTASK:\n${request.task.prompt}\nACCEPTANCE:\n${acceptance}${gate}`;
}

function validateInferenceRequest(request: InferenceRequest): void {
  if (!request.requestId?.trim() || request.requestId.length > 128) throw invalid('requestId is required');
  if (!request.employeeId?.trim() || request.employeeId.length > 128) throw invalid('employeeId is required');
  if (!['executor', 'reviewer', 'judge'].includes(request.role)) throw invalid('invalid role');
  if (!request.task?.prompt?.trim() || request.task.prompt.length > 200_000) throw invalid('task prompt is required');
  if (!['general', 'coding', 'analysis', 'research'].includes(request.task.kind)) throw invalid('invalid task kind');
  if (!['low', 'medium', 'high'].includes(request.task.risk)) throw invalid('invalid task risk');
  if (request.task.minQuality !== undefined && (!Number.isInteger(request.task.minQuality) || request.task.minQuality < 1 || request.task.minQuality > 5)) {
    throw invalid('invalid minQuality');
  }
  if (!request.routing || !Array.isArray(request.routing.requiredDistinctFrom) || request.routing.requiredDistinctFrom.length > 8) {
    throw invalid('routing.requiredDistinctFrom is required');
  }
  if (new Set(request.routing.requiredDistinctFrom).size !== request.routing.requiredDistinctFrom.length) throw invalid('duplicate distinct backend identity');
  if (request.budgetClass !== 'free-first') throw invalid('unsupported budget class');
}

function validateDeviceSessionRequest(request: DeviceSessionRequest): void {
  if (!request.employeeId?.trim() || request.employeeId.length > 128) throw invalid('employeeId is required');
  if (!request.nodeId?.trim() || request.nodeId.length > 128) throw invalid('nodeId is required');
  if (request.deviceId !== undefined && (!request.deviceId.trim() || request.deviceId.length > 128)) throw invalid('invalid deviceId');
  if (!Array.isArray(request.requestedScopes) || request.requestedScopes.length !== 1 || request.requestedScopes[0] !== 'inference:invoke') {
    throw invalid('requestedScopes must contain inference:invoke');
  }
  if (!request.client?.name?.trim() || request.client.name.length > 64 || !request.client.version?.trim() || request.client.version.length > 64) {
    throw invalid('valid client name/version are required');
  }
}

async function providerFetch(
  provider: GatewayProvider,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      if (signal?.aborted) throw new Error('inference request aborted');
      if (controller.signal.aborted) throw new BackendRequestError(provider, 'timeout', `${provider} request timeout`);
      throw new BackendRequestError(provider, 'outage', `${provider} network failure`);
    }
    if (!response.ok) {
      const retryAfter = retryAfterMs(response);
      throw new BackendRequestError(provider, classifyStatus(response.status), `${provider} http ${response.status}`, retryAfter);
    }
    return response;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function classifyStatus(status: number): Exclude<GatewayFailureKind, 'budget' | 'health'> {
  if (status === 429) return 'quota';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'outage';
  return 'invalid_response';
}

function parseDecision(text: string): 'PASS' | 'FAIL' | null {
  const match = text.trim().match(/^(PASS|FAIL)\b/i);
  return match ? (match[1].toUpperCase() as 'PASS' | 'FAIL') : null;
}

function identity(target: BackendTarget): string {
  return `${target.provider}/${target.model}`;
}

function minimumQuality(risk: GatewayRisk): number {
  if (risk === 'high') return 3;
  if (risk === 'medium') return 2;
  return 1;
}

function normalizeBudget(value: number): number {
  if (!Number.isFinite(value)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor(value));
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function tierRank(tier: BackendTarget['tier']): number {
  return tier === 'primary' ? 0 : 1;
}

function healthRank(health: ProviderRuntimeState['health']): number {
  if (health === 'healthy') return 0;
  if (health === 'degraded') return 1;
  return 2;
}

function invalid(message: string): InferenceGatewayError {
  return new InferenceGatewayError('INVALID_REQUEST', 400, message, false);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}