import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-ignore: Production ESM has no TypeScript declarations; vitest resolves Node source.
import { parseQueueIssue, sanitizeRuntimePayload, attachCoreUiAssignmentReceipts } from '../api/live-status.mjs';

const issue = (number: number, body: string) => ({
  number, state: 'open', title: '[P1] Assigned bounded work', body,
  html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/' + number,
  updated_at: '2026-10-18T04:00:00Z',
});
const flags = ['PRIORITY=P1', 'OWNER_POLICY=AUTO', 'TIGERIQ_EXECUTABLE=true',
  'AUTO_QUEUE=INCLUDED', 'NO_CODE_CHANGE=true', 'NO_PC01_SHELL=true'].join('\n');

describe('P1 #4573 safe modern-main port: independent Core assignment evidence', () => {
  it('fails closed on canonical disabled execution even when old metadata appends a true value', () => {
    const body = flags.replace('TIGERIQ_EXECUTABLE=true', 'TIGERIQ_EXECUTABLE=false')
      + '\nTIGERIQ_EXECUTABLE=true';
    expect(parseQueueIssue(issue(3904, body))).toBe(null);
  });

  it('fails closed on canonical excluded work despite stale included metadata', () => {
    const body = flags.replace('AUTO_QUEUE=INCLUDED', 'AUTO_QUEUE=EXCLUDED_WAIT_DEPENDENCY_REAL_GATE')
      + '\nAUTO_QUEUE=INCLUDED';
    expect(parseQueueIssue(issue(2788, body))).toBe(null);
  });

  it('leaves a legitimately admitted P1 item eligible for the normal queue', () => {
    expect(parseQueueIssue(issue(4578, flags))).toMatchObject({ number: 4578, status: 'QUEUED' });
  });

  it('sanitizes actual Core receipts while refusing forged jobs and keeping working count zero', () => {
    const payload = sanitizeRuntimePayload({
      ok: true, generatedAt: '2026-10-18T04:00:00Z', workers:[],
      source: { core: true, coding: true, uiAutopilot: false },
      coreUiAssignments: [
        {issueNumber: 3278, jobId:'GH-3278-R10b0547ec27a', employeeId:'NV03', status:'ui_assigned'},
        {issueNumber: 3278, jobId:'GH-3278-R000000000000', employeeId:'NV04', status:'ui_running'},
        {issueNumber: 4457, jobId:'INVALID', employeeId:'NV03', status:'ui_running'},
        {issueNumber: 4565, jobId:'GH-4565-R0123456', employeeId:'NV02', status:'ui_assigned'},
        {issueNumber: 4557, jobId:'GH-4557-R0123456', employeeId:'NV04', status:'queued'},
      ],
    });
    expect(payload.summary.working).toBe(0);
    expect(payload.workers).toHaveLength(0);
    expect(payload.coreUiAssignments).toHaveLength(1);
    expect(payload.coreUiAssignments[0]).toMatchObject({
      issueNumber:3278, employeeId:'NV03',status:'ui_assigned',startedAt:null,
    });
  });

  it('does not accept supposed Core assignment receipts while the Core source is offline', () => {
    const out = sanitizeRuntimePayload({
      ok:true, workers:[], source:{core:false}, coreUiAssignments:[
        {issueNumber:3278,jobId:'GH-3278-R10b0547ec27a',employeeId:'NV03',status:'ui_assigned'},
      ],
    });
    expect(out.coreUiAssignments).toHaveLength(0);
    expect(out.summary.working).toBe(0);
  });

  it('annotates a real project row without rewriting GitHub review status or lease metadata', () => {
    const rows = [{number:3278,status:'REVIEW',employeeId:'NONE',activeLease:false},
      {number:4457,status:'BLOCKED',employeeId:null,activeLease:false}];
    const got = attachCoreUiAssignmentReceipts(rows, [
      {issueNumber:3278,jobId:'GH-3278-R10b0547ec27a',employeeId:'NV03',status:'ui_assigned'},
    ]);
    expect(got[0]).toMatchObject({
      number:3278,status:'REVIEW',employeeId:'NONE',activeLease:false,
      coreAssignment:{employeeId:'NV03',status:'ui_assigned'},
    });
    expect(got[1]).toMatchObject({status:'BLOCKED',activeLease:false,coreAssignment:null});
  });

  it('does not attach spoofed receipts or mutate an empty collection', () => {
    const rows = [{number:3278,status:'WAITING'}];
    expect(attachCoreUiAssignmentReceipts(rows, [{
      issueNumber:3278,jobId:'INVALID',employeeId:'NV03',status:'ui_running',
    }])[0].coreAssignment).toBe(null);
    expect(attachCoreUiAssignmentReceipts(null, [])).toEqual([]);
  });

  it('executes the bridge extractor in isolation without starting a server or touching PC01', () => {
    // Source is the checked-in trusted server. Isolate only the side-effect-free
    // helper so tests exercise the actual bridge implementation, never .listen().
    const source = readFileSync(new URL('../apps/tigeriq-live-bridge/server.mjs', import.meta.url),'utf8');
    const start = source.indexOf('function extractCoreUiAssignments(core) {');
    const end = source.indexOf('\nasync function snapshot(){', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const trustedHelperSource = source.slice(start, end);
    const extract = new Function(trustedHelperSource + '\nreturn extractCoreUiAssignments;')() as (x:any)=>any[];
    expect(extract(null)).toEqual([]);
    const values=extract({jobs:[
      {id:'GH-3278-Rabc',employee_id:'NV03',status:'ui_assigned',updated_at:'2026-10-18T04:00:00Z'},
      {id:'GH-3278-Rnew',employee_id:'NV04',status:'ui_running',updated_at:'2026-10-18T05:00:00Z'},
      {id:'GH-999-Rbad',employee_id:'NV02',status:'ui_running'},
      {id:'GH-777-Rbad',employee_id:'NV03',status:'queued'},
      {id:'GH-777-Rok',employee_id:'NV04',status:'failed'},
    ]});
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({issueNumber:3278,employeeId:'NV04',status:'ui_running'});
    expect(values[1]).toMatchObject({issueNumber:777,employeeId:'NV04',status:'failed'});
  });

  it('retains 22 newer .mjs suite entries on main without replacing vitest configuration', () => {
    const cfg=readFileSync(new URL('../vitest.config.ts', import.meta.url),'utf8');
    for(const key of [
      'tests/shared-resource-lease.test.mjs',
      'tests/pc01-updater-release-gate.test.mjs',
      'tests/core-watchdog-snapshot-integration.test.mjs',
      'tests/core-4457-manager-pg-lock.test.mjs',
      'tests/nv07-native-session-broker.test.mjs',
      "'tests/**/*.test.ts'",
    ]) expect(cfg).toContain(key);
  });

  it('preserves modern owner UI checklist and audit and only appends distinct Core evidence', () => {
    const ui=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
    expect(ui).toContain('TigerIQWorkCenter.renderAudit(');
    expect(ui).toContain('progressChecklistVerified===true');
    expect(ui).toContain('woCoreAssignment(row)');
    expect(ui).toContain('CHƯA XÁC MINH HEARTBEAT');
  });
});


describe('P1 #4999 follow-up: GitHub issue identity must match the Core job ID', () => {
  it('rejects mismatched issueNumber and jobId at the runtime JSON sanitizer', () => {
    const out = sanitizeRuntimePayload({
      ok: true, generatedAt: '2026-10-18T04:00:00Z', workers: [],
      source: { core: true },
      coreUiAssignments: [
        { issueNumber: 3278, jobId: 'GH-4457-Rwrong', employeeId: 'NV03', status: 'ui_assigned' },
        { issueNumber: 3278, jobId: 'GH-3278-Rcorrect', employeeId: 'NV04', status: 'ui_assigned' },
      ],
    });
    expect(out.summary.working).toBe(0);
    expect(out.coreUiAssignments).toHaveLength(1);
    expect(out.coreUiAssignments[0]).toMatchObject({
      issueNumber: 3278, jobId: 'GH-3278-Rcorrect', employeeId: 'NV04',
    });
  });

  it('never attaches a different issue job to a GitHub work row', () => {
    const rows = [{ number: 3278, status: 'REVIEW', employeeId: 'NONE', activeLease: false }];
    const got = attachCoreUiAssignmentReceipts(rows, [
      { issueNumber: 3278, jobId: 'GH-4457-Rwrong', employeeId: 'NV03', status: 'ui_running' },
    ]);
    expect(got[0]).toMatchObject({
      status: 'REVIEW', employeeId: 'NONE', activeLease: false, coreAssignment: null,
    });
  });

  it('keeps matching Core job IDs as read-only UI receipts without changing work state', () => {
    const rows = [{ number: 3278, status: 'BLOCKED', employeeId: null, activeLease: false }];
    const got = attachCoreUiAssignmentReceipts(rows, [
      { issueNumber: 3278, jobId: 'GH-3278-Rcorrect', employeeId: 'NV03', status: 'ui_assigned' },
    ]);
    expect(got[0]).toMatchObject({
      status: 'BLOCKED', activeLease: false,
      coreAssignment: { jobId: 'GH-3278-Rcorrect', employeeId: 'NV03', status: 'ui_assigned' },
    });
  });
});


describe('GH-5257 R11 Mobile Worker evidence stays separate and fail-closed', () => {
  const observed = '2026-10-23T20:43:39.828Z';
  const mobile = [
    { employeeId: 'NV102', source: 'core_mobile_devices', online: true, connectionStatus: 'ONLINE',
      agentVersion: '0.27.0-nv02-core-guard', heartbeatAt: '2026-10-23T20:43:18.000Z',
      acceptanceStatus: 'NOT_VERIFIED_20_TASKS' },
    { employeeId: 'NV101', source: 'core_mobile_devices', online: false, connectionStatus: 'OFFLINE',
      agentVersion: '0.24.0-pause-resume', heartbeatAt: '2026-10-06T05:33:19.000Z' },
    { employeeId: 'NV103', source: 'core_mobile_devices', online: false, connectionStatus: 'OFFLINE',
      agentVersion: '0.26.0-vn-new-chat', heartbeatAt: '2026-10-06T12:33:21.000Z' },
  ];

  function bridgeExtract() {
    const source = readFileSync(new URL('../apps/tigeriq-live-bridge/server.mjs', import.meta.url), 'utf8');
    const start = source.indexOf('function extractCoreMobileWorkers(core, generatedAt');
    const end = source.indexOf('\nasync function snapshot(){', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const implementation = source.slice(start, end);
    return new Function(implementation + '\nreturn extractCoreMobileWorkers;')() as
      (core: unknown, generatedAt: string) => any[];
  }

  it('projects real NV101/102/103 snapshots without making any Mobile Worker a UI/API job', () => {
    const extract = bridgeExtract();
    const rows = extract({ ok: true, mobileWorkers: mobile }, observed);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ employeeId: 'NV102', kind: 'mobile', online: true,
      heartbeatFresh: true, acceptanceStatus: 'NOT_VERIFIED_20_TASKS' });
    expect(rows[1]).toMatchObject({ employeeId: 'NV101', online: false, connectionStatus: 'OFFLINE' });
    const projection = sanitizeRuntimePayload({
      ok: true, generatedAt: observed, source: { core: true, coding: true }, workers: [],
      mobileWorkers: rows,
    });
    expect(projection.summary.total).toBe(0);
    expect(projection.activeWork).toEqual([]);
    expect(projection.mobileWorkers).toHaveLength(3);
    expect(projection.mobileWorkers[0]).toMatchObject({employeeId: 'NV102', online: true,
      acceptanceStatus: 'NOT_VERIFIED_20_TASKS'});
  });

  it('refuses stale ONLINE, invalid source, duplicated identities and malformed records', () => {
    const extract = bridgeExtract();
    const rows = extract({ok:true, mobileWorkers:[
      {...mobile[0], heartbeatAt:'2026-10-23T19:00:00Z', acceptanceStatus:'VERIFIED_20_TASKS'},
      mobile[0], {...mobile[0], employeeId:'NV999', source:'untrusted'},
      {...mobile[0], employeeId:'../../NV102', source:'core_mobile_devices'},
      {...mobile[0], employeeId:'NV105', agentVersion:'<unsafe>'},
    ]}, observed);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({employeeId:'NV102', online:false, connectionStatus:'UNKNOWN',
      acceptanceStatus:'NOT_VERIFIED_20_TASKS'});
    expect(rows[1]).toMatchObject({employeeId:'NV105', agentVersion:null});
    expect(extract({ok:false,mobileWorkers:mobile},observed)).toEqual([]);
  });

  it('revalidates Core source, freshness and completion claims at the server boundary', () => {
    const row={ employeeId:'NV102',kind:'mobile',source:'core_mobile_devices',online:true,
      connectionStatus:'ONLINE',heartbeatAt:'2026-10-23T18:00:00Z',
      agentVersion:'0.27.0-nv02-core-guard',acceptanceStatus:'VERIFIED_20_TASKS'};
    const projection=sanitizeRuntimePayload({ok:true,generatedAt:observed,
      source:{core:true},workers:[],mobileWorkers:[row, {...row,employeeId:'NV102'}]});
    expect(projection.mobileWorkers).toHaveLength(1);
    expect(projection.mobileWorkers[0]).toMatchObject({online:false,connectionStatus:'UNKNOWN',
      acceptanceStatus:'NOT_VERIFIED_20_TASKS'});
    expect(sanitizeRuntimePayload({ok:true,generatedAt:observed,source:{core:false},
      workers:[],mobileWorkers:[{...row,heartbeatAt:observed}]}).mobileWorkers).toEqual([]);
  });
});
