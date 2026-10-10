import { describe, it, expect } from 'vitest';
import { identity, planSync, syncProjects, TARGET, snapshotFromLiveStatus, CORE_STATUS_URL } from '../apps/tigeriq-core/github-projects-sync.mjs';
const now = Date.parse('2026-10-10T04:10:00Z');
const row = { repository: 'newsdayads/tigeriq-ai-lab', number: 4640, url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/4640', contentId: 'I_4640', priority: 'P1', project: 'TigerIQ AI', subproject: 'Workflow Lab', runtimeVerified: true, status: 'WORKING', aiOwner: 'NV02', blockerCode: 'NONE' };
const snapshot = (items = [row]) => ({ schema: 'tigeriq.core.portfolio-sync.v1', source: 'tigeriq-core', origin: 'core', verified: true, generatedAt: new Date(now).toISOString(), registeredAiOwners: ['NV02'], items });
const inventory = (rows = [row]) => ({ ...TARGET, id: 'PVT_1', public: false, items: rows.map((r, i) => ({ id: 'PVTI_' + i, content: { url: r.url, id: r.contentId, repository: r.repository, number: r.number } })) });
const plan = (s = snapshot(), i = inventory(), options = {}) => planSync(s, i, { now, ...options });
function fakeApi({ scopes = 'project', canUpdate = true, publicProject = false } = {}) {
 const calls = [];
 const names = { PROJECT: ['TigerIQ AI'], SUBPROJECT: ['Workflow Lab'], Status: ['ĐANG XỬ LÝ', 'BỊ CHẶN', 'CHƯA XÁC MINH'] };
 const project = { ...inventory(), viewerCanUpdate: canUpdate, public: publicProject, fields: { nodes: [...Object.entries(names).map(([name, values]) => ({ name, id: name, options: values.map(name => ({ name, id: name })) })), ...['AI OWNER', 'BLOCKER', 'EVIDENCE'].map(name => ({ name, id: name, dataType: 'TEXT' }))], pageInfo: { hasNextPage: false } }, items: { nodes: inventory().items.map(x => ({ ...x, content: { ...x.content, repository: { nameWithOwner: x.content.repository } } })), pageInfo: { hasNextPage: false } } };
 const fetchImpl = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, headers: { get: () => scopes }, json: async () => ({ data: options.body.includes('mutation') ? { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_0' } } } : { user: { projectV2: project } } }) }; };
 return { calls, fetchImpl };
}
describe('Core → Projects metadata fence', () => {
 it('requires exact canonical issue/PR identity and separates repositories', () => {
  expect(identity(row.url + '?token=secret')).toBeNull();
  expect(identity(row.url + '#comment')).toBeNull();
  expect(identity('https://github.com/other/tigeriq-ai-lab/issues/4640')).toBeNull();
  const driver = { ...row, repository: 'newsdayads/drivetrack', url: 'https://github.com/newsdayads/drivetrack/issues/4640', contentId: 'I_DRIVER', project: 'TigerIQ Driver', subproject: 'DeX Shot' };
  expect(plan(snapshot([row, driver]), inventory([row, driver])).updates).toHaveLength(2);
 });
 it('deduplicates identical metadata and rejects conflicting priority or state', () => {
  expect(plan(snapshot([row, { ...row }])).updates).toHaveLength(1);
  expect(() => plan(snapshot([row, { ...row, status: 'DONE' }]))).toThrow('CONFLICTING_CORE_DUPLICATE');
  expect(() => plan(snapshot([row, { ...row, priority: 'P0' }]))).toThrow('CONFLICTING_CORE_PRIORITY');
 });
 it('rejects duplicate Project mapping and content ID mismatch', () => {
  expect(() => plan(snapshot(), inventory([row, row]))).toThrow('DUPLICATE_PROJECT_ITEM');
  expect(() => plan(snapshot([{ ...row, contentId: 'OTHER' }]))).toThrow('CONTENT_ID_MISMATCH');
 });
 it('never imports missing items or assigns P0; unknown priority is excluded', () => {
  expect(plan(snapshot([{ ...row, priority: 'P0' }])).updates[0].values).toEqual({ Status: 'ĐANG XỬ LÝ', BLOCKER: '' });
  expect(plan(snapshot([{ ...row, priority: null }])).updates).toHaveLength(0);
  expect(plan(snapshot(), inventory([])).skipped[0].reason).toBe('EXISTING_ITEM_REQUIRED');
 });
 it('excludes sensitive Driver366 regardless of fields', () => {
  const r = { ...row, repository: 'newsdayads/drivetrack', number: 366, url: 'https://github.com/newsdayads/drivetrack/issues/366' };
  expect(plan(snapshot([r]), inventory([r])).skipped[0].reason).toBe('SENSITIVE_EXCLUDED');
 });
 it('exports only allowlisted metadata, sanitized blocker and evidence', () => {
  const r = { ...row, body: 'SECRET PII', comment: 'PRIVATE', blocker: 'John 0901234567', blockerCode: 'OWNER_GATE', evidenceUrl: row.url + '?token=SECRET', aiOwner: 'person@example.com', targetDate: '2026-99-99' };
  const output = plan(snapshot([r]));
  expect(output.updates[0].values.BLOCKER).toBe('Cần Owner');
  expect(JSON.stringify(output)).not.toMatch(/SECRET|PRIVATE|0901234567|example.com|PRIORITY|body|comment/);
  expect(output.updates[0].values.EVIDENCE).toBeUndefined();
 });
 it('uses blocked Owner gate and never asserts runtime from unverified state', () => {
  expect(plan(snapshot([{ ...row, status: 'OWNER_GATE' }])).updates[0].values.Status).toBe('BỊ CHẶN');
  expect(plan(snapshot([{ ...row, status: 'DONE', runtimeVerified: false }])).updates[0].values.Status).toBe('CHƯA XÁC MINH');
 });
 it('rejects stale, future, unverified and GitHub-origin snapshots (no loop)', () => {
  for (const patch of [{ verified: false }, { origin: 'github-projects' }, { source: 'github' }, { generatedAt: new Date(now - 120001).toISOString() }, { generatedAt: new Date(now + 1).toISOString() }]) expect(() => plan({ ...snapshot(), ...patch })).toThrow();
 });
 it('uses receipts for idempotency and still refreshes a changed state', () => {
  const first = plan().updates[0], receipts = { [first.key]: first.fingerprint };
  expect(plan(snapshot(), inventory(), { receipts }).updates).toHaveLength(0);
  expect(plan(snapshot([{ ...row, status: 'DONE' }]), inventory(), { receipts }).updates).toHaveLength(1);
 });
 it('defaults to dry run, uses identifier-only read query, never mutation', async () => {
  const api = fakeApi();
  const result = await syncProjects({ snapshot: snapshot(), token: 'test', ...api, now: () => now });
  expect(result.ok).toBe(true); expect(result.applied).toBe(0);
  expect(api.calls.every(x => !x.body.query.includes('mutation'))).toBe(true);
  expect(api.calls[0].body.query).not.toMatch(/\b(body|comments|assignees|logs)\b/);
 });
 it('fails closed without token, write scope, privacy or viewer permission', async () => {
  let calls = 0;
  expect((await syncProjects({ snapshot: snapshot(), mode: 'write', fetchImpl: async () => { calls++; }, now: () => now })).reason).toBe('PROJECT_AUTH_REQUIRED');
  expect(calls).toBe(0);
  for (const settings of [{ scopes: 'read:project' }, { scopes: '' }, { canUpdate: false }, { publicProject: true }]) {
   const api = fakeApi(settings);
   expect((await syncProjects({ snapshot: snapshot(), mode: 'write', token: 'test', ...api, now: () => now })).ok).toBe(false);
   expect(api.calls.some(x => x.body.query.includes('mutation'))).toBe(false);
  }
 });
 it('authorized writes only update existing item fields and return reusable receipts', async () => {
  const api = fakeApi();
  const result = await syncProjects({ snapshot: snapshot(), token: 'test', mode: 'write', ...api, now: () => now });
  expect(result.ok).toBe(true); expect(result.applied).toBe(5);
  const mutations = api.calls.filter(x => x.body.query.includes('mutation'));
  expect(mutations.every(x => x.body.query.includes('updateProjectV2ItemFieldValue'))).toBe(true);
  expect(mutations.every(x => x.body.variables.input.projectId === 'PVT_1')).toBe(true);
  expect(plan(snapshot(), inventory(), { receipts: result.receipts }).updates).toHaveLength(0);
 });
 it('stops on authorization change before mutation, never returns provider secrets', async () => {
  const api = fakeApi(); let count = 0;
  const fetchImpl = async (...args) => { count++; if (count > 1) throw new Error('SECRET'); return api.fetchImpl(...args); };
  const result = await syncProjects({ snapshot: snapshot(), token: 'test', mode: 'write', fetchImpl, now: () => now });
  expect(result).toMatchObject({ ok: false, reason: 'SYNC_FAILED_CLOSED', retry: false });
  expect(api.calls.some(x => x.body.query.includes('mutation'))).toBe(false);
 });
});

describe('verified live-status bridge', () => {
 const live = { ok: true, liveConnected: true, mode: 'pc01-live', authority: 'PC01 live runtime', source: { core: true }, generatedAt: new Date(now).toISOString(), openWork: [{ ...row, projectId: 'tigeriq-platform', employeeId: 'NV02', body: 'PII', blocker: 'PII' }], activeWork: [], recentWork: [] };
 const options = { endpoint: CORE_STATUS_URL, transportVerified: true, inventory: inventory(), registeredAiOwners: ['NV02'], now };
 it('requires connected authoritative Core and trusted transport', () => {
  expect(() => snapshotFromLiveStatus(live, { ...options, transportVerified: false })).toThrow();
  expect(() => snapshotFromLiveStatus({ ...live, source: { core: false } }, options)).toThrow();
 });
 it('joins by exact URL/node ID, dedups streams and never exports raw detail', () => {
  const s = snapshotFromLiveStatus({ ...live, activeWork: [{ url: row.url, status: 'WORKING' }], recentWork: [{ url: row.url, status: 'DONE' }] }, options);
  expect(s.items).toHaveLength(1); expect(s.items[0].contentId).toBe('I_4640');
  expect(JSON.stringify(s)).not.toMatch(/PII|body|blocker":/);
  expect(plan(s).updates[0].values.PROJECT).toBe('TigerIQ AI');
 });
 it('fails closed for stale live snapshot and ignores unknown project IDs', () => {
  expect(() => snapshotFromLiveStatus({ ...live, generatedAt: '2000-01-01T00:00:00Z' }, options)).toThrow();
  expect(snapshotFromLiveStatus({ ...live, openWork: [{ ...live.openWork[0], projectId: 'custom-unknown' }] }, options).items).toHaveLength(0);
 });
});

describe('Driver project mapping', () => {
 it('does not mislabel all Driver work as DeX Shot', () => {
  const r = { ...row, repository: 'newsdayads/drivetrack', number: 370, url: 'https://github.com/newsdayads/drivetrack/issues/370', projectId: 'tigeriq-driver' };
  const payload = { ok: true, liveConnected: true, mode: 'pc01-live', authority: 'PC01 live runtime', source: { core: true }, generatedAt: new Date(now).toISOString(), openWork: [r] };
  const s = snapshotFromLiveStatus(payload, { endpoint: CORE_STATUS_URL, transportVerified: true, inventory: inventory([r]), now });
  expect(planSync(s, inventory([r]), { now }).updates[0].values.SUBPROJECT).toBeUndefined();
 });
});

describe('actual owner-facing Core states', () => {
 for (const [input, expected, blocker] of [
 ['ĐANG XỬ LÝ','ĐANG XỬ LÝ',''], ['RÀ SOÁT','RÀ SOÁT',''], ['HOÀN TẤT','HOÀN TẤT',''],
 ['ĐANG CHỜ','CHỜ',''], ['BỊ CHẶN','BỊ CHẶN','Chờ phụ thuộc'], ['XÁC MINH','RÀ SOÁT',''],
 ['CHỜ ANH SƠN DUYỆT','BỊ CHẶN','Cần Owner'], ['WAITING','CHỜ',''], ['VERIFY','RÀ SOÁT',''],
 ['EXTERNAL_WAIT','CHỜ','Chờ bên ngoài'], ['COMPLETED','HOÀN TẤT',''],
 ['ĐÃ ĐỦ ĐIỀU KIỆN — CHỜ ANH SƠN DUYỆT','BỊ CHẶN','Cần Owner'],
 ]) it('maps actual Core ' + input, () => {
  const payload = { ok: true, liveConnected: true, mode: 'pc01-live', authority: 'PC01 live runtime', source: { core: true }, generatedAt: new Date(now).toISOString(), openWork: [{ ...row, projectId: 'tigeriq-platform', status: input, displayState: input }] };
  const s = snapshotFromLiveStatus(payload, { endpoint: CORE_STATUS_URL, transportVerified: true, inventory: inventory(), now });
  const values = plan(s).updates[0].values;
  expect(values.Status).toBe(expected); expect(values.BLOCKER).toBe(blocker);
 });
});
