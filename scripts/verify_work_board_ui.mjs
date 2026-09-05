import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const readOnlyPublicView = html.includes('CHỈ XEM · HTTPS');

if (readOnlyPublicView) {
  for (const label of ['Đang làm', 'Ai phụ trách', 'Tiến độ', 'Vướng mắc', 'Cần anh Sơn']) assert.match(html, new RegExp(label));
  assert.match(html, /\/api\/company-progress/);
  assert.doesNotMatch(html, /id="quickWork"/);
  assert.doesNotMatch(html, /id="instruction"/);
  assert.doesNotMatch(html, /id="dispatch"/);
  assert.doesNotMatch(html, /operation:'work-board'/);
  assert.doesNotMatch(html, /operation:'work-order'/);
  assert.doesNotMatch(html, /\/api\/control/);
  console.log('WO017_PUBLIC_READ_ONLY_VIEW_PASS');
} else {
  assert.match(html, /id="quickWork"|id="instruction"/);
  assert.match(html, /operation:'work-board'|operation:'work-order'/);
  assert.match(html, /Giao việc/);
  console.log('WO017_INTERACTIVE_WORK_BOARD_UI_PASS');
}
