// GH-2054: Core's owner-authorized direct Paperclip install must use the same
// atomic, fenced NV06 lease as the authenticated PC Operator MCP route.
// This module is deliberately scoped to one existing Paperclip Work Order.
export const PAPERCLIP_DIRECT_SCOPE = 'TIGERIQ_PAPERCLIP_LAB_PC01_EXISTING_SANDBOX_20261018';
export const PAPERCLIP_NV06_RESOURCE = 'res:openclaw:operator-local:default:pc01';
const PAPERCLIP_BROKER_ACTION = 'paperclip_lab_broker_install';

export function paperclipBrokerNativeAccepted(receipt) {
  return receipt?.ok === true
    && receipt?.data?.installed === true
    && receipt.data.r07SourceVerified === true
    && typeof receipt.data.dockerVersion === 'string'
    && receipt.data.dockerVersion.trim().length > 0;
}

export async function executeFencedPaperclipBrokerInstall({
  job, db, execute, acquire, heartbeat, release, now = () => Date.now(),
}) {
  const meta = job?.objective_metadata || {};
  const action = meta.pcOperatorDirectAction;
  if (Number(meta.issueNumber) !== 2054
    || meta.resourceScope !== PAPERCLIP_DIRECT_SCOPE
    || meta.ownerDirect !== true
    || action?.action !== PAPERCLIP_BROKER_ACTION
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
        action: PAPERCLIP_BROKER_ACTION,
        targetStepId: 'R07',
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

    receipt = await execute({ action: PAPERCLIP_BROKER_ACTION });
    const stillOwned = await heartbeat(db, {
      resourceId: lease.resource_id, leaseToken: lease.lease_token, ttlMs: 600000,
    });
    if (leaseLost || !stillOwned) throw new Error('NV06_SHARED_LEASE_LOST');
    if (!paperclipBrokerNativeAccepted(receipt)) {
      throw new Error('NATIVE_BROKER_INSTALL_NOT_ACCEPTED');
    }
  } catch (error) {
    // Never forward raw lease exceptions, which may include a fencing token.
    failure = error instanceof Error && /^PAPERCLIP_CORE_DIRECT_|^NV06_SHARED_LEASE_|^NATIVE_BROKER_INSTALL_NOT_ACCEPTED$/.test(error.message)
      ? error.message
      : 'NV06_INSTALL_OR_LEASE_ERROR';
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
