import { OWNER_STATUS_LABELS } from './owner-facing-vietnamese.mjs';
// One-way metadata adapter. No scheduler, token discovery, issue creation or Core mutation.
export const TARGET = Object.freeze({
  url: 'https://github.com/users/newsdayads/projects/1',
  owner: 'newsdayads', number: 1, title: 'TIGERIQ — MASTER PORTFOLIO',
});
export const PROJECTS = Object.freeze(['TigerIQ AI', 'TigerIQ News / Media', 'Paperclip vNext', 'Revenue Lab', 'TigerIQ Driver', 'DeXCam Personal', 'TigerIQ Coin']);
export const SUBPROJECTS = Object.freeze(['Nền tảng TigerIQ — Core, AI, API', 'TigerIQ Mobile Worker', 'TigerIQ Live', 'Workflow Lab', 'App Chrome', 'DeX Shot', 'DeXCam Personal', 'derophone', 'derophone_BK', 'derobizfly', 'zephyr']);
const REPOS = new Set(['tigeriq-ai-lab', 'tigeriq-media', 'tigeriq-media-content', 'drivetrack', 'derophone', 'derophone_BK', 'derobizfly', 'zephyr']);
const STATES = Object.freeze({ OPEN: 'CHƯA XÁC MINH', READY: 'CHỜ', QUEUED: 'CHỜ', RUNNING: 'ĐANG XỬ LÝ', WORKING: 'ĐANG XỬ LÝ', REVIEW: 'RÀ SOÁT', DONE: 'HOÀN TẤT', BLOCKED: 'BỊ CHẶN', OWNER_GATE: 'BỊ CHẶN', EXTERNAL_WAIT: 'CHỜ' });
const STATUS_ALIASES = Object.freeze({ PASS: 'DONE', COMPLETED: 'DONE', WAITING: 'QUEUED', WAIT_RESOURCE: 'QUEUED', PENDING: 'QUEUED', EXTERNAL_WAIT: 'EXTERNAL_WAIT', VERIFY: 'REVIEW', FAILED: 'BLOCKED', ERROR: 'BLOCKED', OWNER_APPROVAL_REQUIRED: 'OWNER_GATE', READY_FOR_OWNER_APPROVAL: 'OWNER_GATE' });
export function normalizeCoreStatus(value) {
 const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
 const code = Object.keys(OWNER_STATUS_LABELS).find(key => OWNER_STATUS_LABELS[key].toUpperCase() === raw) || raw;
 return STATUS_ALIASES[code] || code;
}
const BLOCKERS = Object.freeze({ OWNER_GATE: 'Cần Owner', AUTH_REQUIRED: 'Cần xác thực', EXTERNAL_WAIT: 'Chờ bên ngoài', DEPENDENCY: 'Chờ phụ thuộc', NONE: '' });
const FIELDS = new Set(['PROJECT', 'SUBPROJECT', 'Status', 'AI OWNER', 'TARGET DATE', 'BLOCKER', 'EVIDENCE']);
const INTERNAL_ERRORS = new WeakMap();
function fail(code) { const error = new Error(code); INTERNAL_ERRORS.set(error, code); throw error; }
export function identity(url) {
  if (typeof url !== 'string') return null;
  const m = /^https:\/\/github\.com\/newsdayads\/([^/?#]+)\/(issues|pull)\/([1-9]\d*)$/.exec(url);
  if (!m || !REPOS.has(m[1])) return null;
  return { key: 'newsdayads/' + m[1] + '/' + m[2] + '/' + m[3], repository: 'newsdayads/' + m[1], number: Number(m[3]), url };
}
function evidence(url) {
  if (typeof url !== 'string') return null;
  const m = /^https:\/\/github\.com\/newsdayads\/([^/?#]+)\/(?:issues\/[1-9]\d*|pull\/[1-9]\d*|actions\/runs\/[1-9]\d*|commit\/[a-f0-9]{40})$/.exec(url);
  return m && REPOS.has(m[1]) ? url : null;
}
function checkSnapshot(snapshot, now) {
  // verified is an assertion by a trusted in-process Core caller, never by a request body.
  if (snapshot?.schema !== 'tigeriq.core.portfolio-sync.v1' || snapshot.source !== 'tigeriq-core' || snapshot.origin !== 'core' || snapshot.verified !== true) fail('UNVERIFIED_CORE_SOURCE');
  const age = now - Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(age) || age < 0 || age > 120000 || !Array.isArray(snapshot.items) || snapshot.items.length > 1000) fail('STALE_OR_INVALID_CORE_SNAPSHOT');
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function planSync(snapshot, inventory, { now = Date.now(), receipts = {} } = {}) {
  checkSnapshot(snapshot, now);
  if (inventory?.url !== TARGET.url || inventory.title !== TARGET.title || inventory.public !== false || !inventory.id || !Array.isArray(inventory.items)) fail('TARGET_MISMATCH');
  const mapped = new Map();
  for (const item of inventory.items) {
    const ident = identity(item.content?.url);
    if (!ident) continue;
    if (item.content.repository !== ident.repository || item.content.number !== ident.number || !item.content.id || !item.id) fail('INVALID_PROJECT_ITEM');
    if (mapped.has(ident.key)) fail('DUPLICATE_PROJECT_ITEM');
    mapped.set(ident.key, item);
  }
  const seen = new Map(), updates = [], skipped = [];
  const priorities = new Map();
  for (const row of snapshot.items) {
    const key = identity(row.url)?.key;
    if (key && priorities.has(key) && priorities.get(key) !== row.priority) fail('CONFLICTING_CORE_PRIORITY');
    if (key) priorities.set(key, row.priority);
  }
  for (const row of snapshot.items) {
    const ident = identity(row.url);
    if (!ident || row.repository !== ident.repository || row.number !== ident.number || !row.contentId) fail('INVALID_CORE_IDENTITY');
    // Explicitly excluded ride data; no raw title/body/comment/log is ever inspected or emitted.
    if (ident.repository === 'newsdayads/drivetrack' && ident.number === 366) { skipped.push({ key: ident.key, reason: 'SENSITIVE_EXCLUDED' }); continue; }
    if (!/^P[0-5]$/.test(row.priority || '')) { skipped.push({ key: ident.key, reason: 'UNVERIFIED_PRIORITY' }); continue; }
    if (!PROJECTS.includes(row.project) || (row.subproject && !SUBPROJECTS.includes(row.subproject))) fail('UNKNOWN_PROJECT_MAPPING');
    const values = { PROJECT: row.project, Status: row.runtimeVerified === true ? (STATES[normalizeCoreStatus(row.status)] || 'CHƯA XÁC MINH') : 'CHƯA XÁC MINH' };
    if (row.subproject) values.SUBPROJECT = row.subproject;
    if (typeof row.aiOwner === 'string' && /^(?:NV\d{2}|VY|CODEX_[A-Z0-9_]{1,40})$/.test(row.aiOwner) && snapshot.registeredAiOwners?.includes(row.aiOwner)) values['AI OWNER'] = row.aiOwner;
    if (row.targetDate && validDate(row.targetDate)) values['TARGET DATE'] = row.targetDate;
    if (Object.hasOwn(BLOCKERS, row.blockerCode)) values.BLOCKER = BLOCKERS[row.blockerCode];
    const safeEvidence = evidence(row.evidenceUrl);
    if (safeEvidence) values.EVIDENCE = safeEvidence;
    if (row.priority === 'P0') for (const name of Object.keys(values)) if (!['Status', 'BLOCKER', 'EVIDENCE'].includes(name)) delete values[name];
    const fingerprint = JSON.stringify({ contentId: row.contentId, values });
    if (seen.has(ident.key)) { if (seen.get(ident.key) !== fingerprint) fail('CONFLICTING_CORE_DUPLICATE'); continue; }
    seen.set(ident.key, fingerprint);
    const item = mapped.get(ident.key);
    if (!item) { skipped.push({ key: ident.key, reason: 'EXISTING_ITEM_REQUIRED' }); continue; }
    if (item.content.id !== row.contentId) fail('CONTENT_ID_MISMATCH');
    if (receipts[ident.key] === fingerprint) continue;
    updates.push({ key: ident.key, itemId: item.id, values, fingerprint });
  }
  return { projectId: inventory.id, generatedAt: snapshot.generatedAt, updates, skipped };
}
const QUERY = `query($owner:String!,$number:Int!,$after:String){user(login:$owner){projectV2(number:$number){id url title public viewerCanUpdate fields(first:100){nodes{... on ProjectV2Field{id name dataType} ... on ProjectV2SingleSelectField{id name options{id name}}}pageInfo{hasNextPage}}items(first:100,after:$after){nodes{id content{... on Issue{id number url repository{nameWithOwner}} ... on PullRequest{id number url repository{nameWithOwner}}}}pageInfo{hasNextPage endCursor}}}}}`;
const MUTATION = `mutation($input:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}`;
export async function syncProjects({ snapshot, token, mode = 'dry-run', fetchImpl = globalThis.fetch, now = () => Date.now(), receipts = {} } = {}) {
  try {
    checkSnapshot(snapshot, now());
    if (!['dry-run', 'write'].includes(mode)) fail('INVALID_MODE');
    if (!token || typeof token !== 'string') fail('PROJECT_AUTH_REQUIRED');
    let writable = true;
    const request = async (query, variables) => {
      const response = await fetchImpl('https://api.github.com/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }), redirect: 'error' });
      const scopes = (response.headers.get('x-oauth-scopes') || '').split(',').map(x => x.trim());
      if (!scopes.includes('project')) writable = false;
      if (!response.ok) fail('PROJECT_API_DENIED');
      const payload = await response.json();
      if (payload.errors || !payload.data) fail('PROJECT_API_ERROR');
      return payload.data;
    };
    let project, after = null, items = [];
    for (let page = 0; page < 10; page++) {
      const data = await request(QUERY, { owner: TARGET.owner, number: TARGET.number, after });
      const current = data.user?.projectV2;
      if (!current || current.url !== TARGET.url || current.public !== false || current.title !== TARGET.title || current.fields.pageInfo.hasNextPage) fail('TARGET_OR_SCHEMA_MISMATCH');
      if (project && project.id !== current.id) fail('TARGET_CHANGED');
      project = current;
      if (!current.viewerCanUpdate) writable = false;
      items.push(...current.items.nodes.map(item => ({ id: item.id, content: item.content && { ...item.content, repository: item.content.repository.nameWithOwner } })));
      if (!current.items.pageInfo.hasNextPage) break;
      after = current.items.pageInfo.endCursor;
      if (!after || page === 9) fail('INCOMPLETE_PROJECT_INVENTORY');
    }
    const plan = planSync(snapshot, { ...project, items }, { now: now(), receipts });
    // Resolve every patch before writing; never create fields/options/items or assign an issue.
    const patches = [];
    for (const update of plan.updates) for (const [name, value] of Object.entries(update.values)) {
      if (!FIELDS.has(name)) fail('FIELD_NOT_ALLOWED');
      const fields = project.fields.nodes.filter(x => x.name === name);
      if (fields.length !== 1) fail('FIELD_SCHEMA_MISMATCH');
      const field = fields[0];
      let encoded;
      if (['PROJECT', 'SUBPROJECT', 'Status'].includes(name)) {
        const options = field.options?.filter(x => x.name === value) || [];
        if (options.length !== 1) fail('OPTION_SCHEMA_MISMATCH');
        encoded = { singleSelectOptionId: options[0].id };
      } else if (name === 'TARGET DATE') {
        if (field.dataType !== 'DATE') fail('FIELD_TYPE_MISMATCH');
        encoded = { date: value };
      } else {
        if (field.dataType !== 'TEXT') fail('FIELD_TYPE_MISMATCH');
        encoded = { text: value };
      }
      patches.push({ projectId: plan.projectId, itemId: update.itemId, fieldId: field.id, value: encoded });
    }
    if (mode === 'dry-run') return { ok: true, mode, writeAuthorized: writable, plan, patchCount: patches.length, applied: 0 };
    if (!writable) fail('PROJECT_WRITE_SCOPE_UNVERIFIED');
    if (patches.length > 100) fail('WRITE_BATCH_TOO_LARGE');
    let applied = 0;
    for (const input of patches) {
      checkSnapshot(snapshot, now());
      // Recheck target privacy and permission before each mutation; no retry on partial failure.
      const current = (await request(QUERY, { owner: TARGET.owner, number: TARGET.number, after: null })).user?.projectV2;
      if (!writable || current?.id !== plan.projectId || current.url !== TARGET.url || current.public !== false || current.title !== TARGET.title || !current.viewerCanUpdate) fail('WRITE_AUTH_CHANGED');
      await request(MUTATION, { input });
      applied++;
    }
    return { ok: true, mode, applied, receipts: Object.fromEntries(plan.updates.map(x => [x.key, x.fingerprint])) };
  } catch (error) {
    // Never return provider errors, request bodies, token, or arbitrary Core text.
    const reason = (error && INTERNAL_ERRORS.get(error)) || 'SYNC_FAILED_CLOSED';
    return { ok: false, mode, reason, retry: false };
  }
}

export const CORE_STATUS_URL = 'https://tigeriq-ai-lab.vercel.app/api/live-status';
const LIVE_PROJECT_MAP = Object.freeze({
 'tigeriq-platform': ['TigerIQ AI', 'Nền tảng TigerIQ — Core, AI, API'],
 'tigeriq-mobile-worker': ['TigerIQ AI', 'TigerIQ Mobile Worker'],
 'tigeriq-live': ['TigerIQ AI', 'TigerIQ Live'],
 'tigeriq-workflow-lab': ['TigerIQ AI', 'Workflow Lab'],
 'tigeriq-app-chrome': ['TigerIQ AI', 'App Chrome'],
 'tigeriq-news': ['TigerIQ News / Media', null],
 'paperclip-vnext': ['Paperclip vNext', null],
 'revenue-lab': ['Revenue Lab', null],
 'tigeriq-driver': ['TigerIQ Driver', null],
 'dexcam-personal': ['DeXCam Personal', 'DeXCam Personal'],
 'tigeriq-dexcam-personal': ['DeXCam Personal', 'DeXCam Personal'],
 'tigeriq-coin': ['TigerIQ Coin', null],
});
export function snapshotFromLiveStatus(payload, { endpoint, transportVerified = false, inventory, registeredAiOwners = [], now = Date.now() } = {}) {
 // The trusted caller verifies HTTPS endpoint/provenance; this function is not an HTTP input handler.
 if (!transportVerified || endpoint !== CORE_STATUS_URL || payload?.ok !== true || payload.liveConnected !== true || payload.mode !== 'pc01-live' || payload.authority !== 'PC01 live runtime' || payload.source?.core !== true) fail('UNVERIFIED_CORE_TRANSPORT');
 const projection = payload.workProjection;
 const projectionAge = now - Date.parse(projection?.verifiedAt);
 if (projection?.mode !== 'pc01-live+github' || projection.stale !== false || projection.openIssueEnumerationComplete !== true || !Number.isFinite(projectionAge) || projectionAge < 0 || projectionAge > 120000) fail('UNVERIFIED_WORK_PROJECTION');
 const matched = new Map();
 for (const item of inventory?.items || []) {
   const ident = identity(item.content?.url);
   if (ident) { if (matched.has(ident.key)) fail('DUPLICATE_PROJECT_ITEM'); matched.set(ident.key, item); }
 }
 const merged = new Map();
 for (const rows of [payload.openWork, payload.activeWork, payload.recentWork]) for (const row of rows || []) {
   const ident = identity(row.url);
   if (!ident || row.workKind && row.workKind !== 'WORK' || row.portfolioHidden === true) continue;
   const previous = merged.get(ident.key);
   merged.set(ident.key, previous ? { ...row, ...previous } : row);
 }
 const items = [];
 for (const [key, row] of merged) {
   const ident = identity(row.url), mapping = LIVE_PROJECT_MAP[row.projectId], item = matched.get(key);
   if (!mapping || !item?.content?.id) continue; // No title/body inference, manufacture, or item creation.
   const state = row.ownerGate === true || row.executionEligibility === 'OWNER_GATE' ? 'OWNER_GATE' : normalizeCoreStatus(row.displayState || row.status);
   items.push({
     repository: ident.repository, number: ident.number, url: ident.url, contentId: item.content.id,
     priority: row.effectivePriority || row.priority, project: mapping[0], subproject: SUBPROJECTS.includes(row.subproject) ? row.subproject : mapping[1],
     runtimeVerified: true, status: state, aiOwner: row.employeeId,
     targetDate: row.targetDate,
     blockerCode: state === 'OWNER_GATE' ? 'OWNER_GATE' : state === 'BLOCKED' ? 'DEPENDENCY' : state === 'EXTERNAL_WAIT' ? 'EXTERNAL_WAIT' : STATES[state] ? 'NONE' : undefined,
     evidenceUrl: evidence(row.evidenceUrl),
   });
 }
 const snapshot = { schema: 'tigeriq.core.portfolio-sync.v1', source: 'tigeriq-core', origin: 'core', verified: true, generatedAt: payload.generatedAt, registeredAiOwners, items };
 checkSnapshot(snapshot, now);
 return snapshot;
}
