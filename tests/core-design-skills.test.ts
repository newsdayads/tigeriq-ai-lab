import { it as test, expect } from 'vitest';
// @ts-ignore runtime JS module
import { matchAndLoadSkills } from '../apps/tigeriq-core/skill-loader.mjs';

test('design objective loads the three design intelligence skills from the canonical registry', () => {
  const result = matchAndLoadSkills(
    'Thiết kế giao diện từ ảnh: design-system-memory image-to-ui-implementation visual-quality-gate screenshot layout'
  );
  expect(result.skills.map((s: { id: string }) => s.id).sort()).toEqual([
    'design-system-memory',
    'image-to-ui-implementation',
    'visual-quality-gate'
  ]);
  expect(result.contextBlock).toContain('approved design');
  expect(result.contextBlock).toContain('rendered');
});

test('unrelated provider-routing objective does not load design intelligence skills', () => {
  const result = matchAndLoadSkills('route API provider model capability latency quota');
  const ids = result.skills.map((s: { id: string }) => s.id);
  expect(ids).not.toContain('design-system-memory');
  expect(ids).not.toContain('image-to-ui-implementation');
  expect(ids).not.toContain('visual-quality-gate');
});
