import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import '../public/work-center.js';
import {completionProof,buildWorkHistory} from '../apps/shared/work-center-history.mjs';
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
 it('keeps four summary views and never counts a closed-only issue as done',()=>{
  const open=[{number:1,workKind:'WORK',status:'WORKING',activeLease:true,heartbeatFresh:true},{number:2,workKind:'WORK',status:'REVIEW'},{number:3,workKind:'WORK',status:'BLOCKED'}];
  const recent=[{number:4,workKind:'WORK',status:'DONE',completionVerified:true},{number:5,workKind:'WORK',status:'CLOSED_UNVERIFIED',completionVerified:false}];
  const data={openWork:open,recentWork:recent};
  expect(wc.rowsFor(data,'all').map(x=>x.number)).toEqual([1,2,3,4,5]);
  expect(wc.rowsFor(data,'action').map(x=>x.number)).toEqual([1,2,3]);
  expect(wc.rowsFor(data,'action').every(x=>!x.closed)).toBe(true);
  expect(wc.rowsFor(data,'working').map(x=>x.number)).toEqual([1]);
  expect(wc.rowsFor(data,'waitblocked').map(x=>x.number)).toEqual([2,3]);
  expect(wc.rowsFor(data,'closed').map(x=>x.number)).toEqual([4,5]);
  expect(wc.progress(recent[1]).verified).toBe(false);
 });
 it('defaults to unfinished work on all three surfaces and preserves ended history as a separate tab',()=>{
  const live=readFileSync(new URL('../command-center.html',import.meta.url),'utf8');
  const mirror=readFileSync(new URL('../public/command-center.html',import.meta.url),'utf8');
  const health=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
  const web=readFileSync(new URL('../apps/tigeriq-core/web-control.html',import.meta.url),'utf8');
  expect(live).toBe(mirror);
  expect(live).toContain("let currentFilter='action'");
  expect(live).toContain('data-filter="action">CHƯA KẾT THÚC');
  expect(live).toContain("const filters=['action','working','waitblocked','closed']");
  expect(health).toContain("workFilter='action'");
  expect(health).toContain("['action','CHƯA KẾT THÚC']");
  expect(web).toContain("let workCenterWebFilter='action'");
  expect(web).toContain('data-work-center-filter="action">CHƯA KẾT THÚC');
  for(const source of [live,health,web])expect(source).toContain('ĐÃ KẾT THÚC');
 });
 it('bundles the three shared Work Center assets for PC01 Web Control',()=>{
  const launcher=readFileSync(new URL('../scripts/tigeriq-core/run-web-control-bundle.ps1',import.meta.url),'utf8');
  const server=readFileSync(new URL('../apps/tigeriq-core/web-control-server.mjs',import.meta.url),'utf8');
  for(const file of ['work-center.js','work-ui.css','work-center-visual.css']){
   expect(launcher).toContain("'"+file+"'");
   expect(server).toContain("sharedWorkAsset('"+file+"'");
  }
  expect(launcher).toContain('WEB_CONTROL_SHARED_ASSET_MISSING');
  expect(server).toContain("new URL('./'+name,import.meta.url)");
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
