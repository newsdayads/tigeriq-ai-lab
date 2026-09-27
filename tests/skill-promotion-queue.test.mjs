import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSkillPromotionState,
  markCanaryReady,
  parsePromotionQueue,
  reconcilePromotionQueue,
  recordCanaryResult,
  startCanary,
  summarizePromotionQueue,
} from '../apps/tigeriq-core/skill-promotion.mjs';

test('current four VALIDATED skills are durably seeded in the promotion queue', () => {
  const state = loadSkillPromotionState();
  const ids = new Set(state.queue.entries.map((entry) => entry.skillId));
  for (const id of [
    'document-normalization-ingest',
    'source-grounded-knowledge-retrieval',
    'external-research-capability-routing',
    'domain-skill-packaging',
  ]) assert.equal(ids.has(id), true, id);
  assert.ok(state.summary.validatedWaiting >= 4);
});

test('a newly VALIDATED registry skill is automatically reconciled into the queue without a new Work Order', () => {
  const registry = { skills: [{ id: 'new-validated-skill', state: 'VALIDATED', source_log: 'learning-log/new.md' }] };
  const queue = { version: 1, updated: '2026-09-28', entries: [] };
  const next = reconcilePromotionQueue(registry, queue);
  assert.deepEqual(next.entries.map((entry) => [entry.skillId, entry.status]), [
    ['new-validated-skill', 'VALIDATED_WAITING_CANARY'],
  ]);
  assert.equal(next.entries[0].nextCondition, 'fixture_or_real_task_with_measurable_use_measure_evidence');
});

test('promotion queue rejects duplicates and nonterminal states without a next action', () => {
  assert.throws(() => parsePromotionQueue({
    version: 1,
    entries: [
      { skillId: 'same', status: 'VALIDATED_WAITING_CANARY', nextCondition: 'fixture' },
      { skillId: 'same', status: 'VALIDATED_WAITING_CANARY', nextCondition: 'fixture' },
    ],
  }), /DUPLICATE/);
  assert.throws(() => parsePromotionQueue({
    version: 1,
    entries: [{ skillId: 'lost', status: 'CANARY_READY' }],
  }), /MISSING_NEXT_CONDITION/);
});

test('bounded canary PASS records USE/MEASURE evidence and becomes promotion-eligible', () => {
  let queue = {
    version: 1,
    updated: '2026-09-28',
    entries: [{
      skillId: 'candidate',
      status: 'VALIDATED_WAITING_CANARY',
      attempts: 0,
      maxAttempts: 3,
      blocker: 'NO_CANARY_FIXTURE',
      nextCondition: 'fixture',
      evidence: [],
    }],
  };
  queue = markCanaryReady(queue, 'candidate', { fixtureRef: 'fixture://safe', provenanceRef: 'source://durable' });
  queue = startCanary(queue, 'candidate');
  queue = recordCanaryResult(queue, 'candidate', {
    outcome: 'PASS',
    at: '2026-09-28T00:00:00.000Z',
    useCount: 2,
    measureRef: 'evidence/use-measure.json',
    evidenceRef: 'github://evidence/123',
  });
  const entry = queue.entries[0];
  assert.equal(entry.status, 'ACTIVE');
  assert.equal(entry.promotionEligible, true);
  assert.equal(entry.evidence.at(-1).type, 'USE_MEASURE');
  assert.equal(entry.evidence.at(-1).useCount, 2);
});

test('FAIL/BLOCKED remains visible with blocker, next condition and bounded retry', () => {
  let queue = {
    version: 1,
    entries: [{
      skillId: 'blocked-skill',
      status: 'CANARY_READY',
      attempts: 2,
      maxAttempts: 3,
      blocker: null,
      nextCondition: 'run',
      fixtureRef: 'fixture://safe',
      provenanceRef: 'source://durable',
      evidence: [],
    }],
  };
  queue = startCanary(queue, 'blocked-skill');
  queue = recordCanaryResult(queue, 'blocked-skill', {
    outcome: 'BLOCKED',
    at: '2026-09-28T00:00:00.000Z',
    blocker: 'MISSING_MEASURABLE_FIXTURE',
    nextCondition: 'new_fixture_available',
    retryAfterSeconds: 60,
  });
  const entry = queue.entries[0];
  assert.equal(entry.status, 'VALIDATED_BLOCKED_EVIDENCE');
  assert.equal(entry.blocker, 'MISSING_MEASURABLE_FIXTURE');
  assert.equal(entry.nextCondition, 'new_fixture_available');
  assert.equal(entry.nextEligibleAt, null);
  assert.equal(entry.evidence.at(-1).retryAllowed, false);
});

test('status summary separates registry ACTIVE from validated waiting and blocked', () => {
  const registry = { skills: [
    { id: 'active-one', state: 'ACTIVE' },
    { id: 'wait-one', state: 'VALIDATED' },
    { id: 'blocked-one', state: 'VALIDATED' },
  ]};
  const queue = { version: 1, entries: [
    { skillId: 'wait-one', status: 'VALIDATED_WAITING_CANARY', nextCondition: 'fixture' },
    { skillId: 'blocked-one', status: 'VALIDATED_BLOCKED_EVIDENCE', blocker: 'NO_EVIDENCE', nextCondition: 'evidence_available' },
  ]};
  assert.deepEqual(summarizePromotionQueue(registry, queue), {
    active: 1,
    validatedWaiting: 1,
    validatedBlocked: 1,
    canaryReady: 0,
    canaryRunning: 0,
    promotionEligible: 0,
    tracked: 2,
  });
});

test('loadSkillPromotionState derives queue state from durable registry + queue files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tigeriq-promotion-'));
  try {
    const registryPath = join(dir, 'registry.yaml');
    const queuePath = join(dir, 'promotion-queue.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(registryPath, [
      'version: 1',
      'skills:',
      '  - id: durable-new',
      '    title: Durable New',
      '    state: VALIDATED',
      '    version: 1.0.0',
      '    source_log: learning-log/durable.md',
      '    target: test',
      '    summary: test',
    ].join('\n'));
    writeFileSync(queuePath, JSON.stringify({ version: 1, entries: [] }));
    const state = loadSkillPromotionState({ registryPath, queuePath });
    assert.equal(state.queue.entries[0].skillId, 'durable-new');
    assert.equal(state.summary.validatedWaiting, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
