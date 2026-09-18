import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendSkillContextToPrompt, loadSkillRegistry, matchAndLoadSkills, parseSkillRegistry } from '../apps/tigeriq-core/skill-loader.mjs';

function fixture(entries, contents = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tigeriq-skill-'));
  const registryPath = join(dir, 'registry.yaml');
  const rows = ['version: 1', 'skills:'];
  for (const entry of entries) {
    rows.push(`  - id: ${entry.id}`);
    rows.push(`    title: ${entry.title || entry.id}`);
    rows.push(`    state: ${entry.state}`);
    rows.push(`    version: ${entry.version || '1.0.0'}`);
    rows.push(`    target: ${entry.target || 'general'}`);
    rows.push(`    summary: ${entry.summary || 'skill summary'}`);
    if (entry.triggers) rows.push(`    triggers: ${entry.triggers}`);
  }
  writeFileSync(registryPath, rows.join('\n'));
  for (const [id, content] of Object.entries(contents)) {
    const skillDir = join(dir, id);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), content);
  }
  return { dir, registryPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('parser fails closed on malformed registry', () => {
  assert.throws(() => parseSkillRegistry('version: 1\nskills:\n  - title: missing-id'), /SKILL_REGISTRY_MALFORMED/);
  assert.throws(() => parseSkillRegistry('version: x\nskills:\n  - id: good\n    state: ACTIVE'), /SKILL_REGISTRY_MALFORMED/);
});

test('CANDIDATE skill never loads', () => {
  const f = fixture([{ id: 'candidate-only', state: 'CANDIDATE', triggers: 'routing' }], { 'candidate-only': '# Candidate' });
  try {
    assert.equal(loadSkillRegistry(f.registryPath).skills[0].state, 'CANDIDATE');
    assert.equal(matchAndLoadSkills('routing task', { registryPath: f.registryPath, baseDir: f.dir }).skills.length, 0);
  } finally { f.cleanup(); }
});

test('only relevant ACTIVE skill loads', () => {
  const f = fixture([
    { id: 'routing-skill', state: 'ACTIVE', triggers: 'routing model provider' },
    { id: 'review-skill', state: 'ACTIVE', triggers: 'review verifier' }
  ], { 'routing-skill': '# Routing\nChoose a model.', 'review-skill': '# Review\nReview independently.' });
  try {
    const result = matchAndLoadSkills('route model routing provider', { registryPath: f.registryPath, baseDir: f.dir });
    assert.deepEqual(result.skills.map(s => s.id), ['routing-skill']);
    assert.match(result.contextBlock, /routing-skill/);
    assert.doesNotMatch(result.contextBlock, /review-skill/);
  } finally { f.cleanup(); }
});

test('missing SKILL.md is skipped with evidence', () => {
  const f = fixture([{ id: 'missing-skill', state: 'ACTIVE', triggers: 'missing' }]);
  try {
    const result = matchAndLoadSkills('missing', { registryPath: f.registryPath, baseDir: f.dir });
    assert.equal(result.skills.length, 0);
    assert.deepEqual(result.skipped, [{ id: 'missing-skill', reason: 'MISSING_SKILL_FILE' }]);
  } finally { f.cleanup(); }
});

test('max three skills and context budget are hard limits', () => {
  const entries = [1, 2, 3, 4].map(n => ({ id: `skill-${n}`, state: 'ACTIVE', triggers: 'shared routing' }));
  const contents = Object.fromEntries(entries.map((entry, i) => [entry.id, 'x'.repeat(1200 + i)]));
  const f = fixture(entries, contents);
  try {
    const result = matchAndLoadSkills('shared routing', { registryPath: f.registryPath, baseDir: f.dir, maxSkills: 3, maxChars: 2500 });
    assert.ok(result.skills.length <= 3);
    assert.ok(result.totalChars <= 2500);
    const oversized = fixture([{ id: 'oversized', state: 'ACTIVE', triggers: 'routing' }], { oversized: 'x'.repeat(7000) });
    try {
      const blocked = matchAndLoadSkills('routing', { registryPath: oversized.registryPath, baseDir: oversized.dir, maxChars: 6000 });
      assert.equal(blocked.skills.length, 0);
      assert.equal(blocked.totalChars, 0);
      assert.equal(blocked.skipped[0]?.reason, 'CONTEXT_BUDGET');
    } finally { oversized.cleanup(); }
  } finally { f.cleanup(); }
});

test('manager prompt integration appends only matched ACTIVE skill context', () => {
  const f = fixture([
    { id: 'role-separation', state: 'ACTIVE', triggers: 'review reviewer implementation' },
    { id: 'candidate-nope', state: 'CANDIDATE', triggers: 'review' }
  ], { 'role-separation': '# Role Separation\nIndependent review.', 'candidate-nope': '# Candidate' });
  try {
    const matched = matchAndLoadSkills('implementation review reviewer', { registryPath: f.registryPath, baseDir: f.dir });
    const prompt = appendSkillContextToPrompt('BASE MANAGER PROMPT', matched.contextBlock);
    assert.match(prompt, /BASE MANAGER PROMPT/);
    assert.match(prompt, /role-separation/);
    assert.doesNotMatch(prompt, /candidate-nope/);
  } finally { f.cleanup(); }
});
