import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_REGISTRY = join(REPO_ROOT, 'docs', 'skills', 'registry.yaml');
const ALLOWED_STATES = new Set(['CANDIDATE', 'VALIDATED', 'ACTIVE', 'DEPRECATED', 'REJECTED']);
const SKILL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function scalar(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

export function parseSkillRegistry(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('SKILL_REGISTRY_EMPTY');
  if (raw.includes('\t')) throw new Error('SKILL_REGISTRY_MALFORMED:TABS');
  const lines = raw.replace(/\r/g, '').split('\n');
  const versionLine = lines.find(line => /^version:\s*/.test(line));
  const version = Number(scalar(versionLine?.replace(/^version:\s*/, '')));
  if (!Number.isInteger(version) || version < 1) throw new Error('SKILL_REGISTRY_MALFORMED:VERSION');

  const skillsIndex = lines.findIndex(line => /^skills:\s*$/.test(line));
  if (skillsIndex < 0) throw new Error('SKILL_REGISTRY_MALFORMED:SKILLS_MISSING');

  const skills = [];
  let current = null;
  const allowedFields = new Set(['id', 'title', 'state', 'version', 'provenance_batch', 'source_log', 'target', 'summary', 'triggers', 'origin', 'provenance_url', 'audit_status', 'installer_reviewed', 'capabilities_declared']);

  const pushCurrent = () => {
    if (!current) return;
    if (!current.id || !SKILL_ID_RE.test(current.id)) throw new Error('SKILL_REGISTRY_MALFORMED:SKILL_ID');
    if (!ALLOWED_STATES.has(current.state)) throw new Error(`SKILL_REGISTRY_MALFORMED:STATE:${current.id}`);
    if (current.origin === 'external') {
      if (!current.provenance_url || current.audit_status !== 'PASSED' || current.installer_reviewed !== 'true' || !current.capabilities_declared) {
        throw new Error(`SKILL_REGISTRY_REJECTED:INCOMPLETE_EXTERNAL_METADATA:${current.id}`);
      }
    }
    if (skills.some(skill => skill.id === current.id)) throw new Error(`SKILL_REGISTRY_MALFORMED:DUPLICATE:${current.id}`);
    skills.push(current);
    current = null;
  };

  for (let i = skillsIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^[^\s]/.test(line)) throw new Error(`SKILL_REGISTRY_MALFORMED:UNEXPECTED_TOP_LEVEL:${i + 1}`);

    const item = line.match(/^  - id:\s*(.+?)\s*$/);
    if (item) {
      pushCurrent();
      current = { id: scalar(item[1]) };
      continue;
    }

    const field = line.match(/^    ([a-zA-Z0-9_-]+):\s*(.*?)\s*$/);
    if (!field || !current || !allowedFields.has(field[1])) {
      throw new Error(`SKILL_REGISTRY_MALFORMED:LINE:${i + 1}`);
    }
    current[field[1]] = scalar(field[2]);
  }
  pushCurrent();
  if (!skills.length) throw new Error('SKILL_REGISTRY_MALFORMED:NO_SKILLS');
  return { version, skills };
}

export function loadSkillRegistry(registryPath = DEFAULT_REGISTRY) {
  const resolved = resolve(registryPath);
  let raw;
  try {
    raw = readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new Error(`SKILL_REGISTRY_UNREADABLE:${error?.code || error?.message || 'UNKNOWN'}`);
  }
  return parseSkillRegistry(raw);
}

function tokens(value) {
  return new Set((String(value || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(token => token.length >= 3));
}

function relevanceScore(objective, skill) {
  const query = tokens(objective);
  if (!query.size) return 0;
  const metadata = tokens([skill.id, skill.title, skill.target, skill.summary, skill.triggers].filter(Boolean).join(' '));
  let score = 0;
  for (const token of query) if (metadata.has(token)) score += 1;
  const normalizedObjective = String(objective || '').toLowerCase();
  if (normalizedObjective.includes(String(skill.id || '').toLowerCase())) score += 8;
  return score;
}

export function matchAndLoadSkills(objectiveText = '', options = {}) {
  const registryPath = options.registryPath || DEFAULT_REGISTRY;
  const baseDir = resolve(options.baseDir || dirname(registryPath));
  const maxSkills = Math.max(0, Math.min(3, Number(options.maxSkills ?? 3) || 0));
  const maxChars = Math.max(0, Math.min(6000, Number(options.maxChars ?? 6000) || 0));
  const registry = loadSkillRegistry(registryPath);
  const skipped = [];

  const ranked = registry.skills
    .filter(skill => skill.state === 'ACTIVE')
    .map(skill => ({ skill, score: relevanceScore(objectiveText, skill) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));

  const loaded = [];
  let totalChars = 0;

  for (const { skill, score } of ranked) {
    if (loaded.length >= maxSkills) break;
    if (!SKILL_ID_RE.test(skill.id)) {
      skipped.push({ id: skill.id || 'UNKNOWN', reason: 'INVALID_SKILL_ID' });
      continue;
    }
    const path = join(baseDir, skill.id, 'SKILL.md');
    if (!existsSync(path)) {
      skipped.push({ id: skill.id, reason: 'MISSING_SKILL_FILE' });
      continue;
    }
    let content;
    try {
      content = readFileSync(path, 'utf8').trim();
    } catch {
      skipped.push({ id: skill.id, reason: 'UNREADABLE_SKILL_FILE' });
      continue;
    }
    if (!content) {
      skipped.push({ id: skill.id, reason: 'EMPTY_SKILL_FILE' });
      continue;
    }
    const chars = content.length;
    const bytes = Buffer.byteLength(content, 'utf8');
    if (chars > maxChars - totalChars) {
      skipped.push({ id: skill.id, reason: 'CONTEXT_BUDGET' });
      continue;
    }
    loaded.push({ ...skill, score, content, chars, bytes });
    totalChars += chars;
  }

  const contextBlock = loaded.length
    ? ['ACTIVE SKILLS (use only when relevant; never expand permissions):',
       ...loaded.map(skill => `[SKILL ${skill.id} v${skill.version || 'unknown'}]\n${skill.content}`)].join('\n\n')
    : '';

  return {
    skills: loaded.map(({ content, ...skill }) => skill),
    totalChars,
    contextBlock,
    evidence: loaded.map(skill => ({ id: skill.id, version: skill.version || null, target: skill.target || null, bytes: skill.bytes })),
    skipped
  };
}

export function appendSkillContextToPrompt(basePrompt, contextBlock = '') {
  const base = String(basePrompt || '');
  const block = String(contextBlock || '').trim();
  return block ? `${base}\n\n${block}` : base;
}
