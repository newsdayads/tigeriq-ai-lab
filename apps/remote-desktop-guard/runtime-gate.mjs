import { readFile, rename, writeFile } from 'node:fs/promises';
import {
  DEFAULT_LEASE_PATH, authorizeRemoteCall, classifyTool
} from './policy.mjs';

function denial(reason, extra = {}) {
  return { ok:false, reason, ...extra };
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
  leasePath = DEFAULT_LEASE_PATH
} = {}) {
  const kind = classifyTool(tool);
  if (kind === 'READ_ONLY') return authorizeRemoteCall({tool,args,now});
  if (kind === 'UNKNOWN') return denial('UNKNOWN_TOOL_FAIL_CLOSED');
  if (tool === 'set_config_value') return denial('REMOTE_CONFIG_MUTATION_FORBIDDEN');

  // Atomic rename consumes the only active lease before dispatch. Parallel calls,
  // retries and process restarts cannot replay the same authorization.
  const claimed = await claimLease(leasePath,now);
  if (!claimed.ok) return denial(claimed.reason);

  const decision = authorizeRemoteCall({tool,args,lease:claimed.lease,now});
  await persistClaimReceipt(claimed.claimPath,claimed.lease,decision,now);
  return decision.ok
    ? { ok:true, reason:'OWNER_LEASE_VALID_SINGLE_USE', leaseId:claimed.lease.leaseId }
    : denial(decision.reason,{leaseId:claimed.lease?.leaseId});
}

export function formatRemoteGuardDenial(decision) {
  return 'TIGERIQ_REMOTE_GUARD_DENY:' + (decision?.reason || 'FAIL_CLOSED');
}
