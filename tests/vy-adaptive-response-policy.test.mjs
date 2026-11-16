import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Vy adaptive presentation has one canonical source and covers all responses', () => {
  const v6 = read('docs/OWNER_INTERACTION_V6.md');
  assert.match(v6, /MODE=ADAPTIVE \| SCOPE=ALL_VY_OWNER_FACING_REPLIES/);
  assert.match(v6, /hỏi đáp ngắn, tư vấn, trạng thái giữa các bước/);
  assert.match(v6, /chỉ đánh dấu hoàn tất khi có kết quả công cụ thực/);
  assert.match(v6, /Không giả chạy nền/);
  assert.match(v6, /không tự đồng bộ/);
});

test('bootstrap and owner-facing references route to V6 without conflicting emoji policy', () => {
  const loader = read('bootstrap/00_TIGERIQ_LOADER.md');
  const workflow = read('bootstrap/02_TIGERIQ_WORKFLOW.md');
  const index = read('bootstrap/06_TIGERIQ_SOURCE_INDEX.md');
  const report = read('docs/OWNER_CHAT_REPORT_VISUAL_V3.md');
  const legacy = read('docs/OWNER_BCCT_VISUAL_PRESENTATION_V2.md');
  const skill = read('docs/skills/vy-owner-collaboration/SKILL.md');
  assert.match(loader, /HARD ROUTE CHO MỌI PHẢN HỒI VY/);
  assert.match(workflow, /Mọi phản hồi Vy cho anh Sơn/);
  assert.match(index, /Mọi phản hồi Vy trong chat hiện tại\/NEW CHAT/);
  assert.doesNotMatch(index, /chỉ `✅ ⚙️/);
  assert.doesNotMatch(legacy, /chỉ thuộc bộ canonical `✅/);
  assert.match(report, /Mọi câu trả lời Vy, kể cả hỏi đáp/);
  assert.match(skill, /CHẾ ĐỘ PHẢN HỒI VY LINH HOẠT/);
});

test('BCCT V5 remains protected and V6 does not claim host-wide installation', () => {
  const v6 = read('docs/OWNER_INTERACTION_V6.md');
  const bcct = read('docs/OWNER_BCCT_FINAL_V5.md');
  assert.match(v6, /BCCT_LAYOUT_LOCK=docs\/OWNER_BCCT_FINAL_V5.md/);
  assert.match(bcct, /Icon vector thống nhất/);
  assert.match(v6, /NATIVE_HOST_ENFORCEMENT=NOT_CLAIMED/);
});
