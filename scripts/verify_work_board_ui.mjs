import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const publicView = readFileSync('command-center.html', 'utf8');
const config = JSON.parse(readFileSync('vercel.json', 'utf8'));

// Public surface is intentionally read-only under #423. Root must route directly
// to the clean command-center path; a public/index.html redirect shim would shadow
// the rewrite and can self-loop at `/`.
assert.equal(existsSync('public/index.html'), false);
assert.equal(config?.cleanUrls, true);
assert.equal(config?.rewrites?.find((route) => route?.source === '/')?.destination, '/command-center');
assert.match(publicView, /Bảng điều hành/);
assert.match(publicView, /CHỈ XEM/);
assert.match(publicView, /Cần anh Sơn/);
assert.match(publicView, /api\/company-progress/);
assert.match(publicView, /Không suy đoán PC01/);
assert.doesNotMatch(publicView, /id=["']dispatch["']/);
assert.doesNotMatch(publicView, /GitHub token/i);
assert.doesNotMatch(publicView, /Giao việc cho Vy/);
console.log('PUBLIC_READONLY_MANAGEMENT_VIEW_PASS');
