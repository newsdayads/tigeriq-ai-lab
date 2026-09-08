import { createHash } from 'node:crypto';
import type { ExecutiveDashboardV4, ExecutiveSystemV4, ExecutiveWorkV4 } from './executive-data-v4.js';

export type LiveEventTypeV5 =
  | 'work.queued' | 'work.started' | 'work.heartbeat' | 'work.blocked' | 'work.completed'
  | 'system.health' | 'system.error' | 'system.recovered';

export interface LiveEventV5 {
  event_id: string;
  event_type: LiveEventTypeV5;
  timestamp: string;
  entity_type: 'work' | 'system';
  entity_id: string;
  work_id?: string;
  owner_id?: string;
  phase?: string;
  step?: string;
  message: string;
  evidence_ref?: string;
  severity: 'info' | 'warning' | 'error';
  state: string;
  source_version: string;
}

type ProjectionState = { signature: string; tone: string; sourceVersion: string };
function stableId(parts: string[]): string {
  return `evt-${createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 24)}`;
}

function workSourceVersion(work: ExecutiveWorkV4): string {
  return `${work.updated}|${work.status}|${work.tone}|${work.ownerCode ?? ''}|${work.next}`;
}

function workType(work: ExecutiveWorkV4, previous?: ProjectionState): LiveEventTypeV5 {
  if (work.tone === 'done') return 'work.completed';
  if (work.tone === 'blocked' || work.tone === 'paused' || work.tone === 'stale') return 'work.blocked';
  if (work.tone === 'active') return previous?.tone === 'active' ? 'work.heartbeat' : 'work.started';
  return 'work.queued';
}

function workEvent(work: ExecutiveWorkV4, timestamp: string, previous?: ProjectionState): LiveEventV5 {
  const entityId = work.number ? String(work.number) : `title:${work.title}`;
  const sourceVersion = workSourceVersion(work);
  const eventType = workType(work, previous);
  return {
    event_id: stableId(['work', entityId, eventType, sourceVersion]),
    event_type: eventType,
    timestamp,
    entity_type: 'work',
    entity_id: entityId,
    work_id: work.number ? `GH-${work.number}` : entityId,
    owner_id: work.ownerCode ?? undefined,
    phase: work.status,
    step: work.next,
    message: `${work.title} · ${work.status}`,
    evidence_ref: work.number ? `github-issue:${work.number}` : undefined,
    severity: work.tone === 'blocked' ? 'error' : ['paused', 'stale'].includes(work.tone) ? 'warning' : 'info',
    state: work.tone,
    source_version: sourceVersion,
  };
}
function systemSourceVersion(system: ExecutiveSystemV4): string {
  return `${system.status}|${system.tone}|${system.note}`;
}

function systemEvent(system: ExecutiveSystemV4, timestamp: string, previous?: ProjectionState): LiveEventV5 {
  const sourceVersion = systemSourceVersion(system);
  const recovered = previous && ['blocked', 'waiting', 'unknown'].includes(previous.tone) && ['active', 'done'].includes(system.tone);
  const eventType: LiveEventTypeV5 = recovered ? 'system.recovered' : system.tone === 'blocked' ? 'system.error' : 'system.health';
  return {
    event_id: stableId(['system', system.key, eventType, sourceVersion]),
    event_type: eventType,
    timestamp,
    entity_type: 'system',
    entity_id: system.key,
    message: `${system.name} · ${system.status}`,
    severity: system.tone === 'blocked' ? 'error' : ['waiting', 'unknown'].includes(system.tone) ? 'warning' : 'info',
    state: system.tone,
    source_version: sourceVersion,
  };
}

export class LiveEventProjectionV5 {
  readonly #state = new Map<string, ProjectionState>();

  ingest(snapshot: ExecutiveDashboardV4): LiveEventV5[] {
    const events: LiveEventV5[] = [];
    for (const work of snapshot.works) {
      const id = `work:${work.number ?? work.title}`;
      const sourceVersion = workSourceVersion(work);
      const previous = this.#state.get(id);
      const signature = `${work.tone}|${sourceVersion}`;
      if (!previous || previous.signature !== signature) events.push(workEvent(work, snapshot.generatedAt, previous));
      this.#state.set(id, { signature, tone: work.tone, sourceVersion });
    }
    for (const system of snapshot.systems) {
      const id = `system:${system.key}`;
      const sourceVersion = systemSourceVersion(system);
      const previous = this.#state.get(id);
      const signature = `${system.tone}|${sourceVersion}`;
      if (!previous || previous.signature !== signature) events.push(systemEvent(system, snapshot.generatedAt, previous));
      this.#state.set(id, { signature, tone: system.tone, sourceVersion });
    }
    return events;
  }
}

export class LiveEventBufferV5 {
  readonly #rows: LiveEventV5[] = [];
  readonly #ids = new Set<string>();
  constructor(readonly limit = 200) {}

  append(events: readonly LiveEventV5[]): LiveEventV5[] {
    const added: LiveEventV5[] = [];
    for (const event of events) {
      if (this.#ids.has(event.event_id)) continue;
      this.#ids.add(event.event_id);
      this.#rows.push(structuredClone(event));
      added.push(structuredClone(event));
    }
    while (this.#rows.length > this.limit) {
      const removed = this.#rows.shift();
      if (removed) this.#ids.delete(removed.event_id);
    }
    return added;
  }

  since(lastEventId?: string): LiveEventV5[] {
    if (!lastEventId) return structuredClone(this.#rows);
    const index = this.#rows.findIndex((event) => event.event_id === lastEventId);
    return structuredClone(index < 0 ? this.#rows : this.#rows.slice(index + 1));
  }
}
