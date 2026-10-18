import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('Vy Owner goal-to-evidence bootstrap', () => {
  const loader = source('bootstrap/00_TIGERIQ_LOADER.md');
  const vy = source('docs/skills/vy-owner-collaboration/SKILL.md');
  const registry = source('docs/skills/registry.yaml');
  const compiler = source('apps/tigeriq-core/task-prompt-compiler.mjs');

  it('uses source, only registry ACTIVE runtime skills and bounded prompts', () => {
    expect(loader).toContain('VY GOAL → SKILL → PROMPT → VERIFIED DELIVERY');
    expect(loader).toContain('Skill ACTIVE');
    expect(loader).toContain('task-prompt-compiler.mjs');
    expect(loader).toContain('Không nạp toàn bộ 29 thư mục');
    expect(vy).toContain('Select rather than preload');
    expect(vy).toContain('selected ACTIVE skill_ids');
  });

  it('does not auto-promote planner or Vy candidate and preserves live gate', () => {
    expect(vy).toMatch(/State: CANDIDATE/);
    expect(vy).toContain('unregistered CANDIDATE');
    expect(vy).toContain('does not force native ChatGPT');
    expect(registry).toMatch(/- id: vy-owner-collaboration\n\s+title: Vy Owner Collaboration\n\s+state: CANDIDATE/);
    expect(registry).not.toContain('  - id: core-manager-planner\n');
    expect(compiler).toContain('function');
  });

  it('requires real evidence, no invented improvement and keeps hard gates', () => {
    expect(vy).toContain('Never promote this skill to ACTIVE solely');
    expect(vy).toContain('A 30% improvement may be a target');
    expect(vy).toContain('Do not mark an unchecked step completed');
    expect(loader).toContain('cổng Production, bảo mật, credential, chi phí');
  });
});
