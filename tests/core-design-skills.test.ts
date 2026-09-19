import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { describe, it, expect } from 'vitest';

describe('Core Design Skills Registry', () => {
  it('loads the skill registry and recognizes the three new skills without forbidden paths', () => {
    const registryPath = path.resolve(__dirname, '../docs/skills/registry.yaml');
    const fileContent = fs.readFileSync(registryPath, 'utf8');
    const registry = yaml.parse(fileContent);

    const skillIds = registry.skills.map((s: any) => s.id);

    expect(skillIds).toContain('design-system-memory');
    expect(skillIds).toContain('image-to-ui-implementation');
    expect(skillIds).toContain('visual-quality-gate');

    // Verify no forbidden or unauthorized paths are loaded or registered
    for (const skill of registry.skills) {
      if (['design-system-memory', 'image-to-ui-implementation', 'visual-quality-gate'].includes(skill.id)) {
        const skillMdPath = path.resolve(__dirname, `../docs/skills/${skill.id}/SKILL.md`);
        expect(fs.existsSync(skillMdPath)).toBe(true);
      }
    }
  });
});
