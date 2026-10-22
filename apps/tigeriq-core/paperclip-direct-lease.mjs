// GH-2054: Core's owner-authorized direct Paperclip install must use the same
// atomic, fenced NV06 lease as the authenticated PC Operator MCP route.
// This module is deliberately scoped to one existing Paperclip Work Order.
export const PAPERCLIP_DIRECT_SCOPE = 'TIGERIQ_PAPERCLIP_LAB_PC01_EXISTING_SANDBOX_20261018';
export const PAPERCLIP_NV06_RESOURCE = 'res:openclaw:operator-local:default:pc01';
const PAPERCLIP_BROKER_ACTION = 'paperclip_lab_broker_install';
const PAPERCLIP_FENCED_HEALTH_ACTION = 'paperclip_lab_fenced_health';

export function paperclipBrokerNativeAccepted(receipt) {
  return receipt?.ok === true
    && receipt?.data?.installed === true
    && receipt.data.r07SourceVerified === true
    && typeof receipt.data.dockerVersion === 'string'
    && receipt.data.dockerVersion.trim().length > 0;
}

export function paperclipFencedHealthNativeAccepted(receipt) {
  const data=receipt?.data;
  return receipt?.ok===true && data?.ok===true
    && data?.container?.identityOk===true
    && data?.container?.portBindingOk===true
    && data?.database?.present===true
    && data?.database?.running===true
    && String(data?.database?.healthStatus||'').toLowerCase()==='healthy'
    && data?.broker?.ready===true
    && data?.broker?.sourceVerified===true
    && data?.broker?.wslKeepaliveRunning===true
    && Number.isInteger(data?.broker?.sessionId)
    && data.broker.sessionId>0
    && Number.isFinite(data?.broker?.ageMs)
    && data.broker.ageMs>=0 && data.broker.ageMs<=15000
    && data?.http?.appOk===true
    && data?.port?.reachable===true
    // R03 must not infer backup recoverability from /api/health backup.status=ok.
    // Native proof must have read and CRC-validated the actual hourly SQL dump.
    && data?.backup?.verified===true
    && data.backup.gzipCrcVerified===true
    && data.backup.pgDumpHeaderVerified===true
    && data.backup.pgDumpFooterVerified===true
    && data.backup.restoreTested===false
    && typeof data.backup.archiveSha256==='string'
    && /^[a-f0-9]{64}$/.test(data.backup.archiveSha256)
    && typeof data?.docker?.version==='string' && data.docker.version.trim().length>0;
}

async function executeFencedPaperclipAction({
  job, db, execute, acquire, heartbeat, release, now = () => Date.now(),
}) {
  const meta = job?.objective_metadata || {};
  const action = meta.pcOperatorDirectAction;
  const requestedAction=String(action?.action||'');
  const broker=requestedAction===PAPERCLIP_BROKER_ACTION;
  const fencedHealth=requestedAction===PAPERCLIP_FENCED_HEALTH_ACTION;
  if (Number(meta.issueNumber) !== 2054
    || meta.resourceScope !== PAPERCLIP_DIRECT_SCOPE
    || meta.ownerDirect !== true
    || (!broker && !fencedHealth)
    || !job?.id
    || !db
    || [execute, acquire, heartbeat, release].some(fn => typeof fn !== 'function')) {
    throw new Error('PAPERCLIP_CORE_DIRECT_SCOPE_NOT_AUTHORIZED');
  }

  let lease = null;
  let timer = null;
  let leaseLost = false;
  let released = false;
  let receipt = null;
  let failure = null;
  try {
    lease = await acquire(db, {
      employeeId: 'NV06',
      resourceId: PAPERCLIP_NV06_RESOURCE,
      workId: String(job.id),
      role: 'operator',
      lane: 'core_pc_direct',
      ttlMs: 600000,
      metadata: {
        workOrderId: 2054,
        resourceScope: PAPERCLIP_DIRECT_SCOPE,
        action: requestedAction,
        targetStepId: broker ? 'R07' : 'R03',
      },
    });
    if (!lease) throw new Error('NV06_SHARED_LEASE_BUSY');
    if (typeof lease.lease_token !== 'string' || !lease.lease_token
      || lease.resource_id !== PAPERCLIP_NV06_RESOURCE
      || lease.work_id !== String(job.id)
      || !(new Date(lease.lease_until).getTime() > now() + 30000)) {
      throw new Error('NV06_SHARED_LEASE_INVALID');
    }
    if (!await heartbeat(db, {
      resourceId: lease.resource_id, leaseToken: lease.lease_token, ttlMs: 600000,
    })) throw new Error('NV06_SHARED_LEASE_NOT_FENCED');

    timer = setInterval(() => {
      void heartbeat(db, {
        resourceId: lease.resource_id, leaseToken: lease.lease_token, ttlMs: 600000,
      }).then(ok => { if (!ok) leaseLost = true; })
        .catch(() => { leaseLost = true; });
    }, 30000);
    timer.unref?.();

    receipt = await execute({ action: requestedAction });
    const stillOwned = await heartbeat(db, {
      resourceId: lease.resource_id, leaseToken: lease.lease_token, ttlMs: 600000,
    });
    if (leaseLost || !stillOwned) throw new Error('NV06_SHARED_LEASE_LOST');
    if (!(broker ? paperclipBrokerNativeAccepted(receipt) : paperclipFencedHealthNativeAccepted(receipt))) {
      throw new Error(broker ? 'NATIVE_BROKER_INSTALL_NOT_ACCEPTED' : 'NATIVE_FENCED_HEALTH_NOT_ACCEPTED');
    }
  } catch (error) {
    // Never forward raw lease exceptions, which may include a fencing token.
    const safeReasons = new Set([
      'NV06_SHARED_LEASE_BUSY',
      'NV06_SHARED_LEASE_INVALID',
      'NV06_SHARED_LEASE_NOT_FENCED',
      'NV06_SHARED_LEASE_LOST',
      'NATIVE_BROKER_INSTALL_NOT_ACCEPTED',
      'NATIVE_FENCED_HEALTH_NOT_ACCEPTED',
    ]);
    failure = safeReasons.has(error?.message) ? error.message : 'NV06_INSTALL_OR_LEASE_ERROR';
  } finally {
    if (timer) clearInterval(timer);
    if (lease?.lease_token) {
      try {
        released = await release(db, {
          resourceId: lease.resource_id, leaseToken: lease.lease_token,
        }) === true;
      } catch {
        released = false;
      }
      if (!released) failure = 'NV06_SHARED_LEASE_RELEASE_UNVERIFIED';
    }
  }
  if (failure) throw new Error(failure);
  if (!released) throw new Error('NV06_SHARED_LEASE_RELEASE_UNVERIFIED');
  return { receipt, leaseVerified: true, leaseReleased: true };
}

export async function executeFencedPaperclipBrokerInstall(args) {
  if(args?.job?.objective_metadata?.pcOperatorDirectAction?.action!==PAPERCLIP_BROKER_ACTION)
    throw new Error('PAPERCLIP_CORE_DIRECT_SCOPE_NOT_AUTHORIZED');
  return executeFencedPaperclipAction(args);
}
export async function executeFencedPaperclipHealth(args) {
  if(args?.job?.objective_metadata?.pcOperatorDirectAction?.action!==PAPERCLIP_FENCED_HEALTH_ACTION)
    throw new Error('PAPERCLIP_CORE_DIRECT_SCOPE_NOT_AUTHORIZED');
  return executeFencedPaperclipAction(args);
}
