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
