import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { liveOwnerCliQuotaProbe, locateCodexExe } from './owner-cli-quota-probe.mjs';
import { chooseOwnerCodingRoute } from './owner-cli-quota-routing.mjs';
import { releaseSharedResourceLease } from './shared-resource-lease.mjs';

const LOCAL = process.env.LOCALAPPDATA || '';
const DEFAULT_AGY_EXE = join(LOCAL, 'agy', 'bin', 'agy.exe');
const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 180000;
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;

const NON_RETRYABLE_KINDS = new Set([
  'permission_denied',
  'auth_required',
  'scope_denied',
  'invalid_input',
]);

function clampTimeout(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(n)));
}

export function classifyCliFailure(error) {
  if (error?.kind && typeof error.kind === 'string') return error.kind;
  const msg = String(error?.message || error || '').toLowerCase();
  if (msg.includes('permission') || msg.includes('access is denied') || msg.includes('forbidden')) return 'permission_denied';
  if (msg.includes('auth') || msg.includes('login') || msg.includes('unauthorized')) return 'auth_required';
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('abort')) return 'timeout';
  if (msg.includes('rate_limit') || msg.includes('quota') || msg.includes('429')) return 'quota_exhausted';
  if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('disconnect') || msg.includes('network')) return 'disconnect';
  return 'cli_exit';
}

function spawnBoundedCli(exe, args, { timeoutMs = DEFAULT_TIMEOUT_MS, maxOutput = 262144 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => {
      const err = new Error('CLI_TIMEOUT');
      err.kind = 'timeout';
      finish(err);
    }, timeoutMs);
    child.on('error', (err) => {
      err.kind = classifyCliFailure(err);
      finish(err);
    });
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.length > maxOutput) {
        const err = new Error('CLI_OUTPUT_LIMIT');
        err.kind = 'cli_exit';
        finish(err);
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 16384) stderr += String(chunk);
    });
    child.on('close', (code) => {
      if (code === 0) return finish(null, { stdout: stdout.trim(), stderr: stderr.trim() });
      const err = new Error(`CLI_EXIT_${code}${stderr ? ': ' + stderr.slice(0, 240) : ''}`);
      err.kind = classifyCliFailure(err);
      finish(err);
    });
  });
}

export async function defaultExecuteOwnerCli({ provider, model, prompt, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const boundedMs = clampTimeout(timeoutMs);
  if (provider === 'antigravity') {
    const timeoutSec = Math.max(5, Math.ceil(boundedMs / 1000));
    const { stdout } = await spawnBoundedCli(
      DEFAULT_AGY_EXE,
      ['-p', String(prompt || ''), '--model', String(model || ''), '--mode', 'plan', '--output-format', 'json', '--print-timeout', `${timeoutSec}s`],
      { timeoutMs: boundedMs },
    );
    return { output: stdout };
  }
  if (provider === 'codex') {
    const exe = await locateCodexExe();
    const { stdout } = await spawnBoundedCli(
      exe,
      ['exec', '--model', String(model || ''), String(prompt || '')],
      { timeoutMs: boundedMs },
    );
    return { output: stdout };
  }
  const err = new Error(`UNSUPPORTED_PROVIDER_${provider}`);
  err.kind = 'invalid_input';
  throw err;
}

export async function acquireOwnerCliLease(db, {
  resourceId,
  employeeId,
  workId,
  lane = 'owner_cli_dispatch',
  role = 'coding',
  ttlMs = DEFAULT_LEASE_TTL_MS,
  metadata = {},
} = {}) {
  if (!db) throw new Error('OWNER_CLI_LEASE_DB_REQUIRED');
  const client = await db.connect();
  const token = randomUUID();
  const ttl = Math.max(30000, Math.min(15 * 60 * 1000, Number(ttlMs) || DEFAULT_LEASE_TTL_MS));
  try {
    await client.query('begin');
    await client.query('delete from tigeriq_ai_resource_leases where resource_id=$1 and lease_until<=now()', [resourceId]);
    const inserted = await client.query(
      `insert into tigeriq_ai_resource_leases(resource_id,employee_id,lane,work_id,role,lease_token,lease_until,heartbeat_at,metadata,updated_at)
       values($1,$2,$3,$4,$5,$6,now()+($7::bigint*interval '1 millisecond'),now(),$8::jsonb,now())
       on conflict(resource_id) do nothing
       returning resource_id,employee_id,lane,work_id,role,lease_token,lease_until`,
      [resourceId, employeeId, lane, workId, role, token, ttl, JSON.stringify(metadata || {})],
    );
    await client.query('commit');
    return inserted.rows[0] || null;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function checkDuplicateDispatch(db, idempotencyKey) {
  if (!db || !idempotencyKey) return null;
  const q = await db.query(
    `select type, data from tigeriq_events
     where type in ('OWNER_CLI_DISPATCH_COMPLETED','OWNER_CLI_DISPATCH_STARTED','OWNER_CLI_DISPATCH_FAILED','OWNER_CLI_DISPATCH_ROLLED_BACK')
       and data->>'idempotencyKey' = $1
     order by seq desc limit 5`,
    [idempotencyKey],
  );
  const rows = q.rows || [];
  const completed = rows.find((r) => r.type === 'OWNER_CLI_DISPATCH_COMPLETED');
  if (completed) return { state: 'completed', receipt: completed.data?.receipt || completed.data };
  const latest = rows[0];
  if (latest?.type === 'OWNER_CLI_DISPATCH_STARTED') return { state: 'in_progress', data: latest.data };
  return null;
}

export function probeResultToRoutingInputs(probe = {}) {
  const agy = probe?.antigravity || {};
  const codex = probe?.codex || {};
  const snapshots = [
    ...(Array.isArray(agy.snapshots) ? agy.snapshots : []),
    ...(Array.isArray(codex.snapshots) ? codex.snapshots : []),
  ];
  return {
    snapshots,
    antigravityModels: Array.isArray(agy.models) ? agy.models : [],
    codexModels: Array.isArray(codex.models) ? codex.models : [],
    auth: {
      antigravity: agy.authenticated === true,
      codex: codex.authenticated === true,
    },
  };
}

export async function probeOwnerCliQuota({ probeFn = liveOwnerCliQuotaProbe } = {}) {
  return probeFn();
}

export async function dispatchOwnerCliJob({
  db,
  job = {},
  prompt = '',
  probeQuota = liveOwnerCliQuotaProbe,
  executeCli = defaultExecuteOwnerCli,
  emitEvent = async () => {},
  nowMs = Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  leaseTtlMs = DEFAULT_LEASE_TTL_MS,
  maxFailovers = 4,
} = {}) {
  const jobId = String(job.id || '').trim();
  const resourceScope = String(job.resourceScope || '').trim();
  const priority = String(job.priority || 'P1').trim().toUpperCase();
  if (!jobId || !resourceScope || priority === 'P0') {
    return { ok: false, accepted: false, code: 'JOB_SCOPE_REQUIRED', failures: [] };
  }
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    return { ok: false, accepted: false, code: 'PROMPT_REQUIRED', failures: [] };
  }
  if (job.codexGrant && (job.codexGrant.jobId !== jobId || job.codexGrant.resourceScope !== resourceScope)) {
    await emitEvent('OWNER_CLI_DISPATCH_SCOPE_DENIED', { jobId, resourceScope, reason: 'CODEX_GRANT_SCOPE_MISMATCH' });
    return { ok: false, accepted: false, code: 'CODEX_GRANT_SCOPE_MISMATCH', failures: [] };
  }

  const idempotencyKey = String(job.idempotencyKey || `${jobId}:${resourceScope}`);
  const dup = await checkDuplicateDispatch(db, idempotencyKey);
  if (dup?.state === 'completed') {
    return { ok: true, accepted: true, deduplicated: true, code: 'DUPLICATE_DISPATCH_PREVENTED', receipt: dup.receipt };
  }
  if (dup?.state === 'in_progress') {
    return { ok: false, accepted: false, deduplicated: true, code: 'DISPATCH_IN_PROGRESS', failures: [] };
  }

  let probe;
  try {
    probe = await probeQuota();
  } catch (err) {
    const code = 'QUOTA_PROBE_FAILED';
    await emitEvent('OWNER_CLI_DISPATCH_FAILED', { jobId, idempotencyKey, code, error: String(err?.message || err) });
    return { ok: false, accepted: false, code, failures: [{ kind: classifyCliFailure(err), message: String(err?.message || err) }] };
  }

  const routingInputs = probeResultToRoutingInputs(probe);
  let remainingSnapshots = [...routingInputs.snapshots];
  const failures = [];
  const boundedTimeout = clampTimeout(timeoutMs);

  for (let attempt = 0; attempt < maxFailovers; attempt++) {
    const decision = chooseOwnerCodingRoute({
      job: { ...job, id: jobId, resourceScope, priority },
      snapshots: remainingSnapshots,
      antigravityModels: routingInputs.antigravityModels,
      codexModels: routingInputs.codexModels,
      auth: routingInputs.auth,
      nowMs,
    });

    if (!decision.chosen) {
      const code = failures.length ? 'ALL_ELIGIBLE_PROVIDERS_FAILED' : decision.code;
      if (failures.length) {
        await emitEvent('OWNER_CLI_DISPATCH_ROLLED_BACK', { jobId, idempotencyKey, reason: code, failures });
      }
      await emitEvent('OWNER_CLI_DISPATCH_FAILED', { jobId, idempotencyKey, code, failures });
      return { ok: false, accepted: false, code, rolledBack: failures.length > 0, failures };
    }

    const chosen = decision.chosen;
    const employeeId = chosen.provider === 'codex' ? 'CODEX' : 'NV07';
    const resourceId = chosen.provider === 'codex'
      ? 'res:owner-cli:codex'
      : `res:owner-cli:antigravity:${String(chosen.group || 'default').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const lease = await acquireOwnerCliLease(db, {
      resourceId,
      employeeId,
      workId: jobId,
      ttlMs: leaseTtlMs,
      metadata: { idempotencyKey, provider: chosen.provider, model: chosen.model, resourceScope },
    });

    if (!lease) {
      failures.push({ provider: chosen.provider, model: chosen.model, group: chosen.group || null, kind: 'lease_contention', code: 'RESOURCE_LEASE_CONTENTION' });
      await emitEvent('OWNER_CLI_DISPATCH_LEASE_CONTENTION', { jobId, idempotencyKey, resourceId, provider: chosen.provider, model: chosen.model });
      remainingSnapshots = remainingSnapshots.filter((s) => !(s.provider === chosen.provider && (chosen.group ? s.group === chosen.group : true)));
      continue;
    }

    const startedAt = Date.now();
    await emitEvent('OWNER_CLI_DISPATCH_STARTED', {
      jobId,
      idempotencyKey,
      resourceId,
      employeeId,
      provider: chosen.provider,
      model: chosen.model,
      group: chosen.group || null,
      leaseToken: lease.lease_token,
      attempt: attempt + 1,
    });

    try {
      const execResult = await executeCli({
        provider: chosen.provider,
        model: chosen.model,
        prompt: cleanPrompt,
        job: { ...job, id: jobId, resourceScope, priority },
        timeoutMs: boundedTimeout,
      });
      const output = String(execResult?.output ?? execResult?.text ?? '').trim();
      if (!output) {
        const emptyErr = new Error('EMPTY_CLI_OUTPUT');
        emptyErr.kind = 'cli_exit';
        throw emptyErr;
      }
      const latencyMs = Math.max(0, Date.now() - startedAt);
      const receipt = {
        schema: 'TIGERIQ_OWNER_CLI_RECEIPT_V1',
        ok: true,
        accepted: true,
        jobId,
        resourceScope,
        idempotencyKey,
        provider: chosen.provider,
        model: chosen.model,
        group: chosen.group || null,
        remainingFraction: chosen.remainingFraction,
        latencyMs,
        output,
        failures,
        leaseToken: lease.lease_token,
        observedAt: probe.observedAt || null,
        completedAt: new Date().toISOString(),
      };
      await emitEvent('OWNER_CLI_DISPATCH_COMPLETED', { jobId, idempotencyKey, receipt });
      return receipt;
    } catch (err) {
      const kind = classifyCliFailure(err);
      const message = String(err?.message || err);
      failures.push({ provider: chosen.provider, model: chosen.model, group: chosen.group || null, kind, message });

      if (NON_RETRYABLE_KINDS.has(kind)) {
        await emitEvent('OWNER_CLI_DISPATCH_ROLLED_BACK', { jobId, idempotencyKey, reason: kind, message, failures });
        await emitEvent('OWNER_CLI_DISPATCH_FAILED', { jobId, idempotencyKey, code: kind.toUpperCase(), kind, failures });
        return { ok: false, accepted: false, code: kind.toUpperCase(), kind, rolledBack: true, failures };
      }

      await emitEvent('OWNER_CLI_DISPATCH_FAILOVER', {
        jobId,
        idempotencyKey,
        fromProvider: chosen.provider,
        fromModel: chosen.model,
        fromGroup: chosen.group || null,
        kind,
        message,
      });
      remainingSnapshots = remainingSnapshots.filter((s) => !(s.provider === chosen.provider && (chosen.group ? s.group === chosen.group : true)));
    } finally {
      await releaseSharedResourceLease(db, { resourceId, leaseToken: lease.lease_token }).catch(() => {});
    }
  }

  await emitEvent('OWNER_CLI_DISPATCH_ROLLED_BACK', { jobId, idempotencyKey, reason: 'ALL_ELIGIBLE_PROVIDERS_FAILED', failures });
  await emitEvent('OWNER_CLI_DISPATCH_FAILED', { jobId, idempotencyKey, code: 'ALL_ELIGIBLE_PROVIDERS_FAILED', failures });
  return { ok: false, accepted: false, code: 'ALL_ELIGIBLE_PROVIDERS_FAILED', rolledBack: true, failures };
}
