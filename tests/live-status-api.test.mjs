import { describe, expect, it } from 'vitest';
import {
  compareQueueRows,
  parseIssueNumber,
  parseQueueIssue,
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

describe('TigerIQ Live Work Order projection', () => {
  it('extracts GitHub issue identity from Core/Coding job ids without guessing unrelated numbers', () => {
    expect(parseIssueNumber('JOB-GH-1714-PC')).toBe(1714);
    expect(parseIssueNumber('MGR-OBJ-GH-1812')).toBe(1812);
    expect(parseIssueNumber('https://github.com/newsdayads/tigeriq-ai-lab/issues/1819')).toBe(1819);
    expect(parseIssueNumber('NV12 model 429')).toBe(null);
  });

  it('preserves canonical GitHub title and AUTO queue policy', () => {
    const row = parseQueueIssue(issue(2001, '[P1][CORE] Việc chuẩn', [
      'TIGERIQ_EXECUTABLE=true',
      'OWNER_POLICY=AUTO',
      'AUTO_QUEUE=INCLUDED',
      'PRIORITY=P1',
    ].join('\n')));
    expect(row).toMatchObject({ number: 2001, title: '[P1][CORE] Việc chuẩn', priority: 'P1', status: 'QUEUED' });

    expect(parseQueueIssue(issue(2002, '[P0] Không vào queue', [
      'TIGERIQ_EXECUTABLE=true',
      'OWNER_POLICY=AUTO',
      'AUTO_QUEUE=EXCLUDED',
      'PRIORITY=P0',
    ].join('\n')))).toBe(null);

    expect(parseQueueIssue(issue(2003, '[P0] Đã superseded', [
      'TIGERIQ_EXECUTABLE=true',
      'OWNER_POLICY=AUTO',
      'STATE=SUPERSEDED',
      'PRIORITY=P0',
    ].join('\n')))).toBe(null);
  });

  it('keeps explicit dependency-wait state out of QUEUED', () => {
    const row = parseQueueIssue(issue(2005, '[P0] Chờ dependency', [
      'TIGERIQ_EXECUTABLE=true',
      'OWNER_POLICY=AUTO',
      'AUTO_QUEUE=INCLUDED',
      'PRIORITY=P0',
      'STATE=WAIT_DEPENDENCY',
      'DEPENDS_ON=#1900',
    ].join('\n')));
    expect(row).toMatchObject({ status: 'WAITING', waitReason: 'WAIT_DEPENDENCY', dependencies: [1900] });
  });

  it('keeps OWNER_HOLD visible as WAITING and records declared dependencies', () => {
    const row = parseQueueIssue(issue(2004, '[P0] Chờ Owner', [
      'TIGERIQ_EXECUTABLE=true',
      'OWNER_POLICY=AUTO',
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

  it('orders OWNER_DIRECT before P0, then P1/P2/P3 and issue number', () => {
    const rows = [
      { number: 30, priority: 'P0', ownerDirect: false },
      { number: 20, priority: 'P1', ownerDirect: true },
      { number: 10, priority: 'P0', ownerDirect: true },
      { number: 40, priority: 'P1', ownerDirect: false },
      { number: 50, priority: 'P3', ownerDirect: false },
    ].sort(compareQueueRows);
    expect(rows.map((row) => row.number)).toEqual([10, 20, 30, 40, 50]);
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
