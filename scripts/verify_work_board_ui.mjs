import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const publicView = readFileSync('command-center.html', 'utf8');
const deployedView = readFileSync('public/command-center.html', 'utf8');
const liveApi = readFileSync('api/live-status.mjs', 'utf8');
const config = JSON.parse(readFileSync('vercel.json', 'utf8'));

assert.equal(existsSync('public/index.html'), false);
assert.equal(config?.cleanUrls, true);
assert.equal(config?.rewrites?.find((route) => route?.source === '/')?.destination, '/command-center');
assert.equal(deployedView, publicView, 'Vercel public command-center must match canonical TigerIQ Live view');

assert.match(publicView, /TigerIQ Live/);
assert.match(publicView, /DANH SÁCH CÔNG VIỆC/);
assert.match(publicView, /aria-label="STT · Work Order · Tên việc · NV thực hiện \/ Owner · Trạng thái"/);
assert.match(publicView, /width:19px;height:19px/);
assert.match(publicView, /padStart\(2,'0'\)/);
assert.match(publicView, /function displayTitle/);
assert.match(publicView, /api\/live-status/);
assert.match(publicView, /ĐANG LÀM/);
assert.match(publicView, /ĐANG RÀ SOÁT/);
assert.match(publicView, /SẴN SÀNG/);
assert.match(publicView, /BỊ CHẶN/);
assert.match(publicView, /HOÀN TẤT/);
assert.match(publicView, /setInterval\(.*10000/);
assert.match(publicView, /PC01 LIVE/);
assert.match(publicView, /DỮ LIỆU CŨ/);
assert.match(publicView, /CẦN XỬ LÝ/);
assert.match(publicView, /CHỜ ANH SƠN/);
// Owner V2.3: waiting and blocked are separate, truthful filter buckets.
for (const bucket of ['waiting','blocked','review','verify','paused']) {
  assert.match(publicView, new RegExp('data-filter="'+bucket+'"'));
}
assert.doesNotMatch(publicView, /CHỜ \/ BỊ CHẶN <b/);
for (const [status,color] of Object.entries({
  OWNER_GATE:'#A78BFA',WORKING:'#10B981',REVIEW:'#3B82F6',
  VERIFY:'#14B8A6',WAITING:'#F59E0B',BLOCKED:'#F43F5E',
  DONE:'#06B6D4',PAUSED:'#64748B'
})) {
  assert.ok(publicView.includes(status+":'"+color+"'"), 'missing semantic status color '+status);
}
assert.match(publicView, /el\.style\.setProperty\('--status-color',STATUS_COLORS\[status\]/);
assert.match(publicView, /style\.setProperty\('--detail-color',STATUS_COLORS\[workStatus\(row\)\]/);
assert.match(publicView, /data-filter="owner"/);
assert.match(publicView, /data-filter="review"/);
assert.match(publicView, /data-filter="system"/);
assert.match(publicView, /data-filter="done"/);
assert.match(publicView, /progressPercent/);
assert.match(publicView, /tigeriq-live-open-progress-v2/);
assert.match(publicView, /tự cập nhật 10 giây/);
assert.match(publicView, /priority\.p0/);
assert.match(publicView, /priority\.p1/);
assert.match(publicView, /filter\[data-filter="running"\]\.active/);
assert.match(publicView, /work-row\.status-working::before/);
assert.match(publicView, /work-row\.status-blocked::before/);
assert.match(publicView, /status-owner_gate/);
assert.match(publicView, /state\.owner_gate/);
assert.match(publicView, /state\.verify/);
assert.match(publicView, /state\.system/);
assert.match(publicView, /font-size:13\.5px/);
assert.match(publicView, /font-size:11\.75px/);
assert.match(publicView, /height:8px/);
assert.match(publicView, /progress-shimmer/);
assert.match(publicView, /live-pulse/);
assert.match(publicView, /card-flash/);
assert.match(publicView, /prefers-reduced-motion:reduce/);
assert.match(publicView, /lastVisualState/);
assert.match(publicView, /currentStep/);
assert.match(publicView, /owner-summary/);
assert.match(publicView, /portfolioProgress/);
assert.match(publicView, /Chưa xác minh/);
assert.match(publicView, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(publicView, /max-width:1100px/);
assert.match(publicView, /max-width:700px/);
assert.match(publicView, /workDrawer/);
assert.match(publicView, /event\.key==='Tab'/);
assert.match(publicView, /function verifiedProgress/);
assert.match(publicView, /workKind==='WORK'/);
assert.match(publicView, /evidenceFresh=.*staleAll/);
assert.match(publicView, /refreshOpenDrawer\(\);\s*if\(!rows\.length\)/);
assert.match(publicView, /'terminal'/);
assert.match(publicView, /function effectiveBlocker/);
assert.match(publicView, /function refreshOpenDrawer/);
assert.match(publicView, /setAttribute\('inert'/);
assert.match(publicView, /removeAttribute\('inert'/);
assert.match(publicView, /data-work-number/);
assert.match(publicView, /ĐANG XỬ LÝ':'WORKING/);
assert.match(publicView, /DỮ LIỆU CŨ.*staleTime/);
assert.match(publicView, /row\.url\|\|row\.evidenceUrl/);
assert.match(publicView, /Mở GitHub/);
assert.match(publicView, /openDrawer/);
assert.match(publicView, /role','button'/);
assert.match(publicView, /working-live/);
assert.match(publicView, /prefers-reduced-motion:reduce/);
assert.doesNotMatch(publicView, /createElement\(targetUrl\?'a':'article'\)/);
assert.doesNotMatch(publicView, /<b>Vừa xong:<\/b>/);
assert.doesNotMatch(publicView, /<b>Bằng chứng:<\/b>/);
assert.doesNotMatch(publicView, /<b>Duyệt anh Sơn:<\/b>/);

for (const removed of [
  'KẾ TIẾP CÓ THỂ CHẠY',
  'CÔNG VIỆC ĐANG THỰC HIỆN',
  'THỨ TỰ CÓ THỂ GIAO',
  'ĐANG CHỜ / BỊ CHẶN',
  'NHỮNG VIỆC GẦN ĐÂY',
  'Trạng thái nhân sự',
  'Hàng đợi',
]) assert.doesNotMatch(publicView, new RegExp(removed, 'i'));
assert.doesNotMatch(publicView, /<h[1-6][^>]*>\s*Đang xử lý/i);

assert.doesNotMatch(publicView, /id=["']dispatch["']/);
assert.doesNotMatch(publicView, /GitHub token/i);
assert.match(liveApi, /REGISTRY_ISSUE = 335/);
assert.match(liveApi, /RUNTIME_POINTER_ISSUE = 1402/);
assert.match(liveApi, /mode: 'pc01-live'/);
assert.match(liveApi, /cache = \{ at: 0, value: null \}/);
assert.match(liveApi, /RECENT_WORK_LIMIT = 50/);
assert.doesNotMatch(liveApi, /RECENT_WORK_WINDOW_MS/);
assert.match(liveApi, /employeeId: issueEmployeeId\(issue\)/);
assert.match(liveApi, /per_page=100&sort=updated&direction=desc/);
assert.match(liveApi, /export function classifyOpenIssue/);
assert.match(liveApi, /export function parseOpenWorkIssue/);
assert.match(liveApi, /export function progressForIssue/);
assert.match(liveApi, /openWork/);
assert.match(liveApi, /openSummary/);
assert.match(liveApi, /OWNER_GATE: 0/);
assert.match(liveApi, /workKind: classification\.workKind/);
assert.match(liveApi, /owner: actionable\.filter/);
assert.match(liveApi, /system: openWork\.filter/);
const liveCatch = liveApi.indexOf("liveError = String(error instanceof Error ? error.message : error).slice(0, 120);");
const githubFallback = liveApi.indexOf("const value = await buildLiveStatus();", liveCatch);
const staleFallback = liveApi.indexOf("if (cache.value && now - cache.at < STALE_RESPONSE_MS)", githubFallback);
assert.ok(liveCatch >= 0 && githubFallback > liveCatch && staleFallback > githubFallback, 'fresh GitHub fallback must run before stale response cache');

// Feature gate: never infer step completion or percentages from an unverified issue.
const { checklistForIssue, executionPlanForIssue, progressForIssue, parseOpenWorkIssue, githubMilestoneSpec, githubMilestoneChecklist } = await import('../api/live-status.mjs');
const verifiedStepBody='PROGRESS_VERIFIED=true\n- [x] Phân tích yêu cầu\n- [x] Thiết kế phương án\n- [ ] Kiểm thử\n- [ ] Xác minh thực tế';
const verifiedStepIssue={number:987654,title:'[P1] Kiểm thử tiến độ',body:verifiedStepBody,state:'open',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/987654'};
const list=checklistForIssue(verifiedStepIssue);
assert.deepEqual({done:list.done,total:list.total,remaining:list.remaining,verified:list.verified},{done:2,total:4,remaining:2,verified:true});
assert.equal(list.steps[0].title,'Phân tích yêu cầu');
assert.equal(list.steps[2].done,false);
assert.deepEqual(progressForIssue(verifiedStepIssue,'WORKING'),{percent:50,source:'checklist_verified',detail:'2/4 bước xác minh'});
const row=parseOpenWorkIssue(verifiedStepIssue);
assert.equal(row.progressDone,2);assert.equal(row.progressTotal,4);assert.equal(row.progressRemaining,2);
assert.equal(row.progressSteps.length,4);
const unverifiedIssue={...verifiedStepIssue,body:verifiedStepBody.replace('PROGRESS_VERIFIED=true','')};
assert.equal(checklistForIssue(unverifiedIssue).verified,false);
assert.equal(progressForIssue(unverifiedIssue,'WORKING').percent,null);
const allCheckedIssue={...verifiedStepIssue,body:'PROGRESS_VERIFIED=true\n- [x] Bước 1\n- [x] Bước 2'};
assert.equal(progressForIssue(allCheckedIssue,'REVIEW').percent,null,'No 100% without DONE');
assert.equal(progressForIssue(allCheckedIssue,'DONE').percent,100);
const mixedBodyIssue={...verifiedStepIssue,body:'PROGRESS_SOURCE=VERIFIED\nPROGRESS_PERCENT=75\n- [x] A\n- [ ] B\n- [ ] C\n- [ ] D'};
assert.equal(progressForIssue(mixedBodyIssue,'WORKING').percent,25,'Checklist is the primary basis over freehand percent');
const fences={...verifiedStepIssue,body:'PROGRESS_VERIFIED=true\n\`\`\`md\n- [x] not a step\n\`\`\`\n- [x] real A\n- [ ] real B'};
assert.equal(checklistForIssue(fences).total,2);
// Source-grounded NEXT remains visible without creating imaginary completed checklist steps.
const planOnlyIssue={...verifiedStepIssue,body:'## CURRENT — AUTHORITATIVE\nCURRENT_STATE=READY_INDEPENDENT_REVIEW\nNEXT=Review exact HEAD of PR; after PASS guarded merge; do not close or mark DONE\nDONE=false\n## Historical\nNEXT=ignore older step'};
const plan=executionPlanForIssue(planOnlyIssue);
assert.equal(plan.source,'GITHUB_CURRENT_NEXT');
assert.deepEqual(plan.steps.map((step)=>step.title),['Review exact HEAD of PR','after PASS guarded merge']);
const planRow=parseOpenWorkIssue(planOnlyIssue);
assert.equal(planRow.executionSteps.length,2);
assert.equal(planRow.progressSteps.length,0);
assert.equal(planRow.progressPercent,null);
assert.equal(planRow.progressChecklistVerified,false);
assert.equal(executionPlanForIssue({...planOnlyIssue,body:'CURRENT_STATE=WAIT_OWNER'}).steps.length,0,'Do not invent steps when GitHub lacks NEXT');
for (const x of ['id="drawerChecklistSection"','function verifiedStepSummary(row)','function drawerChecklistMarkup(row)','progressSteps','progressRemaining','Có ','Còn ','class="drawer-checklist-step']) assert.ok(publicView.includes(x),'Checklist UI missing '+x);
assert.match(publicView,/tigeriq-live-verified-checklist-v24/);
// Live GitHub gates: current authoritative block only, and independent PR/run/review proof.
const gateSha='1234567890abcdef1234567890abcdef12345678';
const gatedIssue={number:4321,state:'open',body:'## CURRENT — authoritative\nPR_IN_PROGRESS=PR #5432\nTARGET_EXACT_HEAD='+gateSha+'\nEXACT_HEAD_CI=PASS|RUN_12345678\nEXACT_HEAD_QUEUE_HYGIENE=PASS|RUN_23456789\nREVIEW_PASS=false\nDONE=false\n\n## Old historical state\nREVIEW_PASS=true\nDONE=true'};
const gateSpec=githubMilestoneSpec(gatedIssue);
assert.equal(gateSpec.prNumber,5432);
assert.equal(gateSpec.head,gateSha);
const ghProof={
  pr:{number:5432,head:{sha:gateSha},user:{login:'implementer'},html_url:'https://github.com/newsdayads/tigeriq-ai-lab/pull/5432',merged:false},
  ciRun:{id:12345678,name:'CI',head_sha:gateSha,status:'completed',conclusion:'success'},
  queueRun:{id:23456789,name:'Queue Hygiene',head_sha:gateSha,status:'completed',conclusion:'success'},
  reviews:[{user:{login:'implementer'},state:'APPROVED',commit_id:gateSha,submitted_at:'2026-10-08T10:00:00Z'}],
};
const gateList=githubMilestoneChecklist(gatedIssue,gateSpec,ghProof);
assert.deepEqual({done:gateList.done,total:gateList.total,remaining:gateList.remaining},{done:3,total:6,remaining:3});
assert.equal(gateList.steps[3].done,false,'self-approval must never count');
assert.equal(gateList.steps[5].done,false,'historical DONE=true must not count');
assert.equal(githubMilestoneChecklist(gatedIssue,gateSpec,{...ghProof,pr:{...ghProof.pr,head:{sha:'a'.repeat(40)}}}),null,'stale PR HEAD is rejected');
const badCI=githubMilestoneChecklist(gatedIssue,gateSpec,{...ghProof,ciRun:{...ghProof.ciRun,head_sha:'b'.repeat(40)}});
assert.equal(badCI.done,2,'CI on another commit must not count');
const approved=githubMilestoneChecklist(gatedIssue,gateSpec,{...ghProof,reviews:[{user:{login:'real-reviewer'},state:'APPROVED',commit_id:gateSha,submitted_at:'2026-10-08T10:01:00Z'}]});
assert.equal(approved.done,4,'only another reviewer APPROVED at target HEAD counts');
assert.equal(githubMilestoneSpec({...gatedIssue,body:'## CURRENT\nDONE=false\n\n## OLD\nPR=PR #5432\nTARGET_HEAD='+gateSha}),null,'do not read historical PR');
assert.equal(githubMilestoneChecklist(gatedIssue,gateSpec,{pr:null}),null,'no authenticated PR proof means no progress');
assert.ok(publicView.includes("'github_gates_verified'"),'UI must accept verified GitHub gate source');
assert.ok(publicView.includes('CỔNG TIẾN ĐỘ GITHUB'),'drawer must explain GitHub evidence');
console.log('TIGERIQ_GITHUB_AUTO_PROGRESS_PASS');
console.log('TIGERIQ_CHECKLIST_VERIFY_PASS');

console.log('TIGERIQ_LIVE_UNIFIED_WORK_LIST_PASS');
