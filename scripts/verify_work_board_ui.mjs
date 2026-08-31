import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const entry = readFileSync('public/index.html', 'utf8');
const html = readFileSync('public/command-center.html', 'utf8');

assert.match(entry, /location\.replace\('\/command-center'\)/);
assert.doesNotMatch(entry, /githubToken|github_pat_/);
assert.match(html, /Công việc & bằng chứng/);
assert.match(html, /id="workList"/);
assert.match(html, /\/api\/web-control-status/);
assert.match(html, /REVIEW PASS/);
assert.match(html, /JUDGE PASS/);
assert.match(html, /operation:'work-order'/);
assert.match(html, /Lệnh tạo Work Order, không chạy shell trực tiếp\./);
console.log('WO017_WORK_BOARD_UI_PASS');
