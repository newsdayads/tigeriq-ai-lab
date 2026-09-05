import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const redirect = readFileSync('public/index.html', 'utf8');
const publicView = readFileSync('command-center.html', 'utf8');

// Public surface is intentionally read-only under #423. Legacy Work Board/write
// controls belong to the authenticated/local functional surface, not Internet view.
assert.match(redirect, /url=\//);
assert.match(publicView, /Bảng điều hành/);
assert.match(publicView, /CHỈ XEM/);
assert.match(publicView, /Cần anh Sơn/);
assert.match(publicView, /api\/company-progress/);
assert.match(publicView, /Không suy đoán PC01/);
assert.doesNotMatch(publicView, /id=["']dispatch["']/);
assert.doesNotMatch(publicView, /GitHub token/i);
assert.doesNotMatch(publicView, /Giao việc cho Vy/);
console.log('PUBLIC_READONLY_MANAGEMENT_VIEW_PASS');
