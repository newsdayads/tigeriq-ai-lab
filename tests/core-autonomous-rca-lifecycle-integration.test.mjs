import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';
import {
  autonomousRcaCanonicalAction,
  autonomousRcaMaterializationDedupe,
  classifyAutonomousRca,
  dedupeAutonomousRca,
  buildImprovementWorkOrder,
  buildOwnerException,
} from '../apps/tigeriq-core/autonomous-rca.mjs';

// Hermetic integration of the *actual* materialization and GitHub lifecycle
// functions. No process, require, fetch, database, or GitHub client is exposed
// to the VM. Its sole HTTP adapter handles GET/PATCH of a fake canonical issue;
// new-issue creation always throws before making any external request.
const coreSource = readFileSync(new URL('../apps/tigeriq-core/core.mjs', import.meta.url), 'utf8');

function extractFunction(name, until) {
  const start = coreSource.indexOf('async function ' + name + '(');
  const end = coreSource.indexOf(until, start);
  if (start < 0 || end <= start) {
    throw new Error('RCA_INTEGRATION_SOURCE_BOUNDARY_CHANGED:' + name);
  }
  return coreSource.slice(start, end).trim();
}

const lifecycleSource = [
  extractFunction('githubAutonomousRcaIssueLifecycle', '\nasync function githubRearmAutonomousRcaIssue'),
  extractFunction('githubRearmAutonomousRcaIssue', '\nasync function materializeAutonomousRca'),
  extractFunction('materializeAutonomousRca', '\nexport async function runSelfAuditScan'),
].join('\n\n');

for (const token of [
  'githubAutonomousRcaIssueLifecycle',
  'githubRearmAutonomousRcaIssue',
  'githubCreateAutonomousRcaIssue',
  'autonomousRcaMaterializationDedupe',
]) {
  if (!lifecycleSource.includes(token)) throw new Error('RCA_INTEGRATION_EXPECTED_PATH_MISSING:' + token);
}

function hermeticLifecycle({ state = 'open', reason = null, hasPrior = true, priorRearmHash = null } = {}) {
  const anomaly = {
    signature: 'test-integrity-anomaly',
    contract_id: 'SERVICE_FUNCTIONAL_INTEGRITY',
    severity: 'HIGH',
    status: 'OPEN',
    count: 2,
    evidence: { component: 'SERVICE_FUNCTIONAL_INTEGRITY' },
  };
  const rca = classifyAutonomousRca({
    signature: anomaly.signature,
    contractId: anomaly.contract_id,
    evidence: { ...anomaly.evidence, severity: anomaly.severity, observationCount: anomaly.count },
  });
  if (!rca.selfFixable || rca.hardGate) throw new Error('TEST_FIXTURE_IS_NOT_SAFE_RCA');

  let canonicalIssue = {
    number: 3278,
    state,
    state_reason: reason,
    body: priorRearmHash == null
      ? 'TIGERIQ_JOB_V1\nRCA_FAMILY_KEY=' + rca.rcaFamilyKey
      : [
        '## AUTO-RCA RECURRENCE REARM — AUTHORITATIVE',
        'RCA_FAMILY_KEY=' + rca.rcaFamilyKey,
        'EVIDENCE_HASH=' + (priorRearmHash === 'CURRENT' ? rca.evidenceHash : priorRearmHash),
        'DONE=false',
        '',
        'TIGERIQ_JOB_V1',
        'RCA_FAMILY_KEY=' + rca.rcaFamilyKey,
      ].join('\n'),
  };
  let patchCount = 0;
  let createAttempts = 0;
  const emitted = [];
  const httpMethods = [];

  const store = {
    async query(sql, params = []) {
      if (sql.includes('from tigeriq_self_audit_anomalies')) return { rows: [anomaly] };
      if (sql.includes('from tigeriq_events')) {
        if (params[0] !== 'AUTONOMOUS_RCA_WORK_ORDER' || params[1] !== rca.rcaFamilyKey) {
          throw new Error('RCA_INTEGRATION_PRIOR_HISTORY_LOOKUP_CHANGED');
        }
        return {
          rows: hasPrior
            ? [{ type: 'AUTONOMOUS_RCA_WORK_ORDER', data: { issueNumber: 3278, rcaFamilyKey: rca.rcaFamilyKey } }]
            : [],
        };
      }
      throw new Error('RCA_INTEGRATION_UNEXPECTED_SQL');
    },
  };

  const fetchJson = async (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (url !== 'https://api.github.com/repos/hermetic/sandbox/issues/3278') {
      throw new Error('RCA_INTEGRATION_OUTBOUND_URL_FORBIDDEN');
    }
    httpMethods.push(method);
    if (method === 'GET') return { ...canonicalIssue };
    if (method === 'PATCH') {
      const payload = JSON.parse(options.body || '{}');
      if (payload.state !== 'open' || typeof payload.body !== 'string') {
        throw new Error('RCA_INTEGRATION_MUTATION_NOT_CANONICAL_REARM');
      }
      patchCount += 1;
      canonicalIssue = { ...canonicalIssue, state: 'open', state_reason: 'reopened', body: payload.body };
      return { ...canonicalIssue };
    }
    throw new Error('RCA_INTEGRATION_HTTP_METHOD_FORBIDDEN:' + method);
  };

  const sandbox = {
    GITHUB_TOKEN: 'hermetic-test-placeholder',
    GITHUB_OWNER: 'hermetic',
    GITHUB_REPO: 'sandbox',
    fetchJson,
    event: async (type, payload) => { emitted.push({ type, payload }); },
    classifyAutonomousRca,
    dedupeAutonomousRca,
    autonomousRcaCanonicalAction,
    autonomousRcaMaterializationDedupe,
    buildImprovementWorkOrder,
    buildOwnerException,
    githubCreateAutonomousRcaIssue: async () => {
      createAttempts += 1;
      throw new Error('RCA_INTEGRATION_NEW_WORK_ORDER_FORBIDDEN');
    },
  };

  const runner = runInNewContext(
    lifecycleSource + '\nmaterializeAutonomousRca;',
    sandbox,
    { timeout: 1000, filename: 'hermetic-auto-rca-lifecycle.mjs' },
  );

  return {
    run: async () => runner({ store }),
    emitted,
    httpMethods,
    get issue() { return canonicalIssue; },
    get patchCount() { return patchCount; },
    get createAttempts() { return createAttempts; },
  };
}

describe('Core RCA GitHub lifecycle, hermetic materialization integration', () => {
  const dedupedScenarios = [
    ['open', null, 'DEDUPE_ACTIVE'],
    ['reopened', null, 'DEDUPE_ACTIVE'],
    ['closed', 'not_planned', 'SUPPRESS_CLOSED'],
    ['closed', 'duplicate', 'SUPPRESS_CLOSED'],
    ['unknown', null, 'DEDUPE_UNKNOWN'],
  ];

  for (const [state, reason, action] of dedupedScenarios) {
    it('keeps canonical identity and creates zero work orders for ' + state + '/' + reason, async () => {
      const h = hermeticLifecycle({ state, reason });
      const result = await h.run();
      expect(result).toMatchObject({
        candidates: 1, workOrders: 0, deduped: 1, blocked: 0,
      });
      expect(h.createAttempts).toBe(0);
      expect(h.patchCount).toBe(0);
      expect(h.httpMethods).toEqual(['GET']);
      expect(h.emitted).toHaveLength(1);
      expect(h.emitted[0].type).toBe('AUTONOMOUS_RCA_FAMILY_DEDUPED');
      expect(h.emitted[0].payload).toMatchObject({
        canonicalAction: action,
        priorIssueNumber: 3278,
        rcaFamilyKey: expect.any(String),
      });
    });
  }

  it('rearms the *same* closed-completed issue, then dedupes its reopened recurrence', async () => {
    const h = hermeticLifecycle({ state: 'closed', reason: 'completed' });
    const first = await h.run();
    expect(first).toMatchObject({ candidates: 1, workOrders: 0, deduped: 1, blocked: 0 });
    expect(h.patchCount).toBe(1);
    expect(h.issue.number).toBe(3278);
    expect(h.issue.state).toBe('open');
    expect(h.issue.body.startsWith('## AUTO-RCA RECURRENCE REARM — AUTHORITATIVE')).toBe(true);
    expect(h.issue.body.match(/## AUTO-RCA RECURRENCE REARM — AUTHORITATIVE/g)).toHaveLength(1);
    expect(h.emitted[0].type).toBe('AUTONOMOUS_RCA_CANONICAL_REARMED');
    expect(h.emitted[0].payload.canonicalIssueNumber).toBe(3278);

    const second = await h.run();
    expect(second).toMatchObject({ candidates: 1, workOrders: 0, deduped: 1, blocked: 0 });
    expect(h.patchCount).toBe(1);
    expect(h.createAttempts).toBe(0);
    expect(h.httpMethods).toEqual(['GET', 'PATCH', 'GET']);
    expect(h.emitted[1].type).toBe('AUTONOMOUS_RCA_FAMILY_DEDUPED');
  });

  it('refreshes the leading recurrence evidence on a closed canonical issue without creating another issue', async () => {
    const h = hermeticLifecycle({ state: 'closed', reason: 'completed', priorRearmHash: 'stale-evidence-hash' });
    const first = await h.run();
    expect(first).toMatchObject({ candidates: 1, workOrders: 0, deduped: 1, blocked: 0 });
    expect(h.issue.number).toBe(3278);
    expect(h.issue.state).toBe('open');
    const freshHash = h.emitted[0].payload.evidenceHash;
    expect(h.issue.body.split('\n\n')[0]).toContain('EVIDENCE_HASH=' + freshHash);
    expect(h.issue.body).toContain('EVIDENCE_HASH=stale-evidence-hash');
    expect(h.issue.body.match(/## AUTO-RCA RECURRENCE REARM — AUTHORITATIVE/g)).toHaveLength(2);
    expect(h.patchCount).toBe(1);
    expect(h.createAttempts).toBe(0);
    await h.run();
    expect(h.patchCount).toBe(1);
    expect(h.createAttempts).toBe(0);
    expect(h.httpMethods).toEqual(['GET', 'PATCH', 'GET']);
  });

  it('preserves an already-current canonical recurrence header while reopening exactly once', async () => {
    const h = hermeticLifecycle({ state: 'closed', reason: 'completed', priorRearmHash: 'CURRENT' });
    const first = await h.run();
    expect(first).toMatchObject({ candidates: 1, workOrders: 0, deduped: 1, blocked: 0 });
    expect(h.patchCount).toBe(1);
    expect(h.createAttempts).toBe(0);
    expect(h.issue.body.match(/## AUTO-RCA RECURRENCE REARM — AUTHORITATIVE/g)).toHaveLength(1);
    const hash = h.emitted[0].payload.evidenceHash;
    expect(h.issue.body.split('\n\n')[0]).toContain('EVIDENCE_HASH=' + hash);
  });

  it('fails closed if missing history would otherwise materialize a new issue', async () => {
    const h = hermeticLifecycle({ hasPrior: false });
    const result = await h.run();
    expect(result).toMatchObject({ candidates: 1, workOrders: 0, deduped: 0, blocked: 1 });
    expect(h.createAttempts).toBe(1);
    expect(h.patchCount).toBe(0);
    expect(h.httpMethods).toEqual([]);
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0].type).toBe('AUTONOMOUS_RCA_MATERIALIZATION_BLOCKED');
    expect(h.emitted[0].payload.reason).toBe('RCA_INTEGRATION_NEW_WORK_ORDER_FORBIDDEN');
  });
});
