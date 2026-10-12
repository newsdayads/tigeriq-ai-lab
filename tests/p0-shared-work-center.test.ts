// @ts-nocheck — companion ESM tests run with Vitest; JS-only modules have no declaration files.
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import '../public/work-center.js';
import {completionProof,buildWorkHistory,recentCommentPages,latestComments} from '../apps/shared/work-center-history.mjs';
import {parseRecentCompletedIssue} from '../api/live-status.mjs';

const wc=globalThis.TigerIQWorkCenter;
const url='https://github.com/newsdayads/tigeriq-ai-lab/issues/990001';
const validBody=[
 '## ACTIVE',
 'WORK_ORDER_LIFECYCLE=V2','PROJECT_ID=tigeriq-platform','WORKSTREAM_ID=work-center',
 'CURRENT_STATE=COMPLETED','CURRENT_STEP=M02 — Nghiệm thu','LAST_COMPLETED_STEP=M02','NEXT_ACTION=Đã hoàn tất',
 'BLOCKER=NONE','RESOURCE_SCOPE=TEST_WC_990001','MUTATION_OWNER=NONE',
 'ETA_STATUS=UNVERIFIED','STARTED_AT=2026-10-12T11:00:00Z','FINISHED_AT=2026-10-12T11:30:00Z',
 'START_RECEIPT_URL='+url+'#issuecomment-10',
 'FINISH_RECEIPT_URL='+url+'#issuecomment-20','DONE=true',
 '## STRUCTURED_PROGRESS_CHECKLIST',
 '- [x] M01 — kiểm thử [bằng chứng]('+url+'#issuecomment-10)',
 '- [x] M02 — nghiệm thu [bằng chứng]('+url+'#issuecomment-20)',
 '## ACCEPTANCE','Bằng chứng đầy đủ.','## STOP_CONDITIONS','Không chi phí hoặc cấp quyền.'
].join('\n');
const issue=(body=validBody,extra={})=>({number:990001,title:'[P0] Kiểm tra module',body,
 state:'closed',state_reason:'completed',created_at:'2026-10-12T10:59:00Z',
 closed_at:'2026-10-12T11:31:00Z',updated_at:'2026-10-12T11:31:00Z',
 html_url:url,user:{login:'newsdayads'},...extra});

describe('TigerIQ Work Center V1 — one shared source of truth',()=>{
 it('exposes canonical shared status, filters and strict verified finish',()=>{
  expect(wc.version).toBe('1.0.0');
  expect(wc.status({status:'ĐANG LÀM'})).toBe('WORKING');
  expect(wc.viewStatus({status:'DONE'})).toBe('VERIFY');
  expect(wc.progress({status:'DONE',progressSource:'terminal',progressPercent:100}).verified).toBe(false);
  const row={status:'DONE',completionVerified:true,progressPercent:100,progressSource:'terminal'};
  expect(wc.progress(row)).toMatchObject({verified:true,percent:100});
  expect(wc.rowsFor({openWork:[{workKind:'WORK',status:'WAITING'},{workKind:'WORK',status:'WORKING'}]},'action')).toHaveLength(2);
  expect(wc.rowsFor({recentWork:[{status:'DONE',completionVerified:false},{status:'DONE',completionVerified:true}]},'done')).toHaveLength(1);
 });
 it('rejects Issue closed and metadata-only completion without independent receipts',()=>{
  expect(completionProof(issue('STATE=DONE')).verified).toBe(false);
  expect(parseRecentCompletedIssue(issue('STATE=DONE'))).toBeNull();
  expect(completionProof(issue(validBody.replace('FINISH_RECEIPT_URL='+url+'#issuecomment-20','FINISH_RECEIPT_URL=NOT_AVAILABLE'))).verified).toBe(false);
  expect(completionProof(issue(validBody,{state_reason:'not_planned'})).verified).toBe(false);
 });
 it('accepts only a complete V2 finish and provides timestamps',()=>{
  const proof=completionProof(issue());
  expect(proof.verified).toBe(true);
  expect(proof.verifiedSteps).toBe(2);
  const row=parseRecentCompletedIssue(issue(),Date.parse('2026-10-12T12:00:00Z'));
  expect(row).toMatchObject({status:'DONE',completionVerified:true,progressPercent:100,progressSource:'terminal',progressTotal:2});
  expect(row.lifecycleTiming.finishVerified).toBe(true);
 });
 it('loads last two comment pages only and returns the most recent 100 comments',()=>{
  expect(recentCommentPages(0)).toEqual([1]);
  expect(recentCommentPages(100)).toEqual([1]);
  expect(recentCommentPages(101)).toEqual([1,2]);
  expect(recentCommentPages(520)).toEqual([5,6]);
  const first=Array.from({length:100},(_,i)=>({id:i+1}));
  const second=Array.from({length:20},(_,i)=>({id:i+101}));
  const recent=latestComments([first,second]);
  expect(recent).toHaveLength(100);
  expect(recent[0].id).toBe(21);
  expect(recent[99].id).toBe(120);
 });
 it('separates comment author from AI executor and never invents start time',()=>{
  const history=buildWorkHistory(issue(),[
   {body:'CURRENT_STATE=WORKING\nCURRENT_STEP=M01 — Viết mã',user:{login:'reviewer'},created_at:'2026-10-12T11:14:00Z',html_url:url+'#issuecomment-10'},
   {body:'CURRENT_STATE=REVIEW\nCURRENT_STEP=M02 — Kiểm tra\nEXECUTOR_ID=NV09',user:{login:'reviewer'},created_at:'2026-10-12T11:26:00Z',html_url:url+'#issuecomment-20'}
  ]);
  expect(history.ok).toBe(true);
  expect(history.events.some(x=>x.author==='reviewer (người ghi nhật ký)')).toBe(true);
  expect(history.events.find(x=>x.action==='REVIEW').executor).toBeNull();
  expect(history.events.some(x=>x.action==='Nghiệm thu hoàn tất')).toBe(true);
 });
 it('uses same assets and component entrypoints for all three surfaces',()=>{
  const live=readFileSync(new URL('../command-center.html',import.meta.url),'utf8');
  const mirror=readFileSync(new URL('../public/command-center.html',import.meta.url),'utf8');
  const health=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
  const web=readFileSync(new URL('../apps/tigeriq-core/web-control.html',import.meta.url),'utf8');
  const webServer=readFileSync(new URL('../apps/tigeriq-core/web-control-server.mjs',import.meta.url),'utf8');
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  expect(live).toBe(mirror);
  for(const s of [live,health,web])expect(s).toContain('TigerIQWorkCenter.renderCards');
  expect(live).toContain('TigerIQWorkCenter.mountFloatingReload()');
  expect(live).not.toContain('<button id="reloadPage" class="reload-page"');
  expect(live).toContain('id="drawerAudit"');
  expect(health).toContain('id="workDetailAudit"');
  expect(web).toContain('id="workCenterWeb"');
  expect(core).toContain("url.pathname==='/work-center.js'");
  expect(webServer).toContain("url.pathname==='/work-center.js'");
  expect(core).toContain("url.pathname==='/api/work-history'");
 });
});
