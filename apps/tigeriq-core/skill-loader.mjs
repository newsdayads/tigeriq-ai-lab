import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'yaml';

export function loadSkillRegistry(registryPath = 'docs/skills/registry.yaml') {
  const resolved = resolve(registryPath);
  if (!existsSync(resolved)) {
    throw new Error(`SKILL_REGISTRY_MISSING: ${registryPath}`);
  }
  let raw;
  try {
    raw = readFileSync(resolved, 'utf8');
  } catch (err) {
    throw new Error(`SKILL_REGISTRY_UNREADABLE: ${err.message}`);
  }
  let parsed;
  try {
    parsed = yaml.parse(raw);
  } catch (err) {
    throw new Error(`SKILL_REGISTRY_MALFORMED: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.skills)) {
    throw new Error('SKILL_REGISTRY_INVALID_STRUCTURE');
  }
  return parsed;
}

export function getActiveVerifiedSkills(registryPath = 'docs/skills/registry.yaml', baseDir = 'docs/skills') {
  const registry = loadSkillRegistry(registryPath);
  const activeSkills = [];
  for (const skill of registry.skills) {
    if (skill && skill.state === 'ACTIVE') {
      const skillId = skill.id;
      if (!skillId) continue;
      const skillMdPath = resolve(baseDir, skillId, 'SKILL.md');
      if (existsSync(skillMdPath)) {
        let content = '';
        try {
          content = readFileSync(skillMdPath, 'utf8');
        } catch {}
        activeSkills.push({
          ...skill,
          path: skillMdPath,
          content
        });
      }
    }
  }
  return activeSkills;
}

export function matchAndLoadSkills(objectiveText = '', options = {}) {
  const registryPath = options.registryPath || 'docs/skills/registry.yaml';
  const baseDir = options.baseDir || 'docs/skills';
  const maxSkills = options.maxSkills ?? 3;
  const maxChars = options.maxChars ?? 6000;

  const skills = getActiveVerifiedSkills(registryPath, baseDir);
  const query = String(objectiveText || '').toLowerCase();
  const queryTokens = query.split(/\W+/).filter(Boolean);

  const scored = skills.map(skill => {
    const text = `${skill.id} ${skill.title || ''} ${skill.summary || ''} ${skill.target || ''} ${skill.content}`.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (token.length > 2 && text.includes(token)) {
        score += 1;
      }
    }
    if (query && text.includes(query)) {
      score += 5;
    }
    return { skill, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const matched = [];
  let totalChars = 0;

  for (const item of scored) {
    if (matched.length >= maxSkills) break;
    const content = item.skill.content || '';
    if (totalChars + content.length > maxChars && matched.length > 0) {
      continue;
    }
    matched.push(item.skill);
    totalChars += content.length;
  }

  return {
    skills: matched,
    totalChars,
    evidence: matched.map(s => ({
      id: s.id,
      title: s.title,
      version: s.version,
      target: s.target
    }))
  };
}
