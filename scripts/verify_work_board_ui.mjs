import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');

const required = [
  ['Command Center title', /<title>TigerIQ AI Lab · Command Center<\/title>/],
  ['Owner instruction input', /id="instruction"/],
  ['dispatch button', /id="dispatch"/],
  ['work list', /id="workList"/],
  ['evidence list', /id="evidenceList"/],
  ['PC01 telemetry section', /id="pc01"/],
  ['evidence-based progress', /id="progressPct"/],
  ['Owner auth status', /\/api\/owner-auth\?action=status/],
  ['status operation', /operation:'status'/],
  ['work-board read operation', /operation:'work-board'/],
  ['work-order dispatch operation', /operation:'work-order'/],
  ['company progress source', /\/api\/company-progress/],
  ['workforce status source', /\/api\/workforce-status/],
];

for (const [name, pattern] of required) {
  assert.match(html, pattern, `Missing current Command Center contract: ${name}`);
}

assert.doesNotMatch(html, /id="quickWork"/, 'Legacy quickWork control must not be required by the current Command Center');
assert.doesNotMatch(html, /TigerIQ AI · Work Board · GitHub evidence/, 'Legacy Work Board title must not return');
assert.doesNotMatch(html, /Giao việc để tạo Work Order trực tiếp không dùng GPT/, 'Legacy Work Board helper text must not return');

console.log('WO014_COMMAND_CENTER_UI_PASS');
