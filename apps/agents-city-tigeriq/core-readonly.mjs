// TIGERIQ_AGENTS_CITY_ANIMAL_BRIDGE_V1 — read-only Core projection.
// Source: PC01 TigerIQ Core /api/work-orders. Never creates jobs, leases or status.
export const CORE_URL = 'http://127.0.0.1:8795/api/work-orders';
export const MAX_SOURCE_AGE_MS = 120_000;
const MAX_ITEMS = 2500;
const MAX_BODY_BYTES = 2_000_000;

const clean = (value, limit = 240) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';

function validIssueLink(value, number) {
  const canonical = 'https://github.com/newsdayads/tigeriq-ai-lab/issues/' + number;
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'https:' && url.hostname === 'github.com' &&
        url.pathname === '/newsdayads/tigeriq-ai-lab/issues/' + number &&
        !url.username && !url.password && !url.search && !url.hash) return canonical;
  } catch {}
  return canonical;
}

export function classifyDisplayRoom(item) {
  // Display grouping only; this is NOT a dispatch or an employee assignment.
  const scope = clean(item.resourceScope, 180).toUpperCase();
  const step = clean(item.currentStep, 120).toUpperCase();
  if (/(QA|REVIEW|VERIFY|TEST|CI_GATE|ACCEPTANCE)/.test(scope + ' ' + step)) return 'quality';
  if (/(CODING|ENGINEER|CODE|SOURCE|ANDROID|APP_|DEPLOY)/.test(scope)) return 'engineering';
  return 'coordination';
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const number = Number(raw.number);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 99999999) return null;
  if (raw.state !== 'open' && raw.state !== 'closed') return null;
  const title = clean(raw.title, 220);
  if (!title) return null;
  const currentStep = clean(raw.currentStep, 160);
  const scope = clean(raw.resourceScope, 160);
  const stepItems = Array.isArray(raw.progressSteps) ? raw.progressSteps : [];
  const doneVerified = raw.state === 'closed' &&
    raw.bucket === 'HOÀN THÀNH' &&
    ['DONE_ACCEPTED','DONE_VERIFIED'].includes(raw.completionSyncState) &&
    stepItems.length > 0 &&
    stepItems.every(step => step && step.checked === true &&
      Array.isArray(step.evidenceUrls) &&
      step.evidenceUrls.some(url => typeof url === 'string' && /^https:\/\//.test(url)));
  const item = {
    id: number,
    title,
    priority: ['P0','P1','P2','P3','P4','P5'].includes(raw.priority) ? raw.priority : 'UNKNOWN',
    state: doneVerified ? 'done_verified' : raw.state === 'closed' ? 'closed_unverified' : 'open',
    room: '',
    currentStep,
    nextAction: clean(raw.nextAction, 220),
    resourceScope: scope,
    link: validIssueLink(raw.html_url, number),
    // The Core /api/work-orders projection does not attest an active native
    // worker/lease: never infer a running employee or active work from a card.
    activeWorkerVerified: false,
    delegationEnabled: false,
    progress: null,
  };
  if (Number.isInteger(raw.progressTotal) && raw.progressTotal > 0 &&
      Number.isInteger(raw.progressCompleted) &&
      raw.progressCompleted >= 0 && raw.progressCompleted <= raw.progressTotal &&
      stepItems.length === raw.progressTotal &&
      stepItems.filter(step => step?.checked === true).length === raw.progressCompleted) {
    item.progress = {accepted: raw.progressCompleted, total: raw.progressTotal};
  }
  item.room = classifyDisplayRoom({resourceScope: scope, currentStep});
  return item;
}

export function normalizeCoreSnapshot(source, {now = Date.now()} = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      source.ok !== true || !source.sourceScope?.openComplete ||
      !source.sourceScope?.closedHistoryComplete || !Array.isArray(source.items) ||
      source.items.length > MAX_ITEMS) throw new Error('CORE_SOURCE_UNVERIFIED');

  const updatedMs = Date.parse(source.updatedAt);
  if (!Number.isFinite(updatedMs) || updatedMs > now + 10_000 ||
      now - updatedMs > MAX_SOURCE_AGE_MS) throw new Error('CORE_SOURCE_STALE');

  const unique = new Set();
  const items = [];
  for (const raw of source.items) {
    const item = normalizeItem(raw);
    if (!item || unique.has(item.id)) continue;
    unique.add(item.id);
    items.push(item);
  }
  items.sort((a,b) => a.id === b.id ? 0 : b.id - a.id);
  return {
    ok: true,
    schema: 'tigeriq/agents-city-readonly@1',
    source: 'TigerIQ Core /api/work-orders',
    verifiedAt: new Date(updatedMs).toISOString(),
    readOnly: true,
    dispatchEnabled: false,
    employeeBindingsVerified: false,
    rooms: [
      {id:'coordination', label:'Điều phối', animal:'tiger', items:items.filter(x => x.room === 'coordination')},
      {id:'engineering', label:'Kỹ thuật', animal:'fox', items:items.filter(x => x.room === 'engineering')},
      {id:'quality', label:'Kiểm thử', animal:'panda', items:items.filter(x => x.room === 'quality')},
    ],
    total: items.length,
    note: 'Phòng là nhóm hiển thị tham khảo; không xác nhận AI được giao việc.',
  };
}

export async function fetchCoreSnapshot({
  fetchImpl = fetch, now = Date.now(), url = CORE_URL, timeoutMs = 4000,
  attempts = 2, retryDelayMs = 150,
} = {}) {
  // Refuse arbitrary destinations/redirects: keep Core reads on loopback.
  if (url !== CORE_URL) throw new Error('CORE_ORIGIN_NOT_ALLOWED');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15_000)
    throw new Error('INVALID_TIMEOUT');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3)
    throw new Error('INVALID_ATTEMPTS');
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 1000)
    throw new Error('INVALID_RETRY_DELAY');

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        method:'GET', redirect:'error', cache:'no-store',
        headers:{accept:'application/json'},
        signal:AbortSignal.timeout(timeoutMs),
      });
    } catch {
      if (attempt < attempts) {
        if (retryDelayMs) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        continue;
      }
      throw new Error('CORE_HTTP_UNAVAILABLE');
    }

    if (!response || response.ok !== true || response.status !== 200) {
      if (attempt < attempts) {
        if (retryDelayMs) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        continue;
      }
      throw new Error('CORE_HTTP_UNAVAILABLE');
    }

    const length = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new Error('CORE_BODY_TOO_LARGE');
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new Error('CORE_BODY_TOO_LARGE');
    let parsed;
    try { parsed = JSON.parse(body); } catch { throw new Error('CORE_JSON_INVALID'); }
    return normalizeCoreSnapshot(parsed, {now});
  }

  throw new Error('CORE_HTTP_UNAVAILABLE');
}
