import { readFileSync } from 'node:fs';
import { it as test, expect } from 'vitest';
// @ts-ignore runtime JS module
import { matchAndLoadSkills } from '../apps/tigeriq-core/skill-loader.mjs';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const rubric = read('docs/skills/visual-quality-gate/references/unslop-ui-audit.md');
const skill = read('docs/skills/visual-quality-gate/SKILL.md');
const detectors = JSON.parse(read('docs/skills/visual-quality-gate/detectors.json'));

test('Unslop objective routes to existing ACTIVE visual-quality-gate skill', () => {
  const result = matchAndLoadSkills('Unslop soi lỗi UI');
  expect(result.skills.map((s: { id: string }) => s.id)).toContain('visual-quality-gate');
  expect(result.contextBlock).toContain('Unslop');
  expect(skill).toContain('Version: 1.0.2');
  expect(skill).toContain('references/unslop-ui-audit.md');
});

test('Unslop uses existing anti-slop detectors and preserves false-positive guards', () => {
  expect(detectors.rules.map((rule: { id: string }) => rule.id)).toEqual(['gradient-text', 'glow-shadow', 'side-tab']);
  for (const rule of detectors.rules) {
    expect(rule.falsePositiveGuards.length).toBeGreaterThan(0);
    expect(rule.evidenceKind).toBeTruthy();
  }
  expect(detectors.rules.filter((rule: { severity: string }) => rule.severity === 'hard').map((rule: { id: string }) => rule.id)).toEqual(['gradient-text']);
  expect(rubric).toContain('PASS_WITH_ADVISORIES');
  expect(rubric).toContain('NOT_VERIFIED');
  expect(rubric).toContain('falsePositiveGuard');
});

test('Unslop is review-only and does not authorize a new skill, React install, or production', () => {
  expect(rubric).toContain('do not create a fourth Skill');
  expect(rubric).toContain('Do not infer');
  expect(rubric).toContain('React 19+');
  expect(rubric).toContain('production deploy');
  expect(skill).toContain('Owner Interaction V6');
});

test('webui shortcut loads all three ACTIVE design skills in default bounded context', () => {
  const result = matchAndLoadSkills('webui');
  expect(result.skills.map((s: { id: string }) => s.id).sort()).toEqual([
    'design-system-memory',
    'image-to-ui-implementation',
    'visual-quality-gate',
  ]);
  expect(result.totalChars).toBeLessThanOrEqual(6000);
  expect(result.contextBlock).toContain('references/unslop-ui-audit.md');
  expect(result.contextBlock).toContain('astryx-adoption.md');
  expect(result.skipped.filter((s: { reason: string }) => s.reason === 'CONTEXT_BUDGET')).toEqual([]);
});
