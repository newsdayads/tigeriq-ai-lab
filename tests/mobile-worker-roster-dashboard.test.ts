import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Execute the actual pure dashboard helper, without starting a web server or touching PC01.
const html = readFileSync(new URL('../apps/tigeriq-core/dashboard.html', import.meta.url), 'utf8');
const start = html.indexOf('function applyMobileWorkers(rows,mobileWorkers)');
const end = html.indexOf('function applyPendingQa(', start);
const implementation = start >= 0 && end > start ? html.slice(start, end) : '';
const applyMobileWorkers = new Function(implementation + '\nreturn applyMobileWorkers;')() as
  (rows: any[], mobiles: any[]) => any[];
const at = new Date(Date.now() - 15000).toISOString();
const ago = '2026-10-06T05:33:19.000Z';
const mobile = (employeeId: string, values: Record<string, unknown> = {}) => ({
  employeeId, source: 'core_mobile_devices', online: true, connectionStatus: 'ONLINE',
  heartbeatAt: at, agentVersion: '0.27.0-nv02-core-guard',
  acceptanceStatus: 'NOT_VERIFIED_20_TASKS', ...values,
});

describe('GH-5259 R11 Owner Dashboard uses actual Core mobile device presence', () => {
  it('keeps the actual helper in source and provides an Android acceptance label', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(html).toContain("['Nghiệm thu Android'");
    expect(html).toContain('CHƯA NGHIỆM THU 20 TÁC VỤ');
  });

  it('shows NV101/NV102/NV103 even without Registry slots or generic API resources', () => {
    const roster = [{ employee_id: 'NV03', status: 'READY', name: 'Review UI' }];
    const got = applyMobileWorkers(roster, [
      mobile('NV102'), mobile('NV101', { online: false, connectionStatus: 'OFFLINE', heartbeatAt: ago }),
      mobile('NV103', { online: false, connectionStatus: 'OFFLINE', heartbeatAt: ago }),
    ]);
    expect(got).toHaveLength(4);
    expect(got[0]).toEqual(roster[0]);
    expect(got.slice(1).map(x => x.employee_id)).toEqual(['NV102', 'NV101', 'NV103']);
    expect(got[1]).toMatchObject({
      resource_class: 'mobile_worker', status: 'MOBILE_ONLINE', mobile_live: true,
      current_job_id: null, core_mobile_source: 'core_mobile_devices',
      mobile_acceptance_status: 'NOT_VERIFIED_20_TASKS',
    });
    expect(got.slice(2).map(x => x.status)).toEqual(['MOBILE_OFFLINE', 'MOBILE_OFFLINE']);
  });

  it('updates an existing Core mobile card once and never fabricates a running job', () => {
    const before = [{ employee_id: 'NV102', name: 'Existing Device', current_job_id: 'old-pointer' }];
    const got = applyMobileWorkers(before, [
      mobile('NV102'), mobile('NV102', { online: false, connectionStatus: 'OFFLINE' }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      employee_id: 'NV102', name: 'Existing Device', current_job_id: null,
      status: 'MOBILE_ONLINE', live_resource: true, resource_class: 'mobile_worker',
    });
    expect(before[0].current_job_id).toBe('old-pointer');
  });

  it('rejects untrusted provenance, invalid IDs and contradictory/stale heartbeat', () => {
    const oldOnline = mobile('NV104', { heartbeatAt: ago });
    const contradictory = mobile('NV105', { connectionStatus: 'OFFLINE' });
    const future = mobile('NV106', { heartbeatAt: new Date(Date.now() + 120000).toISOString() });
    const got = applyMobileWorkers([], [
      mobile('NV999', { source: 'user_input' }),
      mobile('../../NV102'), mobile('NV02'), mobile('not-an-id'), oldOnline,
      contradictory, future, mobile('NV107', { agentVersion: '<img-onerror>' }),
    ]);
    expect(got.map(x => x.employee_id)).toEqual(['NV104', 'NV105', 'NV106', 'NV107']);
    expect(got.slice(0, 3).every(x => x.mobile_live === false && x.status === 'MOBILE_OFFLINE')).toBe(true);
    expect(got[3].mobile_worker_version).toBeNull();
  });

  it('does not trust forged 20/20 completed claims or create a job/lease', () => {
    const [got] = applyMobileWorkers([], [mobile('NV102', { acceptanceStatus: 'VERIFIED_20_TASKS' })]);
    expect(got.mobile_acceptance_status).toBe('UNVERIFIED');
    expect(got.current_job_id).toBeNull();
    expect(got.status).toBe('MOBILE_ONLINE');
  });
});
