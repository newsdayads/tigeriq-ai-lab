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
assert.match(publicView, /width:18px;height:18px/);
assert.match(publicView, /padStart\(2,'0'\)/);
assert.match(publicView, /function displayTitle/);
assert.match(publicView, /if\(ad&&bd\)/);
assert.match(publicView, /api\/live-status/);
assert.match(publicView, /ĐANG LÀM/);
assert.match(publicView, /ĐANG RÀ SOÁT/);
assert.match(publicView, /CHỜ GIAO/);
assert.match(publicView, /BỊ CHẶN/);
assert.match(publicView, /HOÀN TẤT/);
assert.match(publicView, /setInterval\(.*30000/);
assert.match(publicView, /PC01 LIVE/);
assert.match(publicView, /DỮ LIỆU CŨ/);

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

console.log('TIGERIQ_LIVE_UNIFIED_WORK_LIST_PASS');
