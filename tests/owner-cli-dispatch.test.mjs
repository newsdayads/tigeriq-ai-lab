import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchOwnerCliJob } from '../apps/tigeriq-core/owner-cli-dispatch.mjs';
import { codexQuotaSnapshot, antigravityQuotaSnapshots } from '../apps/tigeriq-core/owner-cli-quota-routing.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const now = '2026-11-22T01:00:00.000Z';
const nowMs = Date.parse(now);

function makeFakeDb() {
  const leases = new Map();
  const events = [];
  let seq = 1;
  const query = async (sql, params = []) => {
    const s = String(sql).trim().toLowerCase();
    if (s === 'begin' || s === 'commit' || s === 'rollback') return { rowCount: 0, rows: [] };
    if (s.startsWith('delete from tigeriq_ai_resource_leases where resource_id=$1 and lease_until<=now()')) {
      const row = leases.get(params[0]);
      if (row && Date.parse(row.lease_until) <= Date.now()) leases.delete(params[0]);
      return { rowCount: 0, rows: [] };
    }
    if (s.startsWith('insert into tigeriq_ai_resource_leases')) {
      const [resourceId, employeeId, lane, workId, role, leaseToken, ttlMs] = params;
      if (leases.has(resourceId)) return { rowCount: 0, rows: [] };
      const row = {
        resource_id: resourceId,
        employee_id: employeeId,
        lane,
        work_id: workId,
        role,
        lease_token: leaseToken,
        lease_until: new Date(Date.now() + Number(ttlMs)).toISOString(),
      };
      leases.set(resourceId, row);
      return { rowCount: 1, rows: [row] };
    }
    if (s.startsWith('select resource_id,employee_id,current_job_id')) return { rowCount: 0, rows: [] };
    if (s.startsWith('select * from tigeriq_ai_resource_leases where resource_id=$1 and lease_token=$2')) {
      const row = leases.get(params[0]);
      return row && row.lease_token === params[1] ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
    }
    if (s.startsWith('delete from tigeriq_ai_resource_leases where resource_id=$1 and lease_token=$2')) {
      const row = leases.get(params[0]);
      if (row && row.lease_token === params[1]) {
        leases.delete(params[0]);
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (s.includes('from tigeriq_events') && s.includes("idempotencykey")) {
      const key = params[0];
      const matched = events.filter((e) => e.data?.idempotencyKey === key).reverse().slice(0, 5);
      return { rowCount: matched.length, rows: matched };
    }
    return { rowCount: 0, rows: [] };
  };
  return {
    leases,
    events,
    query,
    connect: async () => ({ query, release: () => {} }),
    emitEvent: async (type, data) => {
      events.push({ seq: seq++, type, data });
    },
  };
}

function makeProbe({ agyAuth = true, codexAuth = true, geminiRemain = 1, claudeRemain = 1, codexUsed = 80, observedAt = now } = {}) {
  return {
    schema: 'TIGERIQ_OWNER_AI_QUOTA_V1',
    observedAt,
    antigravity: {
      authenticated: agyAuth,
      observedAt,
      snapshots: agyAuth
        ? antigravityQuotaSnapshots({
            status: 'SUCCESS',
            command: {
              name: 'usage',
              data: {
                groups: [
                  { name: 'Gemini Models', buckets: [{ remaining_fraction: geminiRemain, window: '5h' }] },
                  { name: 'Claude and GPT models', buckets: [{ remaining_fraction: claudeRemain, window: '5h' }] },
                ],
              },
            },
          }, { observedAt })
        : [],
      models: ['gemini-4-hydrogen-low', 'gemini-4-hydrogen-medium', 'gemini-3.8-flash-low', 'claude-sonnet-5-5-medium'],
    },
    codex: {
      authenticated: codexAuth,
      observedAt,
      snapshots: codexAuth
        ? [codexQuotaSnapshot({ rateLimits: { primary: { usedPercent: codexUsed, resetsAt: 1795293985 }, secondary: { usedPercent: 20, resetsAt: 1795837621 } } }, { observedAt })]
        : [],
      models: ['gpt-5.6-codex'],
    },
  };
}

describe('Owner CLI Core Dispatch E2E & Negative Gates', () => {
  it('dispatches end-to-end with exclusive lease, Antigravity free model, and acceptance receipt', async () => {
    const db = makeFakeDb();
    const res = await dispatchOwnerCliJob({
      db,
      job: { id: 'JOB-E2E-1', resourceScope: 'repo:tigeriq:gh5744', difficulty: 'LOW' },
      prompt: 'Return TIGERIQ_CANARY_OK',
      probeQuota: async () => makeProbe(),
      executeCli: async ({ provider, model }) => ({ output: `OK:${provider}:${model}` }),
      emitEvent: db.emitEvent,
      nowMs,
    });
    assert.equal(res.ok, true);
    assert.equal(res.accepted, true);
    assert.equal(res.provider, 'antigravity');
    assert.equal(res.model, 'gemini-4-hydrogen-low');
    assert.equal(db.leases.size, 0, 'lease must be released after completion');
    assert.ok(db.events.some((e) => e.type === 'OWNER_CLI_DISPATCH_STARTED'));
    assert.ok(db.events.some((e) => e.type === 'OWNER_CLI_DISPATCH_COMPLETED'));
  });

  it('accepts a verified quota snapshot collected AFTER job start, without accepting future spoofing', async () => {
    const db = makeFakeDb();
    const jobStartMs = Date.now() - 6000;
    const freshProbeAt = new Date(Date.now() - 100).toISOString();
    const good = await dispatchOwnerCliJob({
      db,
      job: { id: 'JOB-CLOCK-SKEW', resourceScope: 'repo:tigeriq:quota-clock' },
      prompt: 'Clock regression canary',
      probeQuota: async () => makeProbe({ observedAt: freshProbeAt }),
      executeCli: async ({ provider }) => ({ output: 'CLOCK_PASS:' + provider }),
      emitEvent: db.emitEvent,
      nowMs: jobStartMs,
    });
    assert.equal(good.ok, true, 'fresh observation must not be rejected for being later than job start');
    assert.equal(good.provider, 'antigravity');

    const spoof = await dispatchOwnerCliJob({
      db,
      job: { id: 'JOB-CLOCK-FUTURE', resourceScope: 'repo:tigeriq:quota-clock' },
      prompt: 'Clock spoof negative test',
      probeQuota: async () => makeProbe({ observedAt: new Date(Date.now() + 300000).toISOString() }),
      executeCli: async () => ({ output: 'MUST_NOT_RUN' }),
      emitEvent: db.emitEvent,
      nowMs: Date.now(),
    });
    assert.equal(spoof.ok, false);
    assert.equal(spoof.code, 'NO_VERIFIED_AUTHORIZED_QUOTA');
  });

  it('prevents duplicate dispatch for same idempotencyKey', async () => {
    const db = makeFakeDb();
    let calls = 0;
    const first = await dispatchOwnerCliJob({
      db,
      job: { id: 'JOB-DUP-1', resourceScope: 'repo:tigeriq:gh5744', idempotencyKey: 'idem-5744-1' },
      prompt: 'Run once',
      probeQuota: async () => makeProbe(),
      executeCli: async () => { calls++; return { output: 'DONE_ONCE' }; },
      emitEvent: db.emitEvent,
      nowMs,
    });
    assert.equal(first.ok, true);
    const second = await dispatchOwnerCliJob({
      db,
      job: { id: 'JOB-DUP-1', resourceScope: 'repo:tigeriq:gh5744', idempotencyKey: 'idem-5744-1' },
      prompt: 'Run once',
      probeQuota: async () => makeProbe(),
      executeCli: async () => { calls++; return { output: 'SHOULD_NOT_RUN' }; },
      emitEvent: db.emitEvent,
      nowMs,
    });
    assert.equal(second.ok, true);
    assert.equal(second.deduplicated, true);
    assert.equal(second.code, 'DUPLICATE_DISPATCH_PREVENTED');
    assert.equal(calls, 1);
  });

  it('does not spend a stronger pool on a Hydrogen disconnect and releases leases', async () => {
    const db = makeFakeDb();
    let attempt = 0;
    const res = await dispatchOwnerCliJob({
      db,
      job: { id: 'JOB-FAILOVER-1', resourceScope: 'repo:tigeriq:gh5744', difficulty: 'LOW' },
      prompt: 'Failover test',
      probeQuota: async () => makeProbe({ geminiRemain: 1, claudeRemain: 0.9 }),
      executeCli: async ({ group, model }) => {
        attempt++;
        if (attempt === 1) {
          const err = new Error('ECONNRESET');
          err.kind = 'disconnect';
          throw err;
        }
        return { output: `RECOVERED:${group}:${model}` };
      },
      emitEvent: db.emitEvent,
      nowMs,
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'ALL_ELIGIBLE_PROVIDERS_FAILED');
    assert.equal(attempt, 1);
    assert.equal(res.failures.length, 1);
    assert.equal(res.failures[0].kind, 'disconnect');
    assert.equal(db.leases.size, 0);
    assert.ok(db.events.some((e) => e.type === 'OWNER_CLI_DISPATCH_FAILOVER'));
  });

  it('fails closed on permission_denied without failover or bypass', async () => {
    const db = makeFakeDb();
    let calls = 0;
    const res = await dispatchOwnerCliJob({
      db,
      job: { id: 'JOB-PERM-1', resourceScope: 'repo:tigeriq:gh5744' },
      prompt: 'Denied test',
      probeQuota: async () => makeProbe(),
      executeCli: async () => {
        calls++;
        const err = new Error('Access is denied');
        err.kind = 'permission_denied';
        throw err;
      },
      emitEvent: db.emitEvent,
      nowMs,
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'PERMISSION_DENIED');
    assert.equal(res.rolledBack, true);
    assert.equal(calls, 1);
    assert.equal(db.leases.size, 0);
    assert.ok(db.events.some((e) => e.type === 'OWNER_CLI_DISPATCH_ROLLED_BACK'));
  });

  it('handles lease contention without spending a stronger model pool', async () => {
    const db = makeFakeDb();
    db.leases.set('res:owner-cli:antigravity:gemini-models', {
      resource_id: 'res:owner-cli:antigravity:gemini-models',
      lease_token: 'other-worker-token',
      lease_until: new Date(Date.now() + 60000).toISOString(),
    });
    const res = await dispatchOwnerCliJob({
      db,
      job: { id: 'JOB-CONTEND-1', resourceScope: 'repo:tigeriq:gh5744', difficulty: 'LOW' },
      prompt: 'Lease contention test',
      probeQuota: async () => makeProbe({ geminiRemain: 1, claudeRemain: 0.9 }),
      executeCli: async ({ model }) => ({ output: `OK:${model}` }),
      emitEvent: db.emitEvent,
      nowMs,
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'ALL_ELIGIBLE_PROVIDERS_FAILED');
    assert.ok(db.events.some((e) => e.type === 'OWNER_CLI_DISPATCH_LEASE_CONTENTION'));
    assert.ok(db.leases.has('res:owner-cli:antigravity:gemini-models'), 'other worker lease must remain untouched');
  });

  it('rejects exhausted quota and ungranted Codex, and rolls back when all fail', async () => {
    const db = makeFakeDb();
    const exhausted = await dispatchOwnerCliJob({
      db,
      job: { id: 'JOB-EXHAUST-1', resourceScope: 'repo:tigeriq:gh5744' },
      prompt: 'Exhausted test',
      probeQuota: async () => makeProbe({ geminiRemain: 0.02, claudeRemain: 0.01, codexUsed: 98 }),
      executeCli: async () => ({ output: 'NEVER' }),
      emitEvent: db.emitEvent,
      nowMs,
    });
    assert.equal(exhausted.ok, false);
    assert.equal(exhausted.code, 'NO_VERIFIED_AUTHORIZED_QUOTA');

    const badScope = await dispatchOwnerCliJob({
      db,
      job: {
        id: 'JOB-CODEX-BAD',
        resourceScope: 'repo:tigeriq:gh5744',
        codexGrant: { approved: true, jobId: 'OTHER-JOB', resourceScope: 'repo:tigeriq:gh5744' },
      },
      prompt: 'Bad grant',
      probeQuota: async () => makeProbe({ agyAuth: false }),
      emitEvent: db.emitEvent,
      nowMs,
    });
    assert.equal(badScope.ok, false);
    assert.equal(badScope.code, 'CODEX_GRANT_SCOPE_MISMATCH');

    const scopedCodex = await dispatchOwnerCliJob({
      db,
      job: {
        id: 'JOB-CODEX-OK',
        resourceScope: 'repo:tigeriq:gh5744',
        codexGrant: { approved: true, jobId: 'JOB-CODEX-OK', resourceScope: 'repo:tigeriq:gh5744' },
      },
      prompt: 'Scoped Codex OK',
      probeQuota: async () => makeProbe({ agyAuth: false, codexUsed: 80 }),
      executeCli: async ({ provider, model }) => ({ output: `${provider}:${model}:OK` }),
      emitEvent: db.emitEvent,
      nowMs,
    });
    assert.equal(scopedCodex.ok, true);
    assert.equal(scopedCodex.provider, 'codex');
  });

  it('verifies Core wires owner-cli-dispatch into existing runJob and HTTP endpoints', () => {
    const coreSrc = readFileSync(join(__dirname, '..', 'apps', 'tigeriq-core', 'core.mjs'), 'utf8');
    assert.match(coreSrc, /import\s+\{\s*dispatchOwnerCliJob,\s*probeOwnerCliQuota\s*\}\s+from\s+'\.\/owner-cli-dispatch\.mjs'/);
    assert.match(coreSrc, /j\.kind\s*===\s*'owner_cli_dispatch'/);
    assert.match(coreSrc, /\/api\/owner-cli\/quota/);
    assert.match(coreSrc, /\/api\/owner-cli\/dispatch/);
  });
});
