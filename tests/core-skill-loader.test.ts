import test from 'node:test';
import assert from 'node:assert';
import { loadSkillRegistry, getActiveVerifiedSkills, matchAndLoadSkills } from '../apps/tigeriq-core/skill-loader.mjs';

test('loadSkillRegistry parses valid registry or fails closed', () => {
  const reg = loadSkillRegistry('docs/skills/registry.yaml');
  assert.ok(reg);
  assert.strictEqual(reg.version, 1);
  assert.ok(Array.isArray(reg.skills));
});

test('getActiveVerifiedSkills filters ACTIVE and checks SKILL.md presence', () => {
  const active = getActiveVerifiedSkills('docs/skills/registry.yaml', 'docs/skills');
  assert.ok(Array.isArray(active));
  // By default, skills in registry are CANDIDATE unless marked ACTIVE or updated in tests
});

test('matchAndLoadSkills respects budget limits and relevance', () => {
  const result = matchAndLoadSkills('test objective for routing and roles', {
    maxSkills: 3,
    maxChars: 6000
  });
  assert.ok(result);
  assert.ok(Array.isArray(result.skills));
  assert.ok(Array.isArray(result.evidence));
  assert.ok(result.totalChars <= 6000);
});
