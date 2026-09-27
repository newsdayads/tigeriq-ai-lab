import { describe, expect, it } from 'vitest';
import {
  compareQueueRows,
  fetchPc01Live,
  rankQueueRows,
  normalizeRuntimeWorkerActivity,
  parseIssueNumber,
  parseQueueIssue,
  classifyOpenIssue,
  parseOpenWorkIssue,
  progressForIssue,
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
      if (value.includes('/pulls?state=open')) return new Response(JSON.stringify([]), { status: 200 });
      if (value.includes('/actions/runs?per_page=100')) return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      throw new Error('unexpected_url:' + value);
    };
    const result = await fetchPc01Live(fetchImpl);
    expect(pointerCalls).toBe(2);
    expect(result).toMatchObject({ ok: true, liveConnected: true });
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

  it('keeps completed history beyond 24 hours and exposes priority + NV metadata', () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    const recent = parseRecentCompletedIssue({
      number: 1861,
      title: '[P0][VERCEL][NV12] Việc đã xong',
      body: 'STATE=DONE\nPRIORITY=P1\nASSIGNED_EXECUTOR=NV19',
      state: 'closed',
      state_reason: 'completed',
      closed_at: '2026-09-24T23:30:00Z',
      html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/1861',
    }, now);
    expect(recent).toMatchObject({ number: 1861, status: 'DONE', priority: 'P1', effectivePriority: 'P1', employeeId: 'NV19' });

    const older = parseRecentCompletedIssue({
      number: 1800,
      title: '[P2][NV12] Việc cũ',
      body: 'STATE=DONE',
      state: 'closed',
      closed_at: '2026-08-01T00:00:00Z',
    }, now);
    expect(older).toMatchObject({ number: 1800, priority: 'P2', employeeId: 'NV12', status: 'DONE' });

    expect(parseRecentCompletedIssue({
      number: 1801,
      title: '[P3] Không làm',
      body: 'STATE=CANCELLED',
      state: 'closed',
      closed_at: '2026-09-24T23:30:00Z',
    }, now)).toBe(null);
  });

  it('projects all open work even when it is excluded from scheduler queue', () => {
    const blocked = parseOpenWorkIssue(issue(3001, '[P2][CODING] Bị chặn', [
      'PRIORITY=P2',
      'TIGERIQ_EXECUTABLE=false',
      'AUTO_QUEUE=EXCLUDED',
      'CURRENT_STATE=BLOCKED_OWNER_MAINTENANCE_AUTH',
      'TARGET_EMPLOYEE=NV09',
    ].join('\n')));
    expect(blocked).toMatchObject({
      number: 3001, priority: 'P2', employeeId: 'NV09', status: 'OWNER_GATE', ownerGate: true, workKind: 'WORK',
    });

    const meta = parseOpenWorkIssue(issue(3002, '[TÀI NGUYÊN] Nguồn lực', 'STATE=OPEN'));
    expect(meta).toMatchObject({ number: 3002, priority: null, status: 'SYSTEM', workKind: 'SYSTEM', progressPercent: null, meta: true });
  });

  it('separates policy/reference, owner gates, goals and live acceptance without treating P0 as approval', () => {
    expect(classifyOpenIssue(issue(3200, '[P0][QUẢN TRỊ] Policy', 'STATE=CANONICAL'))).toEqual({ workKind: 'SYSTEM', ownerGate: false });
    expect(parseOpenWorkIssue(issue(3201, '[P2][CODING] Owner gate', 'CURRENT_STATE=BLOCKED_OWNER_MAINTENANCE_AUTH'))).toMatchObject({
      status: 'OWNER_GATE', ownerGate: true, workKind: 'WORK',
    });
    expect(parseOpenWorkIssue(issue(3202, '[P0][OWNER] Objective', 'TIGERIQ_EXECUTABLE=false\nOWNER_CONTROLLED=true'))).toMatchObject({
      status: 'GOAL', ownerGate: false, workKind: 'GOAL',
    });
    expect(parseOpenWorkIssue(issue(3203, '[P0][APP-CHROME][EVIDENCE] Acceptance', 'CURRENT_STATE=READY_LIVE_ACCEPTANCE\nTIGERIQ_EXECUTABLE=false'))).toMatchObject({
      status: 'VERIFY', ownerGate: false, workKind: 'WORK',
    });
    expect(parseOpenWorkIssue(issue(3204, '[P0][APP-CHROME] Working', 'STATE=WORKING\nTIGERIQ_EXECUTABLE=false'))).toMatchObject({
      status: 'WORKING', ownerGate: false, workKind: 'WORK',
    });
  });

  it('computes progress only from explicit percent, checklist, or canonical lifecycle evidence', () => {
    expect(progressForIssue(issue(3100, '[P1] Explicit', 'PROGRESS_PERCENT=73'), 'OPEN')).toMatchObject({ percent: 73, source: 'explicit' });
    expect(progressForIssue(issue(3101, '[P1] Checklist', '- [x] A\n- [x] B\n- [ ] C\n- [ ] D'), 'OPEN')).toMatchObject({ percent: 50, source: 'checklist' });
    expect(progressForIssue(issue(3102, '[P1] Review', 'CURRENT_STATE=WAIT_INDEPENDENT_REVIEW'), 'REVIEW')).toMatchObject({ percent: 60, source: 'lifecycle' });
    expect(progressForIssue(issue(3103, '[P1] Unknown', 'STATE=OPEN'), 'OPEN')).toMatchObject({ percent: null, source: 'none' });
  });

  it('marks completed history as 100 percent', () => {
    const row = parseRecentCompletedIssue({
      number: 3104,
      title: '[P1] Done',
      body: 'STATE=DONE',
      state: 'closed',
      closed_at: '2026-09-24T23:30:00Z',
    }, Date.parse('2026-09-25T00:00:00Z'));
    expect(row).toMatchObject({ status: 'DONE', progressPercent: 100, progressDetail: '5/5 gate' });
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
  it('keeps terminal-blocked lifecycle label out of executable ranking', () => {
    const blocked = parseQueueIssue(issue(2011, '[P1][CORE] Terminal blocked', [
      ...coreQueueFlags(),
      'AUTO_QUEUE=INCLUDED',
      'PRIORITY=P1',
    ].join('\n'), { labels: [{ name: 'tigeriq:terminal-blocked' }] }));
    expect(blocked).toMatchObject({ status: 'BLOCKED', waitReason: 'TigerIQ terminal BLOCKED' });
    const ranked = rankQueueRows([blocked]);
    expect(ranked[0]).toMatchObject({ eligibleNow: false, dispatchRank: null });
  });


});
