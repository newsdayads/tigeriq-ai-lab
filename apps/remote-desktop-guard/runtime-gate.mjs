import { readFile, rename, writeFile } from 'node:fs/promises';
import {
  DEFAULT_LEASE_PATH, authorizeRemoteCall, classifyTool
} from './policy.mjs';

const OWNER_LOGIN = 'newsdayads';
const OWNER_AUTH_MARKER = 'TIGERIQ_REMOTE_MUTATION_AUTH_V1';

function denial(reason, extra = {}) {
  return { ok:false, reason, ...extra };
}

function parseAuthRecord(body = '') {
  const lines = String(body).split(/\r?\n/).map((line)=>line.trim()).filter(Boolean);
  if (!lines.includes(OWNER_AUTH_MARKER)) return null;
  const record = {};
  for (const line of lines) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    record[line.slice(0,index)] = line.slice(index+1);
  }
  return record;
}

async function verifyOwnerAuthorizationRef(lease, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') return denial('OWNER_AUTH_VERIFY_UNAVAILABLE');
  try {
    const response = await fetchImpl(lease.authorizationUrl, {
      method:'GET',
      headers:{'Accept':'application/vnd.github+json','User-Agent':'TigerIQ-Remote-Guard/1'}
    });
    if (!response?.ok) return denial('OWNER_AUTH_VERIFY_HTTP_' + String(response?.status ?? 'ERR'));
    const data = await response.json();
    if (data?.user?.login !== OWNER_LOGIN) return denial('OWNER_AUTH_AUTHOR_MISMATCH');
    const record = parseAuthRecord(data?.body);
    if (!record || record.OWNER_AUTHORIZED !== 'true') return denial('OWNER_AUTH_RECORD_INVALID');
    if (record.LEASE_ID !== lease.leaseId) return denial('OWNER_AUTH_LEASE_MISMATCH');
    if (record.TOOL !== lease.tool) return denial('OWNER_AUTH_TOOL_MISMATCH');
    if (record.ARGS_SHA256 !== lease.argsSha256) return denial('OWNER_AUTH_ARGS_MISMATCH');
    if (record.ISSUED_AT !== lease.issuedAt || record.EXPIRES_AT !== lease.expiresAt) return denial('OWNER_AUTH_TIME_MISMATCH');
    return {ok:true,reason:'OWNER_AUTH_REF_VERIFIED'};
  } catch {
    return denial('OWNER_AUTH_VERIFY_FAILED');
  }
}

async function claimLease(leasePath, now) {
  const claimPath = leasePath + '.claim-' + process.pid + '-' + now;
  try {
    await rename(leasePath, claimPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok:false, reason:'OWNER_AUTH_REQUIRED' };
    return { ok:false, reason:'LEASE_CLAIM_FAILED' };
  }
  try {
    const raw = await readFile(claimPath,'utf8');
    return { ok:true, lease:JSON.parse(raw), claimPath };
  } catch {
    return { ok:false, reason:'LEASE_INVALID_OR_UNREADABLE', claimPath };
  }
}

async function persistClaimReceipt(claimPath, lease, decision, now) {
  if (!claimPath) return;
  const receipt = {
    ...lease,
    consumed:true,
    consumedAt:new Date(now).toISOString(),
    decision:decision.ok ? 'ALLOW_ONCE' : 'DENY_CONSUMED_FAIL_CLOSED',
    decisionReason:decision.reason
  };
  try {
    await writeFile(claimPath, JSON.stringify(receipt,null,2) + '\n', {encoding:'utf8',flag:'w'});
  } catch {
    // The lease was already atomically removed from the active path.
    // Receipt failure must never restore or re-open it.
  }
}

export async function enforceRemoteToolCall({
  tool,
  args = {},
  now = Date.now(),
  leasePath = DEFAULT_LEASE_PATH,
  fetchImpl = globalThis.fetch
} = {}) {
  const kind = classifyTool(tool);
  if (kind === 'READ_ONLY') return authorizeRemoteCall({tool,args,now});
  if (kind === 'UNKNOWN') return denial('UNKNOWN_TOOL_FAIL_CLOSED');
  if (tool === 'set_config_value') return denial('REMOTE_CONFIG_MUTATION_FORBIDDEN');

  // Atomic rename consumes the only active lease before dispatch. Parallel calls,
  // retries and process restarts cannot replay the same authorization.
  const claimed = await claimLease(leasePath,now);
  if (!claimed.ok) return denial(claimed.reason);

  const localDecision = authorizeRemoteCall({tool,args,lease:claimed.lease,now});
  if (!localDecision.ok) {
    await persistClaimReceipt(claimed.claimPath,claimed.lease,localDecision,now);
    return denial(localDecision.reason,{leaseId:claimed.lease?.leaseId});
  }

  const ownerDecision = await verifyOwnerAuthorizationRef(claimed.lease,{fetchImpl});
  const finalDecision = ownerDecision.ok
    ? {ok:true,reason:'OWNER_LEASE_VALID_SINGLE_USE'}
    : ownerDecision;
  await persistClaimReceipt(claimed.claimPath,claimed.lease,finalDecision,now);
  return finalDecision.ok
    ? { ok:true, reason:'OWNER_LEASE_VALID_SINGLE_USE', leaseId:claimed.lease.leaseId }
    : denial(finalDecision.reason,{leaseId:claimed.lease?.leaseId});
}

export function formatRemoteGuardDenial(decision) {
  return 'TIGERIQ_REMOTE_GUARD_DENY:' + (decision?.reason || 'FAIL_CLOSED');
}
