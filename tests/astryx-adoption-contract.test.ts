import { readFileSync, existsSync } from 'node:fs';
import { it as test, expect } from 'vitest';
// @ts-ignore runtime JS module
import { matchAndLoadSkills } from '../apps/tigeriq-core/skill-loader.mjs';

const policyUrl = new URL('../docs/skills/design-system-memory/references/astryx-adoption.json', import.meta.url);
const guideUrl = new URL('../docs/skills/design-system-memory/references/astryx-adoption.md', import.meta.url);

type AstryxArea = { id: string; path?: string; observedStack: string; decision: string };
const policy = JSON.parse(readFileSync(policyUrl, 'utf8')) as {
  schemaVersion: number;
  upstream: { repository: string; license: string; release: string; minimumReactMajor: number; assetCopied: boolean; installerExecuted: boolean };
  governance: { mode: string; libraryInstall: string; globalReactMigration: boolean; productionMutation: boolean; newSkillCreated: boolean };
  areas: AstryxArea[];
  pilotGates: string[];
};

test('Astryx objective loads the two EXISTING design skills rather than creating a new one', () => {
  const result = matchAndLoadSkills('Meta Astryx');
  const ids = result.skills.map((s: { id: string }) => s.id).sort();
  expect(ids).toEqual(['design-system-memory', 'visual-quality-gate']);
  expect(result.contextBlock).toContain('astryx-adoption.md');
  expect(result.contextBlock).toContain('React 19+');
});

test('Astryx reference defaults to patterns, not a global React conversion or installer', () => {
  expect(policy.schemaVersion).toBe(1);
  expect(policy.upstream.repository).toBe('https://github.com/meta/astryx');
  expect(policy.upstream.license).toBe('MIT');
  expect(policy.upstream.release).toBe('BETA');
  expect(policy.upstream.minimumReactMajor).toBeGreaterThanOrEqual(19);
  expect(policy.upstream.assetCopied).toBe(false);
  expect(policy.upstream.installerExecuted).toBe(false);
  expect(policy.governance).toMatchObject({
    mode: 'PATTERNS_FIRST',
    globalReactMigration: false,
    productionMutation: false,
    newSkillCreated: false,
  });
  expect(policy.governance.libraryInstall).toMatch(/^BLOCKED_/);
  expect(policy.pilotGates).toContain('PINNED_UPSTREAM_VERSION_AND_HASH');
  expect(policy.pilotGates).toContain('RESPONSIVE_ACCESSIBILITY_INTERACTION_TESTS');
  expect(policy.pilotGates).toContain('PRODUCTION_GATE_AND_LIVE_READBACK');
});

test('existing static frontends cannot be silently promoted to a React package', () => {
  const legacy = policy.areas.filter(a => a.observedStack === 'HTML_CSS_JS');
  expect(legacy).toHaveLength(3);
  for (const area of legacy) {
    expect(area.decision).toBe('PATTERNS_ONLY');
    expect(area.path).toBeTruthy();
    expect(existsSync(new URL('../' + area.path, import.meta.url))).toBe(true);
  }
  const candidate = policy.areas.find(a => a.id === 'future-react-web-ui');
  expect(candidate?.decision).toBe('PILOT_ONLY_AFTER_GATES');
  expect(policy.areas.find(a => a.id === 'android-apps')?.decision).toBe('NOT_APPLICABLE');
  expect(policy.areas.find(a => a.id === 'ai-core-and-device-control')?.decision).toBe('NOT_APPLICABLE');
  const guide = readFileSync(guideUrl, 'utf8');
  expect(guide).toContain('OWNER_INTERACTION_V6.md');
  expect(guide).toContain('DRIVE_SYNC=NOT_REQUIRED');
});
