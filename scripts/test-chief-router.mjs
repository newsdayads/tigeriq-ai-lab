import assert from 'node:assert/strict';
import { normalizeHistory, parseChiefDecision } from '../api/chief.mjs';

assert.deepEqual(
  parseChiefDecision('{"mode":"reply","reply":"Em đang trao đổi với Sếp.","instruction":"","priority":"P1"}'),
  { mode: 'reply', reply: 'Em đang trao đổi với Sếp.', instruction: '', priority: 'P1' },
);

assert.deepEqual(
  parseChiefDecision('{"mode":"clarify","reply":"Sếp muốn em triển khai phần nào trước?","instruction":"","priority":"P1"}').mode,
  'clarify',
);

const work = parseChiefDecision('{"mode":"work-order","reply":"Em nhận việc.","instruction":"Kiểm tra CI và sửa lỗi build trên branch TEST.","priority":"P0"}');
assert.equal(work.mode, 'work-order');
assert.equal(work.priority, 'P0');
assert.match(work.instruction, /CI/);

assert.throws(
  () => parseChiefDecision('{"mode":"work-order","reply":"x","instruction":"","priority":"P1"}'),
  /chief_empty_instruction/,
);
assert.throws(
  () => parseChiefDecision('{"mode":"unknown","reply":"x","instruction":"","priority":"P1"}'),
  /chief_invalid_mode/,
);

const history = normalizeHistory([
  { role: 'system', content: 'drop me' },
  { role: 'user', content: 'Sếp hỏi' },
  { role: 'assistant', content: 'Em trả lời' },
]);
assert.deepEqual(history, [
  { role: 'user', content: 'Sếp hỏi' },
  { role: 'assistant', content: 'Em trả lời' },
]);

console.log('CHIEF_ROUTER_STATIC_PASS');
