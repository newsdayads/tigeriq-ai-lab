import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync('public/index.html', 'utf8');
assert.match(html, /id="quickWork"/);
assert.match(html, /operation:'work-board'/);
assert.match(html, /TigerIQ AI · Work Board · GitHub evidence/);
assert.match(html, /Giao việc để tạo Work Order trực tiếp không dùng GPT/);
console.log('WO017_WORK_BOARD_UI_PASS');
