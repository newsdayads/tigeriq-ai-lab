// TigerIQ-owned RDC connector preflight. This does NOT install a native ChatGPT router.
// The caller supplies the exposed (authorized) connector links and binds all actual
// device actions through executeRdcWithPool. Never reuse a cached quota snapshot.
const VALID_LINK = /^link_[A-Za-z0-9_-]+$/;
const QUOTA_CODES = new Set(['QUOTA_EXHAUSTED', 'REMOTE_CALL_LIMIT_EXCEEDED']);
const PRE_EXECUTION_CODES = new Set(['PRE_EXECUTION_FAILURE', 'DEVICE_UNAVAILABLE']);

function unwrapWhoAmI(raw) {
  const value = typeof raw?.text === 'string' ? JSON.parse(raw.text) : raw?.result ?? raw;
  if (!value || typeof value !== 'object') throw new Error('RDC_ACCOUNT_INVALID');
  return value;
}

function readPc01(raw) {
  const value = typeof raw?.text === 'string' ? raw.text : raw?.result ?? raw;
  if (typeof value === 'string') {
    const match = value.match(/(?:^|\n)\s*\d+\.\s+PC01\s*\r?\n\s*Status:\s*(Online|Offline)\s*\r?\n\s*ID:\s*([a-f0-9-]{16,})/i);
    return match ? { online: match[1].toLowerCase() === 'online', deviceId: match[2] } : null;
  }
  const devices = Array.isArray(value?.devices) ? value.devices : [];
  const pc01 = devices.find(d => d?.name === 'PC01');
  return pc01 && typeof pc01.id === 'string'
    ? { online: String(pc01.status).toLowerCase() === 'online', deviceId: pc01.id }
    : null;
}

function report(link, reason, detail = {}) {
  return { rdcId: link.rdcId, link_id: link.link_id, reason, ...detail };
}

export async function inspectRdcPool({ links, whoAmI, listDevices }) {
  if (!Array.isArray(links) || typeof whoAmI !== 'function' || typeof listDevices !== 'function')
    throw new Error('RDC_INSPECTION_INPUT_INVALID');
  // The stable RDC01..RDC05 slot must bind exactly one exposed link.
  // Distinct link_id values with the same slot would make trace and
  // failover account identity ambiguous even when individual links are valid.
  if (new Set(links.map(a => a?.link_id)).size !== links.length ||
      new Set(links.map(a => a?.rdcId)).size !== links.length ||
      links.some(l => !VALID_LINK.test(String(l?.link_id || '')) ||
        !/^RDC0[1-5]$/.test(String(l?.rdcId || ''))))
    throw new Error('RDC_LINK_CONFIGURATION_INVALID');

  const audit = await Promise.all(links.map(async link => {
    try {
      const [identityRaw, devicesRaw] = await Promise.all([
        whoAmI({ link_id: link.link_id }),
        listDevices({ link_id: link.link_id })
      ]);
      const identity = unwrapWhoAmI(identityRaw);
      const pc01 = readPc01(devicesRaw);
      if (identity.role !== 'authenticated') return report(link, 'NOT_AUTHENTICATED');
      const quota = identity.remote_calls_left_pct;
      if (typeof quota !== 'number' || !Number.isFinite(quota) || quota < 0 || quota > 100)
        return report(link, 'QUOTA_UNVERIFIED');
      if (!pc01) return report(link, 'PC01_NOT_FOUND', { quota });
      if (!pc01.online) return report(link, 'PC01_OFFLINE', { quota });
      if (quota === 0) return report(link, 'QUOTA_EXHAUSTED', { quota });
      return report(link, 'ELIGIBLE', { quota, deviceId: pc01.deviceId });
    } catch {
      return report(link, 'INSPECTION_FAILED');
    }
  }));
  const eligible = audit.filter(a => a.reason === 'ELIGIBLE').sort((a, b) =>
    b.quota - a.quota || a.rdcId.localeCompare(b.rdcId));
  return { eligible, audit };
}

function preExecutionFailure(error) {
  const code = String(error?.code || '');
  if (QUOTA_CODES.has(code)) return true;
  // Never interpret authentication, permission, security or anti-abuse failures
  // as permission to switch accounts.
  if (PRE_EXECUTION_CODES.has(code) && error?.preExecution === true) return true;
  return false;
}

export async function executeRdcWithPool({
  links, whoAmI, listDevices, invoke, authorized, operation
}) {
  if (authorized !== true) throw Object.assign(new Error('RDC_OPERATION_NOT_AUTHORIZED'),
    { code: 'RDC_OPERATION_NOT_AUTHORIZED' });
  if (!['read', 'write'].includes(operation) || typeof invoke !== 'function')
    throw new Error('RDC_OPERATION_INVALID');

  const excluded = new Set();
  const attempts = [];
  // Every attempt rechecks the exposed pool. Never fall back to a 0%-quota link.
  while (excluded.size < links.length) {
    const { eligible, audit } = await inspectRdcPool({ links, whoAmI, listDevices });
    const selected = eligible.find(a => !excluded.has(a.link_id));
    if (!selected) {
      const e = Object.assign(new Error('RDC_POOL_UNAVAILABLE'),
        { code: 'RDC_POOL_UNAVAILABLE', audit, attempts });
      throw e;
    }
    try {
      const result = await invoke({ link_id: selected.link_id, deviceId: selected.deviceId });
      return { result, selected: {
        rdcId: selected.rdcId, link_id: selected.link_id,
        deviceId: selected.deviceId, quotaAtSelection: selected.quota
      }, attempts };
    } catch (error) {
      attempts.push({ rdcId: selected.rdcId, code: String(error?.code || 'UNKNOWN') });
      if (!preExecutionFailure(error)) {
        // Writes with ambiguous results must be inspected before any later retry.
        throw error;
      }
      excluded.add(selected.link_id);
    }
  }
  throw Object.assign(new Error('RDC_POOL_UNAVAILABLE'),
    { code: 'RDC_POOL_UNAVAILABLE', attempts });
}
