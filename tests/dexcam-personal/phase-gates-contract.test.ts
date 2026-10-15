import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const quality = readFileSync(new URL('../../projects/dexcam-personal/05_QUALITY_ACCEPTANCE.md', import.meta.url), 'utf8');
const roadmap = readFileSync(new URL('../../projects/dexcam-personal/06_BACKLOG_AND_ROADMAP.md', import.meta.url), 'utf8');

test('G3 source and unit/mock acceptance does not require G4/G5 device measurements', () => {
  const gate = quality.split('\n').find(line => line.startsWith('Cổng G3 nghiệm thu'));
  expect(gate).toContain('G1/G2');
  expect(gate).toContain('unit/mock');
  expect(gate).toContain('không yêu cầu số đo trên thiết bị thuộc G4/G5');
  expect(quality).not.toContain('Cổng G3 chỉ đủ bằng chứng khi');
});

test('G3 roadmap admits source tests while preserving exclusive source-writer gate', () => {
  const stage = roadmap.split('\n').find(line => line.startsWith('| G3: Bắt đầu xây dựng |'));
  expect(stage).toContain('kiểm thử unit/mock');
  expect(stage).toContain('quyền nguồn/khóa ghi đã xác minh');
  expect(stage).toContain('không đòi kết quả thiết bị G4/G5');
});

test('G4/G5 still require actual authorized physical observations, not mock pass', () => {
  expect(quality).toContain('G4 — Tích hợp với thiết bị (chờ quyền thiết bị cụ thể)');
  expect(roadmap).toContain('| G4: Tích hợp với thiết bị | CHỜ QUYỀN THIẾT BỊ |');
  expect(roadmap).toContain('G4 nghiệm thu + 50 log thực tế');
  expect(quality).toContain('0/0 bài thử sản phẩm đã được chạy');
});
