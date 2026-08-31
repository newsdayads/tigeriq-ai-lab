import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ProviderRequestError,
  type ModelRequest,
  type ModelTarget,
  type Provider,
  type ProviderAdapter,
  type ProviderFailureKind,
} from '../../model-router/src/index.js';

export type WorkKind = 'general' | 'coding' | 'analysis' | 'research';
export type WorkRisk = 'low' | 'medium' | 'high';
export type CoordinatorRole = 'executor' | 'reviewer' | 'judge';
export type CoordinatorStatus =
  | 'received'
  | 'executing'
  | 'reviewing'
  | 'judging'
  | 'verified'
  | 'failed'
  | 'blocked';
export type GateDecision = 'PASS' | 'FAIL';

export interface AIWorkItem {
  id: string;
  prompt: string;
  kind: WorkKind;
  risk: WorkRisk;
  acceptanceCriteria?: string[];
  minQuality?: number;
}

export interface ModelProfile {
  target: ModelTarget;
  costRank: number;
  qualityRank: number;
  kinds: WorkKind[];
  roles?: CoordinatorRole[];
  enabled?: boolean;
}

export interface CoordinatorAttempt {
  sequence: number;
  role: CoordinatorRole;
  target: ModelTarget;
  ok: boolean;
  failureKind?: ProviderFailureKind;
  decision?: GateDecision;
  error?: string;
  timestamp: string;
}

export interface StageArtifact {
  role: CoordinatorRole;
  target: ModelTarget;
  text: string;
  decision?: GateDecision;
  completedAt: string;
}

export interface CoordinatorCheckpoint {
  workItemId: string;
  fingerprint: string;
  status: CoordinatorStatus;
  attempts: CoordinatorAttempt[];
  executor?: StageArtifact;
  reviewer?: StageArtifact;
  judge?: StageArtifact;
  blocker?: string;
  updatedAt: string;
}

export interface CoordinatorEvidence {
  workItemId: string;
  fingerprint: string;
  status: CoordinatorStatus;
  attempts: Array<{
    sequence: number;
    role: CoordinatorRole;
    provider: Provider;
    model: string;
    ok: boolean;
    failureKind?: ProviderFailureKind;
    decision?: GateDecision;
  }>;
  stages: Array<{
    role: CoordinatorRole;
    provider: Provider;
    model: string;
    decision?: GateDecision;
    outputSha256: string;
  }>;
  blocker?: string;
  updatedAt: string;
}

export interface CheckpointStore {
  load(workItemId: string): Promise<CoordinatorCheckpoint | undefined>;
  save(checkpoint: CoordinatorCheckpoint): Promise<void>;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly records = new Map<string, CoordinatorCheckpoint>();

  async load(workItemId: string): Promise<CoordinatorCheckpoint | undefined> {
    const value = this.records.get(workItemId);
    return value ? clone(value) : undefined;
  }

  async save(checkpoint: CoordinatorCheckpoint): Promise<void> {
    this.records.set(checkpoint.workItemId, clone(checkpoint));
  }
}

export class JsonFileCheckpointStore implements CheckpointStore {
  constructor(private readonly rootDir: string) {}

  async load(workItemId: string): Promise<CoordinatorCheckpoint | undefined> {
    try {
      const raw = await readFile(this.pathFor(workItemId), 'utf8');
      return JSON.parse(raw) as CoordinatorCheckpoint;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async save(checkpoint: CoordinatorCheckpoint): Promise<void> {
    const path = this.pathFor(checkpoint.workItemId);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(checkpoint, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, path);
  }

  private pathFor(workItemId: string): string {
    const file = `${createHash('sha256').update(workItemId).digest('hex')}.json`;
    return join(this.rootDir, file);
  }
}

export interface AICoordinatorOptions {
  profiles?: ModelProfile[];
  maxAttemptsPerStage?: number;
  now?: () => Date;
}

export const defaultModelProfiles: ModelProfile[] = [
  {
    target: { provider: 'ollama', model: 'local-coder', local: true },
    costRank: 0,
    qualityRank: 2,
    kinds: ['general', 'coding', 'analysis'],
  },
  {
    target: { provider: 'gemini', model: 'gemini-default' },
    costRank: 1,
    qualityRank: 4,
    kinds: ['general', 'coding', 'analysis', 'research'],
  },
  {
    target: { provider: 'openai', model: 'openai-default' },
    costRank: 2,
    qualityRank: 4,
    kinds: ['general', 'coding', 'analysis', 'research'],
  },
  {
    target: { provider: 'anthropic', model: 'anthropic-default' },
    costRank: 2,
    qualityRank: 4,
    kinds: ['general', 'coding', 'analysis', 'research'],
  },
];

export class AICoordinator {
  private readonly adapters = new Map<Provider, ProviderAdapter>();
  private readonly profiles: ModelProfile[];
  private readonly maxAttemptsPerStage: number;
  private readonly now: () => Date;

  constructor(
    adapters: ProviderAdapter[],
    private readonly store: CheckpointStore,
    options: AICoordinatorOptions = {},
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.provider)) throw new Error(`duplicate adapter: ${adapter.provider}`);
      this.adapters.set(adapter.provider, adapter);
    }
    this.profiles = [...(options.profiles ?? defaultModelProfiles)];
    this.maxAttemptsPerStage = Math.max(1, options.maxAttemptsPerStage ?? 3);
    this.now = options.now ?? (() => new Date());
  }

  async run(work: AIWorkItem, request: Pick<ModelRequest, 'signal'> = {}): Promise<CoordinatorCheckpoint> {
    validateWork(work);
    const fingerprint = fingerprintWorkItem(work);
    let checkpoint = await this.store.load(work.id);
    if (checkpoint && checkpoint.fingerprint !== fingerprint) {
      throw new Error(`work item ${work.id} does not match persisted checkpoint`);
    }
    if (!checkpoint) {
      checkpoint = {
        workItemId: work.id,
        fingerprint,
        status: 'received',
        attempts: [],
        updatedAt: this.timestamp(),
      };
      await this.store.save(checkpoint);
    }
    if (checkpoint.status === 'verified' || checkpoint.status === 'failed' || checkpoint.status === 'blocked') {
      return checkpoint;
    }

    if (!checkpoint.executor) {
      checkpoint.status = 'executing';
      checkpoint.blocker = undefined;
      checkpoint.updatedAt = this.timestamp();
      await this.store.save(checkpoint);
      const ok = await this.runStage(work, checkpoint, 'executor', this.executorPrompt(work), new Set(), request.signal);
      if (!ok) return checkpoint;
    }
    const executor = checkpoint.executor;
    if (!executor) {
      await this.markBlocked(checkpoint, 'executor completed without a persisted artifact');
      return checkpoint;
    }

    if (!checkpoint.reviewer) {
      checkpoint.status = 'reviewing';
      checkpoint.updatedAt = this.timestamp();
      await this.store.save(checkpoint);
      const excluded = new Set([identity(executor.target)]);
      const ok = await this.runStage(
        work,
        checkpoint,
        'reviewer',
        this.reviewerPrompt(work, executor),
        excluded,
        request.signal,
      );
      if (!ok) return checkpoint;
    }
    const reviewer = checkpoint.reviewer;
    if (!reviewer) {
      await this.markBlocked(checkpoint, 'reviewer completed without a persisted artifact');
      return checkpoint;
    }

    if (!checkpoint.judge) {
      checkpoint.status = 'judging';
      checkpoint.updatedAt = this.timestamp();
      await this.store.save(checkpoint);
      const strict = requiresStrictIndependence(work);
      const excluded = new Set<string>();
      excluded.add(identity(executor.target));
      if (strict) excluded.add(identity(reviewer.target));
      const ok = await this.runStage(
        work,
        checkpoint,
        'judge',
        this.judgePrompt(work, executor, reviewer),
        excluded,
        request.signal,
      );
      if (!ok) return checkpoint;
    }
    const judge = checkpoint.judge;
    if (!judge) {
      await this.markBlocked(checkpoint, 'judge completed without a persisted artifact');
      return checkpoint;
    }

    const reviewPass = reviewer.decision === 'PASS';
    const judgePass = judge.decision === 'PASS';
    checkpoint.status = reviewPass && judgePass ? 'verified' : 'failed';
    checkpoint.blocker = reviewPass && judgePass ? undefined : 'independent verification did not pass';
    checkpoint.updatedAt = this.timestamp();
    await this.store.save(checkpoint);
    return checkpoint;
  }

  evidence(checkpoint: CoordinatorCheckpoint): CoordinatorEvidence {
    const stages = [checkpoint.executor, checkpoint.reviewer, checkpoint.judge]
      .filter((stage): stage is StageArtifact => Boolean(stage))
      .map((stage) => ({
        role: stage.role,
        provider: stage.target.provider,
        model: stage.target.model,
        decision: stage.decision,
        outputSha256: createHash('sha256').update(stage.text).digest('hex'),
      }));
    return {
      workItemId: checkpoint.workItemId,
      fingerprint: checkpoint.fingerprint,
      status: checkpoint.status,
      attempts: checkpoint.attempts.map((attempt) => ({
        sequence: attempt.sequence,
        role: attempt.role,
        provider: attempt.target.provider,
        model: attempt.target.model,
        ok: attempt.ok,
        failureKind: attempt.failureKind,
        decision: attempt.decision,
      })),
      stages,
      blocker: checkpoint.blocker,
      updatedAt: checkpoint.updatedAt,
    };
  }

  private async runStage(
    work: AIWorkItem,
    checkpoint: CoordinatorCheckpoint,
    role: CoordinatorRole,
    prompt: string,
    excludedIdentities: Set<string>,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const previous = checkpoint.attempts.filter((attempt) => attempt.role === role);
    const alreadyTried = new Set(previous.map((attempt) => identity(attempt.target)));
    const remainingBudget = this.maxAttemptsPerStage - previous.length;
    if (remainingBudget <= 0) {
      await this.markBlocked(checkpoint, `${role} attempt limit exhausted`);
      return false;
    }

    const candidates = this.selectCandidates(work, role, excludedIdentities)
      .filter((profile) => !alreadyTried.has(identity(profile.target)))
      .slice(0, remainingBudget);
    if (candidates.length === 0) {
      await this.markBlocked(checkpoint, `${role} has no eligible independent model`);
      return false;
    }

    for (const profile of candidates) {
      if (signal?.aborted) throw new Error('AI coordinator request aborted');
      const adapter = this.adapters.get(profile.target.provider);
      if (!adapter) continue;
      try {
        const text = await adapter.execute(profile.target, { prompt, signal });
        if (!text.trim()) {
          throw new ProviderRequestError(profile.target.provider, 'invalid_response', 'empty provider response');
        }
        const decision = role === 'executor' ? undefined : parseDecision(text);
        if (role !== 'executor' && !decision) {
          await this.recordFailure(checkpoint, role, profile.target, 'invalid_response');
          continue;
        }
        const artifact: StageArtifact = {
          role,
          target: profile.target,
          text,
          decision,
          completedAt: this.timestamp(),
        };
        checkpoint.attempts.push({
          sequence: checkpoint.attempts.length + 1,
          role,
          target: profile.target,
          ok: true,
          decision,
          timestamp: this.timestamp(),
        });
        if (role === 'executor') checkpoint.executor = artifact;
        if (role === 'reviewer') checkpoint.reviewer = artifact;
        if (role === 'judge') checkpoint.judge = artifact;
        checkpoint.updatedAt = this.timestamp();
        await this.store.save(checkpoint);
        return true;
      } catch (error) {
        if (signal?.aborted) throw new Error('AI coordinator request aborted');
        const failureKind = error instanceof ProviderRequestError ? error.kind : 'unknown';
        await this.recordFailure(checkpoint, role, profile.target, failureKind);
      }
    }

    await this.markBlocked(checkpoint, `${role} routes exhausted within retry limit`);
    return false;
  }

  private selectCandidates(work: AIWorkItem, role: CoordinatorRole, excluded: Set<string>): ModelProfile[] {
    const minQuality = work.minQuality ?? minimumQuality(work.risk);
    return this.profiles
      .filter((profile) => profile.enabled !== false)
      .filter((profile) => this.adapters.has(profile.target.provider))
      .filter((profile) => profile.kinds.includes(work.kind))
      .filter((profile) => !profile.roles || profile.roles.includes(role))
      .filter((profile) => profile.qualityRank >= minQuality)
      .filter((profile) => !excluded.has(identity(profile.target)))
      .sort((a, b) => a.costRank - b.costRank || b.qualityRank - a.qualityRank || identity(a.target).localeCompare(identity(b.target)));
  }

  private executorPrompt(work: AIWorkItem): string {
    return `ROLE: EXECUTOR\nWORK_ID: ${work.id}\nTASK_KIND: ${work.kind}\nTASK_RISK: ${work.risk}\nTASK:\n${work.prompt}\nACCEPTANCE:\n${criteria(work)}`;
  }

  private reviewerPrompt(work: AIWorkItem, executor: StageArtifact): string {
    return `ROLE: INDEPENDENT REVIEWER\nReturn PASS or FAIL as the first token, then concise evidence.\nWORK_ID: ${work.id}\nTASK:\n${work.prompt}\nACCEPTANCE:\n${criteria(work)}\nEXECUTOR_PROVIDER: ${identity(executor.target)}\nEXECUTOR_OUTPUT:\n${executor.text}`;
  }

  private judgePrompt(work: AIWorkItem, executor: StageArtifact, reviewer: StageArtifact): string {
    return `ROLE: INDEPENDENT JUDGE\nReturn PASS or FAIL as the first token, then concise reason.\nDo not pass if acceptance criteria are unmet or reviewer evidence identifies an unresolved material defect.\nWORK_ID: ${work.id}\nTASK:\n${work.prompt}\nACCEPTANCE:\n${criteria(work)}\nEXECUTOR_PROVIDER: ${identity(executor.target)}\nEXECUTOR_OUTPUT:\n${executor.text}\nREVIEWER_PROVIDER: ${identity(reviewer.target)}\nREVIEWER_DECISION: ${reviewer.decision}\nREVIEWER_OUTPUT:\n${reviewer.text}`;
  }

  private async recordFailure(
    checkpoint: CoordinatorCheckpoint,
    role: CoordinatorRole,
    target: ModelTarget,
    failureKind: ProviderFailureKind,
  ): Promise<void> {
    checkpoint.attempts.push({
      sequence: checkpoint.attempts.length + 1,
      role,
      target,
      ok: false,
      failureKind,
      error: `${target.provider} ${failureKind}`,
      timestamp: this.timestamp(),
    });
    checkpoint.updatedAt = this.timestamp();
    await this.store.save(checkpoint);
  }

  private async markBlocked(checkpoint: CoordinatorCheckpoint, blocker: string): Promise<void> {
    checkpoint.status = 'blocked';
    checkpoint.blocker = blocker;
    checkpoint.updatedAt = this.timestamp();
    await this.store.save(checkpoint);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export function fingerprintWorkItem(work: AIWorkItem): string {
  return createHash('sha256')
    .update(JSON.stringify({
      id: work.id,
      prompt: work.prompt,
      kind: work.kind,
      risk: work.risk,
      acceptanceCriteria: work.acceptanceCriteria ?? [],
      minQuality: work.minQuality ?? null,
    }))
    .digest('hex');
}

export function requiresStrictIndependence(work: AIWorkItem): boolean {
  return work.kind === 'coding' || work.risk === 'high';
}

function minimumQuality(risk: WorkRisk): number {
  if (risk === 'high') return 3;
  if (risk === 'medium') return 2;
  return 1;
}

function parseDecision(text: string): GateDecision | undefined {
  const match = text.trim().match(/^(PASS|FAIL)\b/i);
  return match?.[1]?.toUpperCase() as GateDecision | undefined;
}

function criteria(work: AIWorkItem): string {
  return work.acceptanceCriteria?.length
    ? work.acceptanceCriteria.map((item) => `- ${item}`).join('\n')
    : '- Produce a correct, complete result for the stated task.';
}

function identity(target: ModelTarget): string {
  return `${target.provider}/${target.model}`;
}

function validateWork(work: AIWorkItem): void {
  if (!work.id.trim()) throw new Error('work id is required');
  if (!work.prompt.trim()) throw new Error('work prompt is required');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
