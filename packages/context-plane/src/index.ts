export type ContextKind = 'global-index' | 'hot-state' | 'authority' | 'registry' | 'work-item' | 'evidence' | 'checkpoint' | 'other';

export interface ContextRef {
  key: string;
  revision?: string;
  sha?: string;
  kind: ContextKind;
}

export interface ContextRead<T = unknown> {
  value: T;
  revision?: string;
  sha?: string;
  byteLength?: number;
  fetchedAt?: number;
}

export interface ContextReader {
  read<T = unknown>(ref: ContextRef): Promise<ContextRead<T>>;
}

export interface GlobalHotIndex {
  schema: 'tigeriq-context-plane/v3';
  revision: string;
  authority: {
    central: ContextRef;
    registry: ContextRef;
  };
  commands: Record<string, string>;
  employees: Record<string, {
    employee_id: string;
    state: ContextRef;
    enabled: boolean;
    background: boolean;
    activation_state: string;
  }>;
  generated_at: number;
}

export interface WorkerHotState {
  schema: 'tigeriq-hot-state/v1';
  employee_id: string;
  revision: string;
  authority_revision: {
    central: string;
    registry: string;
  };
  current_work: string | null;
  lease?: {
    owner: string;
    resource: string;
    expires_at: number;
  } | null;
  checkpoint?: ContextRef | null;
  next_action?: string | null;
  blockers: string[];
  open_gates: string[];
  evidence: ContextRef[];
  updated_at: number;
  deep_read_required?: boolean;
  deep_read_reason?: string | null;
}

export type StartupError =
  | 'GLOBAL_INDEX_INVALID'
  | 'COMMAND_UNREGISTERED'
  | 'EMPLOYEE_DISABLED'
  | 'HOT_STATE_INVALID'
  | 'HOT_STATE_EMPLOYEE_MISMATCH'
  | 'HOT_STATE_AUTHORITY_STALE'
  | 'DEEP_READ_REQUIRED';

export interface StartupResult {
  ok: boolean;
  command: string;
  employee_id?: string;
  background?: boolean;
  activation_state?: string;
  state?: WorkerHotState;
  error?: StartupError;
  requires_deep_read: boolean;
  metrics: ContextPlaneMetricsSnapshot;
}

export interface ContextPlaneMetricsSnapshot {
  read_calls: number;
  source_fetches: number;
  cache_hits: number;
  coalesced_reads: number;
  bytes_loaded: number;
  deep_reads: number;
}

export interface ContextPlaneOptions {
  mutableTtlMs?: number;
  now?: () => number;
}

interface CacheEntry {
  read: ContextRead<unknown>;
  cachedAt: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function refKey(ref: ContextRef): string {
  const rev = ref.revision ? `@${ref.revision}` : '';
  const sha = ref.sha ? `#${ref.sha}` : '';
  return `${ref.kind}:${ref.key}${rev}${sha}`;
}

function refRevision(ref: ContextRef): string {
  return String(ref.revision ?? ref.sha ?? '');
}

function validRef(ref: ContextRef | undefined): ref is ContextRef {
  return !!ref && typeof ref.key === 'string' && ref.key.length > 0 && typeof ref.kind === 'string';
}

function validGlobalIndex(value: unknown): value is GlobalHotIndex {
  if (!value || typeof value !== 'object') return false;
  const x = value as Partial<GlobalHotIndex>;
  return x.schema === 'tigeriq-context-plane/v3'
    && typeof x.revision === 'string'
    && !!x.authority
    && validRef(x.authority.central)
    && validRef(x.authority.registry)
    && !!x.commands
    && typeof x.commands === 'object'
    && !!x.employees
    && typeof x.employees === 'object';
}

function validWorkerHotState(value: unknown): value is WorkerHotState {
  if (!value || typeof value !== 'object') return false;
  const x = value as Partial<WorkerHotState>;
  return x.schema === 'tigeriq-hot-state/v1'
    && typeof x.employee_id === 'string'
    && typeof x.revision === 'string'
    && !!x.authority_revision
    && typeof x.authority_revision.central === 'string'
    && typeof x.authority_revision.registry === 'string'
    && Array.isArray(x.blockers)
    && Array.isArray(x.open_gates)
    && Array.isArray(x.evidence);
}

export class ContextPlane {
  readonly #reader: ContextReader;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #inflight = new Map<string, Promise<ContextRead<unknown>>>();
  readonly #mutableTtlMs: number;
  readonly #now: () => number;
  #metrics: ContextPlaneMetricsSnapshot = {
    read_calls: 0,
    source_fetches: 0,
    cache_hits: 0,
    coalesced_reads: 0,
    bytes_loaded: 0,
    deep_reads: 0,
  };

  constructor(reader: ContextReader, options: ContextPlaneOptions = {}) {
    this.#reader = reader;
    this.#mutableTtlMs = Math.max(0, options.mutableTtlMs ?? 5_000);
    this.#now = options.now ?? Date.now;
  }

  metrics(): ContextPlaneMetricsSnapshot {
    return clone(this.#metrics);
  }

  resetMetrics(): void {
    this.#metrics = { read_calls: 0, source_fetches: 0, cache_hits: 0, coalesced_reads: 0, bytes_loaded: 0, deep_reads: 0 };
  }

  invalidate(match?: string | ContextRef): number {
    if (!match) {
      const size = this.#cache.size;
      this.#cache.clear();
      return size;
    }
    const needle = typeof match === 'string' ? match : refKey(match);
    let removed = 0;
    for (const key of this.#cache.keys()) {
      if (key === needle || key.includes(needle)) {
        this.#cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async read<T = unknown>(ref: ContextRef, options: { force?: boolean; deep?: boolean } = {}): Promise<ContextRead<T>> {
    if (!validRef(ref)) throw new Error('CONTEXT_REF_INVALID');
    this.#metrics.read_calls++;
    if (options.deep) this.#metrics.deep_reads++;

    const key = refKey(ref);
    const cached = this.#cache.get(key);
    const immutable = !!ref.revision || !!ref.sha;
    if (!options.force && cached && (immutable || this.#now() - cached.cachedAt <= this.#mutableTtlMs)) {
      this.#metrics.cache_hits++;
      return clone(cached.read as ContextRead<T>);
    }

    const existing = this.#inflight.get(key);
    if (!options.force && existing) {
      this.#metrics.coalesced_reads++;
      return clone(await existing as ContextRead<T>);
    }

    const pending = this.#reader.read<T>(ref).then((read) => {
      this.#metrics.source_fetches++;
      this.#metrics.bytes_loaded += Math.max(0, Number(read.byteLength ?? 0));
      const normalized: ContextRead<T> = {
        ...read,
        fetchedAt: read.fetchedAt ?? this.#now(),
      };
      this.#cache.set(key, { read: clone(normalized), cachedAt: this.#now() });
      return normalized;
    }).finally(() => {
      this.#inflight.delete(key);
    });

    this.#inflight.set(key, pending as Promise<ContextRead<unknown>>);
    return clone(await pending);
  }

  async startup(command: string | number, globalIndexRef: ContextRef): Promise<StartupResult> {
    const cmd = String(command).trim();
    const indexRead = await this.read<GlobalHotIndex>(globalIndexRef);
    if (!validGlobalIndex(indexRead.value)) return this.#fail(cmd, 'GLOBAL_INDEX_INVALID');

    const index = indexRead.value;
    const employeeId = index.commands[cmd];
    if (!employeeId) return this.#fail(cmd, 'COMMAND_UNREGISTERED');

    const profile = index.employees[employeeId];
    if (!profile || profile.employee_id !== employeeId || !validRef(profile.state)) return this.#fail(cmd, 'GLOBAL_INDEX_INVALID');
    if (!profile.enabled) return this.#fail(cmd, 'EMPLOYEE_DISABLED', employeeId, profile.background, profile.activation_state);

    const stateRead = await this.read<WorkerHotState>(profile.state);
    if (!validWorkerHotState(stateRead.value)) return this.#fail(cmd, 'HOT_STATE_INVALID', employeeId, profile.background, profile.activation_state);
    const state = stateRead.value;
    if (state.employee_id !== employeeId) return this.#fail(cmd, 'HOT_STATE_EMPLOYEE_MISMATCH', employeeId, profile.background, profile.activation_state);

    const centralRevision = refRevision(index.authority.central);
    const registryRevision = refRevision(index.authority.registry);
    if (!centralRevision || !registryRevision
      || state.authority_revision.central !== centralRevision
      || state.authority_revision.registry !== registryRevision) {
      return this.#fail(cmd, 'HOT_STATE_AUTHORITY_STALE', employeeId, profile.background, profile.activation_state);
    }

    if (state.deep_read_required) return {
      ok: false,
      command: cmd,
      employee_id: employeeId,
      background: profile.background,
      activation_state: profile.activation_state,
      state: clone(state),
      error: 'DEEP_READ_REQUIRED',
      requires_deep_read: true,
      metrics: this.metrics(),
    };

    return {
      ok: true,
      command: cmd,
      employee_id: employeeId,
      background: profile.background,
      activation_state: profile.activation_state,
      state: clone(state),
      requires_deep_read: false,
      metrics: this.metrics(),
    };
  }

  async deepRead<T = unknown>(ref: ContextRef): Promise<ContextRead<T>> {
    return this.read<T>(ref, { deep: true });
  }

  #fail(command: string, error: StartupError, employee_id?: string, background?: boolean, activation_state?: string): StartupResult {
    return {
      ok: false,
      command,
      employee_id,
      background,
      activation_state,
      error,
      requires_deep_read: error === 'HOT_STATE_AUTHORITY_STALE' || error === 'DEEP_READ_REQUIRED',
      metrics: this.metrics(),
    };
  }
}

export function buildGlobalHotIndex(input: {
  revision: string;
  central: ContextRef;
  registry: ContextRef;
  commands: Record<string, string>;
  employees: GlobalHotIndex['employees'];
  generated_at?: number;
}): GlobalHotIndex {
  if (!validRef(input.central) || !validRef(input.registry)) throw new Error('AUTHORITY_REF_INVALID');
  if (!refRevision(input.central) || !refRevision(input.registry)) throw new Error('AUTHORITY_REVISION_REQUIRED');
  return {
    schema: 'tigeriq-context-plane/v3',
    revision: input.revision,
    authority: { central: clone(input.central), registry: clone(input.registry) },
    commands: clone(input.commands),
    employees: clone(input.employees),
    generated_at: input.generated_at ?? Date.now(),
  };
}
