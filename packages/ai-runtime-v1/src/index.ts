import { createHash } from 'node:crypto';

export type WorkKindV1 = 'general' | 'coding' | 'analysis' | 'research';
export type WorkRiskV1 = 'low' | 'medium' | 'high';
export type AIRoleV1 = 'prompt-architect' | 'executor' | 'reviewer' | 'judge';
export type ExecutionLocationV1 = 'pc01-local' | 'pc01-server' | 'employee-device';
export type CredentialOwnerV1 = 'none' | 'pc01' | 'employee-device';
export type BillingModeV1 =
  | 'local-zero-cost'
  | 'free-tier-proven'
  | 'subscription-proven'
  | 'unknown'
  | 'paid';
export type QuotaStateV1 = 'available' | 'limited' | 'exhausted' | 'unknown';
export type PromptOutcomeDecision = 'PASS' | 'FAIL';

export interface AIExecutionEndpointV1 {
  endpointId: string;
  employeeId: string;
  provider: string;
  model: string;
  location: ExecutionLocationV1;
  credentialOwner: CredentialOwnerV1;
  billingMode: BillingModeV1;
  kinds: WorkKindV1[];
  roles: Exclude<AIRoleV1, 'prompt-architect'>[];
  capabilities?: string[];
  quotaState: QuotaStateV1;
  capabilityScore: number;
  stabilityScore: number;
  speedScore: number;
  historicalQualityScore: number;
  costRank: number;
  enabled?: boolean;
}

export interface AIRouteRequestV1 {
  kind: WorkKindV1;
  risk: WorkRiskV1;
  role: Exclude<AIRoleV1, 'prompt-architect'>;
  requiredCapabilities?: string[];
  excludedBackendIdentities?: string[];
  zeroCostOnly?: boolean;
}

export interface RankedEndpointV1 {
  endpoint: AIExecutionEndpointV1;
  score: number;
  reasons: {
    quota: number;
    capability: number;
    stability: number;
    speed: number;
    historicalQuality: number;
    costPenalty: number;
    localBonus: number;
  };
}

export function backendIdentityV1(endpoint: Pick<AIExecutionEndpointV1, 'provider' | 'model'>): string {
  return `${endpoint.provider}/${endpoint.model}`.toLowerCase();
}

export class AIRouterV1 {
  constructor(private readonly endpoints: AIExecutionEndpointV1[]) {}

  rank(request: AIRouteRequestV1): RankedEndpointV1[] {
    const excluded = new Set((request.excludedBackendIdentities ?? []).map((value) => value.toLowerCase()));
    const requiredCapabilities = request.requiredCapabilities ?? [];
    const minCapability = minimumCapability(request.risk);

    return this.endpoints
      .filter((endpoint) => endpoint.enabled !== false)
      .filter((endpoint) => endpoint.kinds.includes(request.kind))
      .filter((endpoint) => endpoint.roles.includes(request.role))
      .filter((endpoint) => endpoint.quotaState !== 'exhausted')
      .filter((endpoint) => endpoint.capabilityScore >= minCapability)
      .filter((endpoint) => requiredCapabilities.every((capability) => endpoint.capabilities?.includes(capability)))
      .filter((endpoint) => !excluded.has(backendIdentityV1(endpoint)))
      .filter((endpoint) => !request.zeroCostOnly || isBillingSafe(endpoint.billingMode))
      .map((endpoint) => rankEndpoint(endpoint))
      .sort((a, b) => b.score - a.score || a.endpoint.costRank - b.endpoint.costRank || a.endpoint.endpointId.localeCompare(b.endpoint.endpointId));
  }

  select(request: AIRouteRequestV1): AIExecutionEndpointV1 | undefined {
    return this.rank(request)[0]?.endpoint;
  }
}

function rankEndpoint(endpoint: AIExecutionEndpointV1): RankedEndpointV1 {
  const quota = quotaScore(endpoint.quotaState);
  const localBonus = endpoint.location === 'pc01-local' ? 8 : 0;
  const costPenalty = Math.max(0, endpoint.costRank) * 5;
  const score =
    endpoint.historicalQualityScore * 0.35 +
    endpoint.stabilityScore * 0.25 +
    endpoint.speedScore * 0.15 +
    quota * 0.15 +
    endpoint.capabilityScore * 0.10 +
    localBonus -
    costPenalty;
  return {
    endpoint,
    score,
    reasons: {
      quota,
      capability: endpoint.capabilityScore,
      stability: endpoint.stabilityScore,
      speed: endpoint.speedScore,
      historicalQuality: endpoint.historicalQualityScore,
      costPenalty,
      localBonus,
    },
  };
}

function quotaScore(state: QuotaStateV1): number {
  if (state === 'available') return 100;
  if (state === 'limited') return 45;
  if (state === 'unknown') return 10;
  return 0;
}

function minimumCapability(risk: WorkRiskV1): number {
  if (risk === 'high') return 80;
  if (risk === 'medium') return 65;
  return 50;
}

function isBillingSafe(mode: BillingModeV1): boolean {
  return mode === 'local-zero-cost' || mode === 'free-tier-proven' || mode === 'subscription-proven';
}

export interface PromptTemplateV1 {
  templateId: string;
  version: number;
  provider?: string;
  modelIncludes?: string;
  kinds: WorkKindV1[];
  instructions: string[];
}

export interface PromptArchitectInputV1 {
  jobId: string;
  goal: string;
  context: string;
  employee: {
    employeeId: string;
    role: string;
    capabilities?: string[];
  };
  target: {
    provider: string;
    model: string;
    endpointId: string;
  };
  kind: WorkKindV1;
  risk: WorkRiskV1;
  acceptanceCriteria: string[];
  completionStandard?: string;
}

export interface PromptHistoryEntryV1 {
  at: string;
  event: 'created' | 'outcome' | 'repaired';
  version: number;
  decision?: PromptOutcomeDecision;
  evaluatorRole?: 'reviewer' | 'judge';
  evaluatorBackendIdentity?: string;
  note?: string;
}

export interface PromptArtifactV1 {
  promptId: string;
  version: number;
  templateId: string;
  templateVersion: number;
  architectBackendIdentity: string;
  jobId: string;
  employeeId: string;
  endpointId: string;
  provider: string;
  model: string;
  kind: WorkKindV1;
  risk: WorkRiskV1;
  acceptanceCriteria: string[];
  renderedPrompt: string;
  status: 'candidate' | 'passed' | 'failed';
  repairCount: number;
  createdAt: string;
  updatedAt: string;
  history: PromptHistoryEntryV1[];
}

export interface PromptOutcomeV1 {
  decision: PromptOutcomeDecision;
  evaluatorRole: 'reviewer' | 'judge';
  evaluatorBackendIdentity: string;
  outputSha256: string;
  latencyMs?: number;
  feedback?: string;
  at?: string;
}

interface PromptTemplateStatsV1 {
  pass: number;
  fail: number;
  totalLatencyMs: number;
  latencySamples: number;
}

export class PromptTemplateLibraryV1 {
  private readonly stats = new Map<string, PromptTemplateStatsV1>();

  constructor(private readonly templates: PromptTemplateV1[] = defaultPromptTemplatesV1) {}

  select(input: PromptArchitectInputV1): PromptTemplateV1 {
    const candidates = this.templates
      .filter((template) => template.kinds.includes(input.kind))
      .filter((template) => !template.provider || template.provider.toLowerCase() === input.target.provider.toLowerCase())
      .filter((template) => !template.modelIncludes || input.target.model.toLowerCase().includes(template.modelIncludes.toLowerCase()))
      .sort((a, b) => this.templateScore(b, input) - this.templateScore(a, input) || a.templateId.localeCompare(b.templateId));
    const selected = candidates[0] ?? this.templates.find((template) => template.templateId === 'generic-v1');
    if (!selected) throw new Error('no prompt template available');
    return selected;
  }

  record(templateId: string, templateVersion: number, outcome: PromptOutcomeV1): void {
    const key = templateKey(templateId, templateVersion);
    const current = this.stats.get(key) ?? { pass: 0, fail: 0, totalLatencyMs: 0, latencySamples: 0 };
    if (outcome.decision === 'PASS') current.pass += 1;
    else current.fail += 1;
    if (typeof outcome.latencyMs === 'number' && outcome.latencyMs >= 0) {
      current.totalLatencyMs += outcome.latencyMs;
      current.latencySamples += 1;
    }
    this.stats.set(key, current);
  }

  snapshot(templateId: string, templateVersion: number): Readonly<PromptTemplateStatsV1> {
    return { ...(this.stats.get(templateKey(templateId, templateVersion)) ?? { pass: 0, fail: 0, totalLatencyMs: 0, latencySamples: 0 }) };
  }

  private templateScore(template: PromptTemplateV1, input: PromptArchitectInputV1): number {
    const stats = this.snapshot(template.templateId, template.version);
    const samples = stats.pass + stats.fail;
    const passRate = samples ? stats.pass / samples : 0.5;
    const evidenceWeight = Math.min(samples, 20) / 20;
    const providerSpecific = template.provider ? 0.15 : 0;
    const modelSpecific = template.modelIncludes ? 0.10 : 0;
    const historical = passRate * (0.5 + evidenceWeight * 0.5);
    const latencyPenalty = stats.latencySamples ? Math.min(stats.totalLatencyMs / stats.latencySamples / 30_000, 1) * 0.05 : 0;
    const riskSpecificity = input.risk === 'high' && template.instructions.some((value) => /verify|evidence|acceptance/i.test(value)) ? 0.05 : 0;
    return historical + providerSpecific + modelSpecific + riskSpecificity - latencyPenalty;
  }
}

export class PromptArchitectV1 {
  constructor(
    private readonly architectBackendIdentity: string,
    private readonly library = new PromptTemplateLibraryV1(),
    private readonly maxRepairs = 2,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!architectBackendIdentity.trim()) throw new Error('architect backend identity is required');
    if (maxRepairs < 0 || maxRepairs > 5) throw new Error('max repairs must be between 0 and 5');
  }

  create(input: PromptArchitectInputV1): PromptArtifactV1 {
    validatePromptInput(input);
    const template = this.library.select(input);
    const at = this.now().toISOString();
    const promptId = makePromptId(input, template);
    return {
      promptId,
      version: 1,
      templateId: template.templateId,
      templateVersion: template.version,
      architectBackendIdentity: this.architectBackendIdentity,
      jobId: input.jobId,
      employeeId: input.employee.employeeId,
      endpointId: input.target.endpointId,
      provider: input.target.provider,
      model: input.target.model,
      kind: input.kind,
      risk: input.risk,
      acceptanceCriteria: [...input.acceptanceCriteria],
      renderedPrompt: renderPrompt(input, template, promptId, 1, 0),
      status: 'candidate',
      repairCount: 0,
      createdAt: at,
      updatedAt: at,
      history: [{ at, event: 'created', version: 1, note: `template=${template.templateId}@${template.version}` }],
    };
  }

  applyIndependentOutcome(artifact: PromptArtifactV1, outcome: PromptOutcomeV1): PromptArtifactV1 {
    validateIndependentOutcome(artifact, outcome);
    this.library.record(artifact.templateId, artifact.templateVersion, outcome);
    const at = outcome.at ?? this.now().toISOString();
    return {
      ...artifact,
      status: outcome.decision === 'PASS' ? 'passed' : 'failed',
      updatedAt: at,
      history: [...artifact.history, {
        at,
        event: 'outcome',
        version: artifact.version,
        decision: outcome.decision,
        evaluatorRole: outcome.evaluatorRole,
        evaluatorBackendIdentity: outcome.evaluatorBackendIdentity,
        note: outcome.feedback,
      }],
    };
  }

  repair(artifact: PromptArtifactV1, input: PromptArchitectInputV1, feedback: PromptOutcomeV1): PromptArtifactV1 {
    validateIndependentOutcome(artifact, feedback);
    validatePromptInput(input);
    validatePromptRepairBinding(artifact, input);
    if (feedback.decision !== 'FAIL') throw new Error('prompt repair requires FAIL feedback');
    if (!feedback.feedback?.trim()) throw new Error('prompt repair requires concrete independent feedback');
    if (artifact.repairCount >= this.maxRepairs) throw new Error('prompt repair limit exhausted');
    const template = this.library.select(input);
    const at = this.now().toISOString();
    const version = artifact.version + 1;
    const repairCount = artifact.repairCount + 1;
    const repairedInput: PromptArchitectInputV1 = {
      ...input,
      context: `${input.context}\n\nINDEPENDENT FAILURE FEEDBACK TO REPAIR:\n${feedback.feedback}`,
    };
    return {
      ...artifact,
      version,
      templateId: template.templateId,
      templateVersion: template.version,
      renderedPrompt: renderPrompt(repairedInput, template, artifact.promptId, version, repairCount),
      status: 'candidate',
      repairCount,
      updatedAt: at,
      history: [...artifact.history, {
        at,
        event: 'repaired',
        version,
        decision: 'FAIL',
        evaluatorRole: feedback.evaluatorRole,
        evaluatorBackendIdentity: feedback.evaluatorBackendIdentity,
        note: feedback.feedback,
      }],
    };
  }

  templateStats(artifact: PromptArtifactV1): Readonly<PromptTemplateStatsV1> {
    return this.library.snapshot(artifact.templateId, artifact.templateVersion);
  }
}

function validateIndependentOutcome(artifact: PromptArtifactV1, outcome: PromptOutcomeV1): void {
  if (!outcome.outputSha256.match(/^[a-f0-9]{64}$/i)) throw new Error('outcome outputSha256 is invalid');
  if (outcome.evaluatorBackendIdentity.toLowerCase() === artifact.architectBackendIdentity.toLowerCase()) {
    throw new Error('prompt architect cannot review or judge its own prompt outcome');
  }
}

function validatePromptInput(input: PromptArchitectInputV1): void {
  if (!input.jobId.trim()) throw new Error('job id is required');
  if (!input.goal.trim()) throw new Error('goal is required');
  if (!input.employee.employeeId.trim()) throw new Error('employee id is required');
  if (!input.target.endpointId.trim()) throw new Error('endpoint id is required');
  if (!input.target.provider.trim() || !input.target.model.trim()) throw new Error('provider/model is required');
  if (!input.acceptanceCriteria.length || input.acceptanceCriteria.some((item) => !item.trim())) throw new Error('acceptance criteria are required');
}

function validatePromptRepairBinding(artifact: PromptArtifactV1, input: PromptArchitectInputV1): void {
  const sameIdentity =
    artifact.jobId === input.jobId &&
    artifact.employeeId === input.employee.employeeId &&
    artifact.endpointId === input.target.endpointId &&
    artifact.provider.toLowerCase() === input.target.provider.toLowerCase() &&
    artifact.model.toLowerCase() === input.target.model.toLowerCase() &&
    artifact.kind === input.kind &&
    artifact.risk === input.risk &&
    JSON.stringify(artifact.acceptanceCriteria) === JSON.stringify(input.acceptanceCriteria);
  if (!sameIdentity) throw new Error('prompt repair input does not match artifact identity');
}

function makePromptId(input: PromptArchitectInputV1, template: PromptTemplateV1): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ jobId: input.jobId, employeeId: input.employee.employeeId, endpointId: input.target.endpointId, provider: input.target.provider, model: input.target.model, templateId: template.templateId }))
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return `PROMPT-${digest}`;
}

function renderPrompt(input: PromptArchitectInputV1, template: PromptTemplateV1, promptId: string, version: number, repairCount: number): string {
  const capabilities = input.employee.capabilities?.length ? input.employee.capabilities.join(', ') : 'not-specified';
  return [
    'TIGERIQ_AI_PROMPT_V1',
    `PROMPT_ID: ${promptId}`,
    `PROMPT_VERSION: ${version}`,
    `TEMPLATE: ${template.templateId}@${template.version}`,
    `REPAIR_COUNT: ${repairCount}`,
    `JOB_ID: ${input.jobId}`,
    `TARGET_EMPLOYEE: ${input.employee.employeeId}`,
    `EMPLOYEE_ROLE: ${input.employee.role}`,
    `EMPLOYEE_CAPABILITIES: ${capabilities}`,
    `TARGET_AI: ${input.target.provider}/${input.target.model}`,
    `TARGET_ENDPOINT: ${input.target.endpointId}`,
    `WORK_KIND: ${input.kind}`,
    `RISK: ${input.risk}`,
    '',
    'GOAL:',
    input.goal.trim(),
    '',
    'CONTEXT:',
    input.context.trim() || 'No additional context.',
    '',
    'ACCEPTANCE CRITERIA:',
    ...input.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    '',
    'MODEL-SPECIFIC EXECUTION INSTRUCTIONS:',
    ...template.instructions.map((instruction) => `- ${instruction}`),
    '',
    'COMPLETION STANDARD:',
    input.completionStandard?.trim() || 'Return the requested deliverable completely and provide concise evidence against every acceptance criterion. Do not claim actions or tests that were not actually performed.',
    '',
    'OUTPUT CONTRACT:',
    '- Produce only the deliverable and evidence needed by the job.',
    '- Never expose API keys, tokens, passwords, or hidden credentials.',
    '- If blocked, return a concrete blocker and the safest next action.',
    '- Do not fabricate device/server/runtime evidence.',
  ].join('\n');
}

function templateKey(templateId: string, version: number): string {
  return `${templateId}@${version}`;
}

export const defaultPromptTemplatesV1: PromptTemplateV1[] = [
  {
    templateId: 'gemini-v1',
    version: 1,
    provider: 'gemini',
    kinds: ['general', 'coding', 'analysis', 'research'],
    instructions: [
      'Use the supplied context as authoritative input; separate facts from assumptions.',
      'Check every acceptance criterion before finalizing.',
      'Prefer structured, concise output that another independent AI can verify.',
    ],
  },
  {
    templateId: 'claude-v1',
    version: 1,
    provider: 'claude',
    kinds: ['general', 'coding', 'analysis', 'research'],
    instructions: [
      'Maintain explicit constraints and avoid silently changing the requested scope.',
      'For engineering work, identify changed behavior, tests, and remaining risks.',
      'Make the final result independently reviewable against the acceptance criteria.',
    ],
  },
  {
    templateId: 'openrouter-v1',
    version: 1,
    provider: 'openrouter',
    kinds: ['general', 'coding', 'analysis', 'research'],
    instructions: [
      'Use deterministic structure and avoid relying on provider-specific hidden state.',
      'State uncertainty explicitly when evidence is missing.',
      'Keep the result compact enough for downstream reviewer and judge stages.',
    ],
  },
  {
    templateId: 'ollama-v1',
    version: 1,
    provider: 'ollama',
    kinds: ['general', 'coding', 'analysis'],
    instructions: [
      'Work only from the supplied local context and do not assume internet access.',
      'Prefer deterministic steps and explicit file/test evidence for engineering work.',
      'If capability is insufficient, fail clearly instead of inventing a result.',
    ],
  },
  {
    templateId: 'generic-v1',
    version: 1,
    kinds: ['general', 'coding', 'analysis', 'research'],
    instructions: [
      'Follow the goal and acceptance criteria exactly.',
      'Separate verified evidence from assumptions.',
      'Return a result that can be independently reviewed and judged.',
    ],
  },
];

export interface JobExecutionRequestV1 {
  contractVersion: 'TIGERIQ_JOB_EXECUTION_V1';
  jobId: string;
  promptId: string;
  promptVersion: number;
  employeeId: string;
  endpointId: string;
  role: Exclude<AIRoleV1, 'prompt-architect'>;
  idempotencyKey: string;
  prompt: string;
  createdAt: string;
}

export interface JobExecutionResultV1 {
  contractVersion: 'TIGERIQ_JOB_EXECUTION_V1';
  jobId: string;
  promptId: string;
  promptVersion: number;
  employeeId: string;
  endpointId: string;
  provider: string;
  model: string;
  output: string;
  startedAt: string;
  completedAt: string;
  attempts: number;
  failoverCount: number;
  errors: Array<{ code: string; retryable: boolean }>;
  evidence: Array<{ kind: string; ref: string; sha256?: string }>;
  credentialExposure: false;
}

export interface AIExecutionAdapterV1 {
  endpointId: string;
  execute(request: JobExecutionRequestV1, signal?: AbortSignal): Promise<JobExecutionResultV1>;
}

export class AIExecutionDispatcherV1 {
  private readonly adapters = new Map<string, AIExecutionAdapterV1>();

  constructor(adapters: AIExecutionAdapterV1[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.endpointId)) throw new Error(`duplicate execution endpoint adapter: ${adapter.endpointId}`);
      this.adapters.set(adapter.endpointId, adapter);
    }
  }

  async execute(endpoint: AIExecutionEndpointV1, request: JobExecutionRequestV1, signal?: AbortSignal): Promise<JobExecutionResultV1> {
    if (endpoint.endpointId !== request.endpointId || endpoint.employeeId !== request.employeeId) throw new Error('execution request endpoint/employee mismatch');
    const adapter = this.adapters.get(endpoint.endpointId);
    if (!adapter) throw new Error(`execution adapter unavailable: ${endpoint.endpointId}`);
    const result = await adapter.execute(request, signal);
    if (result.contractVersion !== request.contractVersion || result.jobId !== request.jobId || result.promptId !== request.promptId || result.promptVersion !== request.promptVersion) throw new Error('execution result job/prompt binding mismatch');
    if (result.endpointId !== endpoint.endpointId || result.employeeId !== endpoint.employeeId) throw new Error('execution result endpoint/employee mismatch');
    if (result.provider !== endpoint.provider || result.model !== endpoint.model) throw new Error('execution result backend mismatch');
    if (result.credentialExposure !== false) throw new Error('execution result must prove credentialExposure=false');
    return result;
  }
}
