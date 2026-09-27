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
assert.match(publicView, /STT · Work Order · Tên việc · NV · Trạng thái/);
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
assert.match(publicView, /CHỜ\/BLOCKED/);
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

for (const removed of [
  'KẾ TIẾP CÓ THỂ CHẠY',
  'CÔNG VIỆC ĐANG THỰC HIỆN',
  'THỨ TỰ CÓ THỂ GIAO',
  'ĐANG CHỜ / BỊ CHẶN',
  'NHỮNG VIỆC GẦN ĐÂY',
  'Trạng thái nhân sự',
  'Đang xử lý',
  'Hàng đợi',
]) assert.doesNotMatch(publicView, new RegExp(removed, 'i'));

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

console.log('TIGERIQ_LIVE_UNIFIED_WORK_LIST_PASS');
