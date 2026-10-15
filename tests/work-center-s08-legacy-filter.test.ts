import { expect, it } from 'vitest';
// @ts-ignore Runtime source file intentionally has no TypeScript declaration bundle.
import { projectWorkOrder, webControlWorkOrderCandidate } from '../apps/tigeriq-core/web-control-server.mjs';

const sample = (): any => {
  const checklist = Array.from({length:16},(_,i) => '- ['+(i<6?'x':' ')+'] R'+String(i).padStart(2,'0')+' — Mốc nghiệm thu').join('\n');
  return {
    number:4780,
    title:'[P2][ENGINEERING] REA — tích hợp phân tích phần mềm',
    state:'open',labels:[],updated_at:'2026-10-15T11:15:24Z',
    body:'RESOURCE_SCOPE=TIGERIQ_REA_RECONSTRUCTION_LAB_V1\nCURRENT_STEP=R05 — Xác minh danh tính và quyền thực thi\nDONE=false\nACTIVE_EXECUTION=false\n\n## STRUCTURED_PROGRESS_CHECKLIST\n'+checklist
  };
};

it('S08 Web Control includes #4780 scoped legacy Work Order without TIGERIQ_EXECUTABLE', () => {
  const x=sample();
  expect(x.body).not.toContain('TIGERIQ_EXECUTABLE=');
  expect(webControlWorkOrderCandidate(x)).toBe(true);
  const r=projectWorkOrder(x);
  expect(r.number).toBe(4780);
  expect(r.progressCompleted).toBe(6);
  expect(r.progressTotal).toBe(16);
  expect(r.progressPercent).toBe(38);
  expect(r.currentStep).toMatch(/^R05/);
  expect(r.status).not.toBe('DONE');
  expect(r.bucket).not.toBe('ĐANG LÀM');
});
it('S08 Web Control rejects unstructured or pull-request records', () => {
  const base:any={number:9999,title:'Regular issue',state:'open',labels:[],body:'RESOURCE_SCOPE=DEMO\nCURRENT_STEP=R01 — idea'};
  expect(webControlWorkOrderCandidate(base)).toBe(false);
  expect(webControlWorkOrderCandidate({...base,body:base.body+'\n## STRUCTURED_PROGRESS_CHECKLIST\nNo steps'})).toBe(false);
  expect(webControlWorkOrderCandidate({...sample(),pull_request:{url:'https://github.com/example/pull/1'}})).toBe(false);
  expect(webControlWorkOrderCandidate(null)).toBe(false);
});
it('S08 explicit executable false/true and policy system remain eligible', () => {
  const base:any={number:123,title:'Generic Work Order',state:'open',labels:[],body:'TIGERIQ_EXECUTABLE=true'};
  expect(webControlWorkOrderCandidate(base)).toBe(true);
  expect(webControlWorkOrderCandidate({...base,body:'TIGERIQ_EXECUTABLE=false'})).toBe(true);
  expect(webControlWorkOrderCandidate({...base,body:'TIGERIQ_EXECUTABLE=TRUE'})).toBe(false);
  expect(webControlWorkOrderCandidate({...base,number:504,title:'[P0][QUẢN TRỊ] Chính sách',body:'CURRENT_STATE=POLICY_REVIEW'})).toBe(true);
});
it('S08 scoped legacy checklist requires both scope and current step', () => {
  const body='## STRUCTURED_PROGRESS_CHECKLIST\n- [x] R01 — checked';
  const base:any={number:9998,title:'Legacy note',state:'open',labels:[],body};
  expect(webControlWorkOrderCandidate(base)).toBe(false);
  expect(webControlWorkOrderCandidate({...base,body:'RESOURCE_SCOPE=DEMO\n'+body})).toBe(false);
  expect(webControlWorkOrderCandidate({...base,body:'CURRENT_STEP=R02\n'+body})).toBe(false);
  expect(webControlWorkOrderCandidate({...base,body:'RESOURCE_SCOPE=DEMO\nCURRENT_STEP=R02\n'+body})).toBe(true);
});

it('S08 legacy #4780 without executable flag is a WORK, never SYSTEM', () => {
  const x=sample();
  x.body='CURRENT_STATE=PLANNED_AWAITING_SCOPED_DEVICE_AND_WRITER_VERIFICATION\n'+x.body;
  const r=projectWorkOrder(x);
  expect(webControlWorkOrderCandidate(x)).toBe(true);
  expect(r.workKind).toBe('WORK');
  expect(r.bucket).toBe('CẦN XỬ LÝ');
  expect(r.status).toBe('OPEN');
  expect(r.progressCompleted).toBe(6);expect(r.progressTotal).toBe(16);
  expect(r.completionVerified).toBe(false);
});
it('S08 #504 policy title remains SYSTEM even if legacy STATE contains UNBLOCKED', () => {
  const x:any={number:504,title:'[P0][QUẢN TRỊ] Chính sách tương tác',state:'open',labels:[],
    body:'TIGERIQ_EXECUTABLE=true\nCURRENT_STATE=P0_SOURCE_PATCH_DRAFT_PR_PENDING_TEST_REVIEW\nSTATE=READ_ONLY_PATH_UNBLOCKED_BY_POLICY\nDONE=false'};
  const r=projectWorkOrder(x);
  expect(r.workKind).toBe('SYSTEM');expect(r.bucket).toBe('HỆ THỐNG');
  expect(r.status).toBe('SYSTEM');
  expect(r.completionVerified).toBe(false);
});
it('S08 UNBLOCKED does not match BLOCKED while actual blocked state remains blocked', () => {
  const base:any={...sample(),body:'TIGERIQ_EXECUTABLE=true\nRESOURCE_SCOPE=TIGERIQ_P1\nCURRENT_STATE=READY_UNBLOCKED_AFTER_CHECK\nDONE=false'};
  expect(projectWorkOrder(base).bucket).not.toBe('BỊ CHẶN');
  expect(projectWorkOrder({...base,body:base.body.replace('READY_UNBLOCKED_AFTER_CHECK','BLOCKED_EXTERNAL_DEPENDENCY')}).bucket).toBe('BỊ CHẶN');
});
it('S08 explicit false remains non-executable; absent flag with real checklist is distinct', () => {
  const x:any=sample();
  const legacy=projectWorkOrder(x);
  const disabled=projectWorkOrder({...x,body:'TIGERIQ_EXECUTABLE=false\n'+x.body});
  expect(legacy.bucket).not.toBe('HỆ THỐNG');
  expect(disabled.bucket).toBe('HỆ THỐNG');
  expect(disabled.status).not.toBe('WORKING');
});
