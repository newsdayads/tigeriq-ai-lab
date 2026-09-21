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
assert.match(deployedView, /TigerIQ Live/);
assert.match(publicView, /Trạng thái nhân sự/);
assert.match(publicView, /api\/live-status/);
assert.match(publicView, /Đang làm/);
assert.match(publicView, /Bị chặn/);
assert.match(publicView, /Rảnh/);
assert.match(publicView, /setInterval\(.*10000/);
assert.doesNotMatch(publicView, /Giao việc cho Vy/);
assert.doesNotMatch(publicView, /id=["']dispatch["']/);
assert.doesNotMatch(publicView, /GitHub token/i);

assert.match(liveApi, /actions\/runs\?per_page=100/);
assert.match(liveApi, /pulls\?state=open/);
assert.match(liveApi, /REGISTRY_ISSUE = 335/);
assert.match(liveApi, /Không có việc GitHub đang chạy/);
assert.match(liveApi, /cache = \{ at: 0, value: null \}/);
assert.doesNotMatch(liveApi, /process\.env\.TIGERIQ_GITHUB_TOKEN[^\n]*console/i);

console.log('TIGERIQ_LIVE_STATUS_VIEW_PASS');
