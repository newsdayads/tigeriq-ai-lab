import { describe, expect, it } from 'vitest';
import {
  applyQueueLifecycle,
  buildLiveStatus,
  compareQueueRows,
  fetchPc01Live,
  lifecycleIndexFromComments,
  parseTigerIqLifecycleComment,
  queueRowEligibleNow,
  rankQueueRows,
  normalizeRuntimeWorkerActivity,
  parseIssueNumber,
  parseQueueIssue,
  parseRecentCompletedIssue,
  runtimeWorkRows,
  sanitizeRuntimePayload,
} from '../api/live-status.mjs';

function issue(number, title, body, extra = {}) {
  return {
    number,
    title,
    body,
    state: 'open',
    html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/' + number,
    updated_at: '2026-09-24T12:00:00Z',
    ...extra,
  };
}

function coreQueueFlags() {
  return [
    'TIGERIQ_EXECUTABLE=true',
    'OWNER_POLICY=AUTO',
    'NO_CODE_CHANGE=true',
    'NO_PC01_SHELL=true',
  ];
}

describe('TigerIQ Live Work Order projection', () => {
  it('extracts GitHub issue identity from Core/Coding job ids without guessing unrelated numbers', () => {
    expect(parseIssueNumber('JOB-GH-1714-PC')).toBe(1714);
    expect(parseIssueNumber('MGR-OBJ-GH-1812')).toBe(1812);
    expect(parseIssueNumber('https://github.com/newsdayads/tigeriq-ai-lab/issues/1819')).toBe(1819);
    expect(parseIssueNumber('NV12 model 429')).toBe(null);
  });

  it('parses only TigerIQ machine lifecycle comments', () => {
    expect(parseTigerIqLifecycleComment({
      id: 1,
      issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/2014',
      created_at: '2026-09-26T08:00:00Z',
      body: '[RESULT] TigerIQ Core blocked OBJ-GH-2014.\n\nbounded pc_operator failed',
    })).toMatchObject({ issueNumber: 2014, state: 'BLOCKED' });
    expect(parseTigerIqLifecycleComment({
      id: 2,
      issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/2014',
      created_at: '2026-09-26T08:01:00Z',
      body: 'Owner note: blocked for now',
    })).toBe(null);
    expect(parseTigerIqLifecycleComment({
      id: 3,
      issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/2037',
      created_at: '2026-09-26T08:02:00Z',
      body: '[BLOCKED_FINAL] CODEOBJ-x reason=OUTPUT_CONTRACT_EXHAUSTED',
    })).toMatchObject({ issueNumber: 2037, state: 'BLOCKED' });
  });

  it('lets a later machine rearm/claim supersede an older terminal result', () => {
    const index = lifecycleIndexFromComments([
      { id: 10, issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/2037', created_at: '2026-09-26T08:00:00Z', body: '[BLOCKED_FINAL] CODEOBJ-old reason=OUTPUT_CONTRACT_EXHAUSTED' },
      { id: 11, issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/2037', created_at: '2026-09-26T08:01:00Z', body: '[RETRY_DISPATCHED] CODEOBJ-new prior=CODEOBJ-old attempt=1/2' },
    ]);
    expect(index.get(2037)).toMatchObject({ state: 'ACTIVE', commentId: 11 });
  });

  it('projects terminal lifecycle state out of executable queue ranking', () => {
    const row = { number: 2014, priority: 'P1', effectivePriority: 'P1', status: 'QUEUED' };
    const blocked = applyQueueLifecycle(row, { state: 'BLOCKED' });
    expect(blocked).toMatchObject({ status: 'BLOCKED', waitReason: 'TigerIQ terminal BLOCKED' });
    expect(queueRowEligibleNow(blocked)).toBe(false);
    expect(applyQueueLifecycle(row, { state: 'COMPLETED' })).toBe(null);
    const active = applyQueueLifecycle(row, { state: 'ACTIVE' });
    expect(active).toMatchObject({ status: 'WAITING', waitReason: 'TigerIQ đang xử lý' });
    expect(queueRowEligibleNow(active)).toBe(false);
  });

  it('preserves canonical GitHub title and AUTO queue policy', () => {
    const row = parseQueueIssue(issue(2001, '[P1][CORE] Việc chuẩn', [
      ...coreQueueFlags(),
      'AUTO_QUEUE=INCLUDED',
      'PRIORITY=P1',
    ].join('\n')));
    expect(row).toMatchObject({ number: 2001, title: '[P1][CORE] Việc chuẩn', priority: 'P1', status: 'QUEUED' });

    expect(parseQueueIssue(issue(2002, '[P0] Không vào queue', [
      ...coreQueueFlags(),
      'AUTO_QUEUE=EXCLUDED',
      'PRIORITY=P0',
    ].join('\n')))).toBe(null);

    expect(parseQueueIssue(issue(2003, '[P0] Đã superseded', [
      ...coreQueueFlags(),
      'STATE=SUPERSEDED',
      'PRIORITY=P0',
    ].join('\n')))).toBe(null);
  });

  it('keeps explicit dependency-wait state out of QUEUED', () => {
    const row = parseQueueIssue(issue(2005, '[P0] Chờ dependency', [
      ...coreQueueFlags(),
      'AUTO_QUEUE=INCLUDED',
      'PRIORITY=P0',
      'STATE=WAIT_DEPENDENCY',
      'DEPENDS_ON=#1900',
    ].join('\n')));
    expect(row).toMatchObject({ status: 'WAITING', waitReason: 'WAIT_DEPENDENCY', dependencies: [1900] });
  });

  it('keeps OWNER_HOLD visible as WAITING and records declared dependencies', () => {
    const row = parseQueueIssue(issue(2004, '[P0] Chờ Owner', [
      ...coreQueueFlags(),
      'OWNER_HOLD=true',
      'OWNER_DIRECT=true',
      'PRIORITY=P0',
      'DEPENDS_ON=#1900,#1901',
    ].join('\n')));
    expect(row).toMatchObject({
      ownerDirect: true,
      priority: 'P0',
      status: 'WAITING',
      waitReason: 'OWNER_HOLD',
      dependencies: [1900, 1901],
    });
  });

  it('ranks only executable P1-P5 rows and keeps waiting/blocked work unnumbered', () => {
    const rows = rankQueueRows([
      { number: 1921, priority: 'P1', effectivePriority: 'P1', ownerDirect: true, status: 'WAITING', waitReason: 'OWNER_HOLD' },
      { number: 1922, priority: 'P1', effectivePriority: 'P1', ownerDirect: true, status: 'WAITING', waitReason: 'Chờ #1915' },
      { number: 1947, priority: 'P1', effectivePriority: 'P1', ownerDirect: false, status: 'QUEUED' },
      { number: 1945, priority: 'P2', effectivePriority: 'P2', ownerDirect: false, status: 'QUEUED' },
      { number: 1888, priority: 'P0', effectivePriority: 'P0', ownerDirect: true, status: 'QUEUED' },
    ]);
    expect(rows.map((row) => row.number)).toEqual([1947, 1945, 1921, 1922, 1888]);
    expect(rows.slice(0, 2).map((row) => row.dispatchRank)).toEqual([1, 2]);
    expect(rows.slice(2).every((row) => row.dispatchRank === null && row.eligibleNow === false)).toBe(true);
    expect(rows.at(-1)).toMatchObject({ number: 1888, status: 'WAITING', waitReason: 'P0 chờ Owner/assignment' });
  });

  it('uses OWNER_DIRECT only as a same-priority tie-break among executable rows', () => {
    const rows = [
      { number: 30, priority: 'P2', effectivePriority: 'P2', ownerDirect: true, status: 'QUEUED' },
      { number: 20, priority: 'P1', effectivePriority: 'P1', ownerDirect: false, status: 'QUEUED' },
      { number: 10, priority: 'P2', effectivePriority: 'P2', ownerDirect: false, status: 'QUEUED' },
      { number: 40, priority: 'P1', effectivePriority: 'P1', ownerDirect: true, status: 'QUEUED' },
      { number: 50, priority: 'P5', effectivePriority: 'P5', ownerDirect: false, status: 'QUEUED' },
    ].sort(compareQueueRows);
    expect(rows.map((row) => row.number)).toEqual([40, 20, 30, 10, 50]);
  });

  it('preserves canonical effective priority through queue projection', () => {
    const row = parseQueueIssue(issue(2010, '[P4][CORE] Lower urgency', [
      ...coreQueueFlags(),
      'AUTO_QUEUE=INCLUDED',
      'PRIORITY=P4',
    ].join('\n')));
    expect(row).toMatchObject({ priority: 'P4', effectivePriority: 'P4', sourcePriority: 'P4', status: 'QUEUED' });
  });

  it('rejects GitHub items that are not eligible in existing Core/Coding schedulers', () => {
    expect(parseQueueIssue(issue(2006, '[P0] Thiếu guard scheduler', [
      'TIGERIQ_EXECUTABLE=true',
      'OWNER_POLICY=AUTO',
      'AUTO_QUEUE=INCLUDED',
      'PRIORITY=P0',
    ].join('\n')))).toBe(null);
  });

  it('maps a live Coding worker by one unique canonical title when its runtime id has no GitHub number', () => {
    const workers = [{
      employeeId: 'NV17',
      state: 'working',
      currentJobId: 'CODE-abc',
      job: '[OWNER_DIRECT][P0][NV09] Core runtime registration + real inference acceptance [sửa lần 2]',
      detail: 'inception · mercury-2.5',
    }];
    const issues = [
      issue(1530, '[OWNER_DIRECT][P0][NV09] Core runtime registration + real inference acceptance', coreQueueFlags().join('\n')),
    ];
    expect(runtimeWorkRows(workers, issues)).toEqual([
      expect.objectContaining({ issueNumber: 1530, employeeId: 'NV17', runtimeStatus: 'WORKING' }),
    ]);
  });

  it('projects only verified live worker states with a GitHub issue identity', () => {
    const workers = [
      { employeeId: 'NV12', state: 'working', currentJobId: 'MGR-OBJ-GH-1812', detail: 'Đang sửa', heartbeatAt: '2026-09-24T12:00:00Z' },
      { employeeId: 'NV03', state: 'idle', currentJobId: 'JOB-GH-999' },
      { employeeId: 'NV04', state: 'working', currentJobId: 'research-local' },
    ];
    expect(runtimeWorkRows(workers)).toEqual([
      expect.objectContaining({ issueNumber: 1812, employeeId: 'NV12', runtimeStatus: 'WORKING', currentStep: 'Đang sửa' }),
    ]);
  });

  it('re-resolves the runtime pointer and retries once after bridge HTTP 530', async () => {
    let pointerCalls = 0;
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value.includes('/issues/1402')) {
        pointerCalls += 1;
        const bridge = pointerCalls === 1 ? 'https://old.trycloudflare.com' : 'https://new.trycloudflare.com';
        return new Response(JSON.stringify({ body: 'LIVE_STATUS_BRIDGE_URL=' + bridge }), { status: 200 });
      }
      if (value === 'https://old.trycloudflare.com/status') {
        return new Response('bad gateway', { status: 530 });
      }
      if (value === 'https://new.trycloudflare.com/status') {
        return new Response(JSON.stringify({
          ok: true,
          generatedAt: '2026-09-25T00:00:00Z',
          source: { core: true, coding: true, uiAutopilot: true },
          workers: [],
        }), { status: 200 });
      }
      if (value.includes('/issues?state=open')) return new Response(JSON.stringify([]), { status: 200 });
      if (value.includes('/issues/comments?')) return new Response(JSON.stringify([]), { status: 200 });
      if (value.includes('/pulls?state=open')) return new Response(JSON.stringify([]), { status: 200 });
      if (value.includes('/actions/runs?per_page=100')) return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      throw new Error('unexpected_url:' + value);
    };
    const result = await fetchPc01Live(fetchImpl);
    expect(pointerCalls).toBe(2);
    expect(result).toMatchObject({ ok: true, liveConnected: true });
  });


  it('uses one repository-wide lifecycle comment request instead of per-issue comment requests', async () => {
    let lifecycleCalls = 0;
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value.includes('/issues/335')) return new Response(JSON.stringify({ body: '', updated_at: '2026-09-26T08:00:00Z' }), { status: 200 });
      if (value.includes('/actions/runs?per_page=100')) return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      if (value.includes('/pulls?state=open')) return new Response(JSON.stringify([]), { status: 200 });
      if (value.includes('/issues?state=open')) return new Response(JSON.stringify([]), { status: 200 });
      if (value.includes('/issues/comments?')) { lifecycleCalls += 1; return new Response(JSON.stringify([]), { status: 200 }); }
      if (value.includes('/issues?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error('unexpected_url:' + value);
    };
    await buildLiveStatus(fetchImpl);
    expect(lifecycleCalls).toBe(1);
  });

  it('requires a current job and heartbeat no older than 60 seconds before showing ĐANG LÀM', () => {
    const now = Date.parse('2026-09-25T00:01:00Z');
    const base = {
      employeeId: 'NV12',
      state: 'working',
      status: 'ĐANG LÀM',
      detail: 'Đang xử lý',
      currentJobId: 'MGR-OBJ-GH-1867',
      heartbeatAt: '2026-09-25T00:00:20Z',
    };
    expect(normalizeRuntimeWorkerActivity(base, now).state).toBe('working');
    expect(normalizeRuntimeWorkerActivity({ ...base, currentJobId: null }, now)).toMatchObject({ state: 'unknown', status: 'CHƯA RÕ' });
    expect(normalizeRuntimeWorkerActivity({ ...base, heartbeatAt: '2026-09-24T23:59:59Z' }, now)).toMatchObject({ state: 'unknown', status: 'CHƯA RÕ' });
  });

  it('shows only completed issues from the last 24 hours in recent work', () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    const recent = parseRecentCompletedIssue({
      number: 1861,
      title: '[P0][VERCEL] Việc đã xong',
      body: 'STATE=DONE',
      state: 'closed',
      state_reason: 'completed',
      closed_at: '2026-09-24T23:30:00Z',
      html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/1861',
    }, now);
    expect(recent).toMatchObject({ number: 1861, status: 'DONE' });
    expect(parseRecentCompletedIssue({
      number: 1800,
      title: 'Việc cũ',
      body: 'STATE=DONE',
      state: 'closed',
      closed_at: '2026-09-23T00:00:00Z',
    }, now)).toBe(null);
    expect(parseRecentCompletedIssue({
      number: 1801,
      title: 'Không làm',
      body: 'STATE=CANCELLED',
      state: 'closed',
      closed_at: '2026-09-24T23:30:00Z',
    }, now)).toBe(null);
  });

  it('keeps the existing workforce payload while adding read-only work projection fields', () => {
    const result = sanitizeRuntimePayload({
      ok: true,
      generatedAt: '2026-09-24T12:00:00Z',
      source: { core: true, coding: true, uiAutopilot: true },
      workers: [{
        employeeId: 'NV12',
        label: 'NV12',
        kind: 'api',
        state: 'working',
        status: 'ĐANG LÀM',
        job: 'Issue #1812',
        detail: 'Đang kiểm tra',
        currentJobId: 'MGR-OBJ-GH-1812',
        heartbeatAt: '2026-09-24T12:00:00Z',
      }],
    });
    expect(result.workers).toHaveLength(1);
    expect(result.activeWork).toEqual([
      expect.objectContaining({ issueNumber: 1812, employeeId: 'NV12', runtimeStatus: 'WORKING' }),
    ]);
    expect(result.nextQueue).toEqual([]);
  });
});
