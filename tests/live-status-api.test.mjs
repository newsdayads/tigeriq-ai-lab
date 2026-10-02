import { describe, expect, it, vi } from 'vitest';
import {
  compareQueueRows,
  buildWorkSections,
  ghAllPages,
  fetchPc01Live,
  rankQueueRows,
  normalizeRuntimeWorkerActivity,
  parseIssueNumber,
  parseQueueIssue,
  classifyOpenIssue,
  parseOpenWorkIssue,
  parseClearedBlockerLifecycleComment,
  progressForIssue,
  verifiedPortfolioProgress,
  projectExternalRoleClaims,
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

  it('projects canonical terminal-blocked labels as blocked even when the issue is not queue-admitted', () => {
    const row = parseOpenWorkIssue(issue(2006, '[P1] Label blocked only', [
      'TIGERIQ_EXECUTABLE=false',
      'CURRENT_STATE=READY',
    ].join('\n'), { labels: [{ name: 'tigeriq:terminal-blocked' }] }));
    expect(row).toMatchObject({ status: 'BLOCKED' });
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

  it('does not expose VY mutation ownership as the executor of a non-executable Owner goal', () => {
    const row = parseOpenWorkIssue(issue(3199, '[P0][OWNER] Final bootstrap', [
      'TIGERIQ_EXECUTABLE=false',
      'OWNER_CONTROLLED=true',
      'MUTATION_OWNER=VY',
      'PRIORITY=P0',
    ].join('\n')));
    expect(row).toMatchObject({ status: 'GOAL', workKind: 'GOAL', employeeId: null });
  });

  it('keeps App Chrome subject tags and historical target employees from becoming current executors', () => {
    const row = parseOpenWorkIssue(issue(2477, '[P0][NV03][WINDOW] Khôi phục App Chrome interactive session sau reboot', [
      'STATE=EXTERNAL_WAIT_OWNER_NV03_LOGIN',
      'NEXT=Owner login NV03 visible Chrome once; then one bounded verification only',
      'P0_BLOCKER=NV03_REAUTH',
      '',
      'CURRENT_STATE=WAIT_REBOOT_PERSISTENCE_GATE',
      'MUTATION_OWNER=VY_OWNER_AUTHORIZED',
      '',
      'TARGET_EMPLOYEE=NV09',
      'PRIORITY=P0',
    ].join('\n')), {
      active: {
        status: 'REVIEW',
        employeeId: 'NV03',
        currentStep: 'Đang chạy kiểm tra PR',
        prNumber: 2634,
        prUrl: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/2634',
        updatedAt: '2026-10-01T00:56:24Z',
        checks: { state: 'ĐANG CHẠY', passed: 1, total: 3, active: 2, failed: 0 },
      },
    });

    expect(row).toMatchObject({
      number: 2477,
      status: 'OWNER_GATE',
      currentState: 'EXTERNAL_WAIT_OWNER_NV03_LOGIN',
      employeeId: null,
      prNumber: null,
      prUrl: null,
      checks: null,
      nextStep: 'Owner login NV03 visible Chrome once; then one bounded verification only',
    });
  });

  it('lets a newer blocker-cleared lifecycle checkpoint supersede a stale blocked body for display truth', () => {
    const lifecycle = parseClearedBlockerLifecycleComment({
      body: [
        'PHASE | WINDOWS_PREREQUISITE',
        'STATE | WINDOWS_22H2_INSTALL_PASS_REBOOT_NEXT',
        'NEXT | Owner-authorized reboot PC01',
        'BLOCKER | none before reboot',
      ].join('\n'),
      created_at: '2026-09-28T17:30:00Z',
    });
    expect(lifecycle).toMatchObject({
      state: 'WINDOWS_22H2_INSTALL_PASS_REBOOT_NEXT',
      blockerCleared: true,
      step: 'Owner-authorized reboot PC01',
    });

    const row = parseOpenWorkIssue(issue(2048, '[P1][LAB] Paperclip', [
      'CURRENT_STATE=BLOCKED_WINDOWS_BUILD_19044_DOCKER_DESKTOP_MIN_19045',
      'TIGERIQ_EXECUTABLE=false',
      'PRIORITY=P1',
    ].join('\n')), { lifecycle });
    expect(row).toMatchObject({
      status: 'WAITING',
      currentState: 'WINDOWS_22H2_INSTALL_PASS_REBOOT_NEXT',
      currentStep: 'Owner-authorized reboot PC01',
      updatedAt: '2026-09-28T17:30:00Z',
    });
  });

  it('separates policy/reference, owner gates, goals and live acceptance without treating P0 as approval', () => {
    expect(classifyOpenIssue(issue(3200, '[P0][QUẢN TRỊ] Policy', 'STATE=CANONICAL'))).toMatchObject({ workKind: 'SYSTEM', ownerGate: false, ownerApprovalRequired: false });
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
      status: 'UNKNOWN', ownerGate: false, workKind: 'WORK',
    });
    expect(parseOpenWorkIssue(issue(3205, '[P1] New capability', [
      'CURRENT_STATE=OWNER_REVIEW_REQUIRED',
      'OWNER_ACCEPTANCE_REQUIRED=true',
      'TIGERIQ_EXECUTABLE=false',
    ].join('\n')))).toMatchObject({
      status: 'OWNER_GATE', ownerGate: true, ownerApprovalRequired: true, ownerAccepted: false,
    });
    expect(parseOpenWorkIssue(issue(3206, '[P1] New capability accepted', [
      'CURRENT_STATE=DONE',
      'OWNER_ACCEPTANCE_REQUIRED=true',
      'OWNER_ACCEPTED=true',
      'TIGERIQ_EXECUTABLE=false',
    ].join('\n')))).toMatchObject({
      ownerGate: false, ownerApprovalRequired: false, ownerAccepted: true,
    });
  });

  it('keeps an Owner gate canonical when stale runtime overlays still claim review or blocked work', () => {
    const row = parseOpenWorkIssue(issue(3212, '[P1] Owner final review', [
      'CURRENT_STATE=OWNER_REVIEW_REQUIRED',
      'CURRENT_STEP=Production live đã xác minh; chờ anh Sơn kiểm tra và duyệt',
      'OWNER_ACCEPTANCE_REQUIRED=true',
      'EVIDENCE_URL=https://tigeriq-ai-lab.vercel.app/command-center',
      'EVIDENCE_AT=2026-09-29T05:36:30Z',
    ].join('\n')), {
      active: {
        status: 'BLOCKED',
        employeeId: 'NV17',
        currentStep: 'Kiểm tra PR đang lỗi',
        prNumber: 2374,
        prUrl: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/2374',
        evidenceUrl: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/2374',
        updatedAt: '2026-09-29T05:22:04Z',
        checks: { state: 'LỖI', passed: 1, total: 3, failed: 2 },
      },
      queued: {
        targetWorker: 'NV17',
        waitReason: 'TigerIQ terminal BLOCKED',
        updatedAt: '2026-09-29T05:35:00Z',
      },
      lifecycle: {
        state: 'WAIT_INDEPENDENT_REVIEW',
        step: 'Old lifecycle review',
        createdAt: '2026-09-29T05:35:30Z',
      },
    });
    expect(row).toMatchObject({
      status: 'OWNER_GATE',
      currentState: 'OWNER_REVIEW_REQUIRED',
      currentStep: 'Production live đã xác minh; chờ anh Sơn kiểm tra và duyệt',
      evidenceUrl: 'https://tigeriq-ai-lab.vercel.app/command-center',
      evidenceAt: '2026-09-29T05:36:30.000Z',
      employeeId: null,
      prNumber: null,
      prUrl: null,
      checks: null,
      ownerApprovalPending: true,
    });
  });

  it('timestamps issue-backed evidence only from a valid explicit evidence timestamp', () => {
    const row = parseOpenWorkIssue(issue(3209, '[P1] Evidence freshness', [
      'CURRENT_STATE=OWNER_REVIEW_REQUIRED',
      'OWNER_ACCEPTANCE_REQUIRED=true',
      'EVIDENCE_URL=https://github.com/newsdayads/tigeriq-ai-lab/pull/2367',
      'EVIDENCE_AT=2026-09-29T05:20:00Z',
    ].join('\n')));
    expect(row).toMatchObject({
      status: 'OWNER_GATE',
      evidenceAt: '2026-09-29T05:20:00.000Z',
      evidenceUrl: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/2367',
    });

    const invalid = parseOpenWorkIssue(issue(3210, '[P1] Invalid evidence time', [
      'CURRENT_STATE=OWNER_REVIEW_REQUIRED',
      'OWNER_ACCEPTANCE_REQUIRED=true',
      'EVIDENCE_URL=https://github.com/newsdayads/tigeriq-ai-lab/pull/2367',
      'EVIDENCE_AT=not-a-date',
    ].join('\n')));
    expect(invalid.evidenceAt).toBe(null);
  });

  it('pairs active evidence with the active evidence timestamp instead of a stale body timestamp', () => {
    const row = parseOpenWorkIssue(issue(3211, '[P1] Active evidence wins', [
      'CURRENT_STATE=REVIEW',
      'EVIDENCE_URL=https://github.com/newsdayads/tigeriq-ai-lab/pull/2000',
      'EVIDENCE_AT=2026-09-28T00:00:00Z',
    ].join('\n')), {
      active: {
        status: 'REVIEW',
        evidenceUrl: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/2381',
        updatedAt: '2026-09-29T05:25:00Z',
      },
    });
    expect(row).toMatchObject({
      evidenceUrl: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/2381',
      evidenceAt: '2026-09-29T05:25:00.000Z',
    });
  });

  it('exposes only an explicit blocker for owner-facing compact cards', () => {
    const blocked = parseOpenWorkIssue(issue(3213, '[P1] Blocked compact card', [
      'CURRENT_STATE=BLOCKED',
      'BLOCKER=WAIT_PROVIDER',
      'NEXT=Reprobe after provider recovery',
    ].join('\n')));
    expect(blocked).toMatchObject({ blocker: 'WAIT_PROVIDER', nextStep: 'Reprobe after provider recovery' });

    const normal = parseOpenWorkIssue(issue(3214, '[P1] Normal compact card', [
      'CURRENT_STATE=READY',
      'BLOCKER=NONE',
    ].join('\n')));
    expect(normal.blocker).toBe(null);

    const cleared = parseOpenWorkIssue(issue(3215, '[P1] Cleared blocker compact card', [
      'CURRENT_STATE=BLOCKED',
      'BLOCKER=WAIT_PROVIDER',
    ].join('\n')), { lifecycle: { state: 'READY', blockerCleared: true, step: 'Reprobe now' } });
    expect(cleared).toMatchObject({ status: 'QUEUED', blocker: null });

    const activeAfterClear = parseOpenWorkIssue(issue(3216, '[P1] Active after clear', [
      'CURRENT_STATE=READY',
      'BLOCKER=WAIT_PROVIDER',
    ].join('\n')), {
      active: { status: 'WORKING', currentStep: 'Fresh runtime work', updatedAt: '2026-10-02T01:40:00Z' },
      lifecycle: { state: 'READY', blockerCleared: true, step: 'Old clear', createdAt: '2026-10-02T01:35:00Z' },
    });
    expect(activeAfterClear).toMatchObject({ status: 'WORKING', blocker: null });

    const newerClear = parseOpenWorkIssue(issue(3218, '[P1] Clear after stale runtime', [
      'CURRENT_STATE=READY',
      'BLOCKER=WAIT_PROVIDER',
    ].join('\n')), {
      active: { status: 'BLOCKED', currentStep: 'Stale runtime blocker', updatedAt: '2026-10-02T01:30:00Z' },
      lifecycle: { state: 'READY', blockerCleared: true, step: 'Cleared after runtime', createdAt: '2026-10-02T01:35:00Z' },
    });
    expect(newerClear).toMatchObject({ status: 'QUEUED', blocker: null });

    const reblocked = parseOpenWorkIssue(issue(3217, '[P1] Reblocked after clear', [
      'CURRENT_STATE=BLOCKED',
      'BLOCKER=WAIT_PROVIDER',
    ].join('\n'), { labels: [{ name: 'tigeriq:terminal-blocked' }], updated_at: '2026-10-02T01:45:00Z' }), {
      lifecycle: { state: 'READY', blockerCleared: true, step: 'Older clear', createdAt: '2026-10-02T01:35:00Z' },
    });
    expect(reblocked).toMatchObject({ status: 'BLOCKED', blocker: 'WAIT_PROVIDER' });
  });

  it('keeps planned NEXT_ACTION separate from current work and rejects unsafe evidence URLs', () => {
    const unsafe = parseOpenWorkIssue(issue(3207, '[P1] Planned step', [
      'CURRENT_STATE=READY',
      'NEXT_ACTION=Deploy next',
      'EVIDENCE_URL=javascript:alert(1)',
    ].join('\n')));
    expect(unsafe).toMatchObject({
      currentStep: null,
      nextStep: 'Deploy next',
      evidenceUrl: null,
    });

    const safe = parseOpenWorkIssue(issue(3208, '[P1] Safe evidence', [
      'CURRENT_STATE=READY',
      'EVIDENCE_URL=https://github.com/newsdayads/tigeriq-ai-lab/pull/2367',
    ].join('\n')));
    expect(safe.evidenceUrl).toBe('https://github.com/newsdayads/tigeriq-ai-lab/pull/2367');
  });

  it('shows progress only when an explicit checklist/percent is marked verified', () => {
    expect(progressForIssue(issue(3100, '[P1] Explicit unverified', 'PROGRESS_PERCENT=73'), 'OPEN')).toMatchObject({ percent: null, source: 'none' });
    expect(progressForIssue(issue(3101, '[P1] Checklist unverified', '- [x] A\n- [x] B\n- [ ] C\n- [ ] D'), 'OPEN')).toMatchObject({ percent: null, source: 'none' });
    expect(progressForIssue(issue(3102, '[P1] Lifecycle guess forbidden', 'CURRENT_STATE=WAIT_INDEPENDENT_REVIEW'), 'REVIEW')).toMatchObject({ percent: null, source: 'none' });
    expect(progressForIssue(issue(3103, '[P1] Verified checklist', 'PROGRESS_VERIFIED=true\n- [x] A\n- [x] B\n- [ ] C\n- [ ] D'), 'OPEN')).toMatchObject({ percent: 50, source: 'checklist_verified' });
    expect(progressForIssue(issue(3104, '[P1] Verified explicit', 'PROGRESS_SOURCE=VERIFIED\nPROGRESS_PERCENT=73'), 'OPEN')).toMatchObject({ percent: 73, source: 'explicit_verified' });
  });


  it('paginates open issues and proves complete enumeration only after the final short page', async () => {
    const seen = [];
    const fetchImpl = async (url) => {
      const value = String(url);
      seen.push(value);
      const page = Number(new URL(value).searchParams.get('page') || 1);
      const rows = page === 1
        ? Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }))
        : [{ number: 101 }];
      return new Response(JSON.stringify(rows), { status: 200 });
    };
    const result = await ghAllPages('/repos/tigeriq-test/pagination-only/issues?state=open&sort=updated&direction=desc', fetchImpl);
    expect(result).toMatchObject({ complete: true });
    expect(result.rows).toHaveLength(101);
    expect(seen.some((url) => url.includes('per_page=100') && url.includes('page=2'))).toBe(true);
  });

  it('fails closed for portfolio percent when buildWorkSections falls back to a stale GitHub snapshot', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-02T01:00:00Z'));
      let failOpenIssues = false;
      const workIssue = issue(3991, '[P1] Verified current work', [
        'TIGERIQ_EXECUTABLE=false',
        'CURRENT_STATE=READY',
        'PROGRESS_SOURCE=VERIFIED',
        'PROGRESS_PERCENT=60',
      ].join('\n'));
      const fetchImpl = async (url) => {
        const value = String(url);
        if (value.includes('/issues?state=open')) {
          if (failOpenIssues) throw new Error('github_open_issues_down');
          return new Response(JSON.stringify([workIssue]), { status: 200 });
        }
        if (value.includes('/pulls?state=open')) return new Response(JSON.stringify([]), { status: 200 });
        if (value.includes('/actions/runs?per_page=100')) return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
        if (value.includes('/issues?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        throw new Error('unexpected_url:' + value);
      };
      const fresh = await buildWorkSections({ workers: [], liveConnected: false }, fetchImpl);
      expect(fresh.portfolioProgress).toMatchObject({ percent: 60, source: 'verified_issue_average' });
      expect(fresh.workProjection).toMatchObject({ stale: false, openIssueEnumerationComplete: true });

      failOpenIssues = true;
      vi.setSystemTime(new Date('2026-10-02T01:01:00Z'));
      const stale = await buildWorkSections({ workers: [], liveConnected: false }, fetchImpl);
      expect(stale.workProjection.stale).toBe(true);
      expect(stale.portfolioProgress).toMatchObject({ percent: null, source: 'incomplete_enumeration' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes portfolio percent only when every current-scope work item has verified progress', () => {
    const partial = verifiedPortfolioProgress([
      { workKind: 'WORK', progressPercent: 50, progressSource: 'checklist_verified' },
      { workKind: 'WORK', progressPercent: null, progressSource: 'none' },
      { workKind: 'SYSTEM', progressPercent: null, progressSource: 'none' },
    ]);
    expect(partial).toMatchObject({ percent: null, scopeItems: 2, verifiedItems: 1, coveragePercent: 50 });

    const complete = verifiedPortfolioProgress([
      { workKind: 'WORK', progressPercent: 50, progressSource: 'checklist_verified' },
      { workKind: 'WORK', progressPercent: 80, progressSource: 'explicit_verified' },
    ]);
    expect(complete).toMatchObject({ percent: 65, source: 'verified_issue_average', scopeItems: 2, verifiedItems: 2, coveragePercent: 100 });

    const incompleteEnumeration = verifiedPortfolioProgress([
      { workKind: 'WORK', progressPercent: 50, progressSource: 'checklist_verified' },
    ], { complete: false });
    expect(incompleteEnumeration).toMatchObject({ percent: null, source: 'incomplete_enumeration', scopeItems: 1, verifiedItems: 1 });

    const excludesGoalAndSystem = verifiedPortfolioProgress([
      { workKind: 'WORK', progressPercent: 80, progressSource: 'explicit_verified' },
      { workKind: 'GOAL', progressPercent: null, progressSource: 'none' },
      { workKind: 'SYSTEM', progressPercent: null, progressSource: 'none' },
    ], { complete: true });
    expect(excludesGoalAndSystem).toMatchObject({ percent: 80, scopeItems: 1, verifiedItems: 1 });
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

  it('does not present a closed new capability as DONE before explicit Owner acceptance', () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    expect(parseRecentCompletedIssue({
      number: 3105,
      title: '[P1] New capability pending Owner',
      body: 'STATE=DONE\nOWNER_ACCEPTANCE_REQUIRED=true',
      state: 'closed',
      closed_at: '2026-09-24T23:30:00Z',
    }, now)).toBe(null);

    expect(parseRecentCompletedIssue({
      number: 3106,
      title: '[P1] New capability accepted',
      body: 'STATE=DONE\nOWNER_ACCEPTANCE_REQUIRED=true\nOWNER_ACCEPTED=true',
      state: 'closed',
      closed_at: '2026-09-24T23:30:00Z',
    }, now)).toMatchObject({ status: 'DONE', number: 3106 });
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

  it('keeps externally role-claimed work out of executable ranking', () => {
    const claimed = parseQueueIssue(issue(2012, '[P1][CORE] Externally claimed', [
      ...coreQueueFlags(),
      'AUTO_QUEUE=INCLUDED',
      'PRIORITY=P1',
    ].join('\n'), { labels: [{ name: 'tigeriq:role-claimed' }, { name: 'tigeriq:role-worker-nv02' }] }));
    expect(claimed).toMatchObject({ status: 'WAITING', waitReason: 'External role claim' });
    const ranked = rankQueueRows([claimed]);
    expect(ranked[0]).toMatchObject({ eligibleNow: false, dispatchRank: null });
  });

  it('projects canonical external claim over stale NV02 runtime job and falls back when label clears', () => {
    const base = {
      workers: [{
        employeeId: 'NV02', state: 'working', status: 'ĐANG LÀM',
        job: '#1766 - stale UI residue', detail: 'READY',
        currentJobId: 'GH-1766', updatedAt: '2026-09-26T00:00:00Z',
      }],
      summary: { working: 1, waiting: 0, blocked: 0, idle: 0, unknown: 0, paused: 0, total: 1 },
    };
    const claimedIssue = issue(1947, '[P1] Active external claim', 'TIGERIQ_EXECUTABLE=true', {
      labels: [{ name: 'tigeriq:role-claimed' }, { name: 'tigeriq:role-worker-nv02' }],
      updated_at: '2026-09-27T10:00:00Z',
    });
    const projected = projectExternalRoleClaims(base, [claimedIssue]);
    expect(projected.workers[0]).toMatchObject({
      employeeId: 'NV02', state: 'working', currentJobId: 'GH-1947',
      job: '#1947 - [P1] Active external claim',
    });
    const fallback = projectExternalRoleClaims(base, [{ ...claimedIssue, labels: [] }]);
    expect(fallback.workers[0].currentJobId).toBe('GH-1766');
  });


});
