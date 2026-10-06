import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore runtime JS modules intentionally have no declaration files.
import { matchAndLoadSkills } from '../apps/tigeriq-core/skill-loader.mjs';
// @ts-ignore runtime JS modules intentionally have no declaration files.
import { buildSkillRoutingPreflight, finalizeSkillRoutingPreflight } from '../apps/tigeriq-core/skill-preflight.mjs';

function skillFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tigeriq-skill-preflight-'));
  const registryPath = join(dir, 'registry.yaml');
  writeFileSync(registryPath, `version: 1
skills:
  - id: routing-active
    title: Routing Active
    state: ACTIVE
    version: 1.0.0
    target: router
    triggers: routing provider capability
    summary: active routing skill
  - id: routing-candidate
    title: Routing Candidate
    state: CANDIDATE
    version: 1.0.0
    target: router
    triggers: routing provider capability
    summary: candidate routing skill
  - id: routing-validated
    title: Routing Validated
    state: VALIDATED
    version: 1.0.0
    target: router
    triggers: routing provider capability
    summary: validated routing skill
  - id: irrelevant-active
    title: Irrelevant Active
    state: ACTIVE
    version: 1.0.0
    target: unrelated
    triggers: visual typography
    summary: unrelated active skill
`);
  for (const id of ['routing-active', 'routing-candidate', 'routing-validated', 'irrelevant-active']) {
    const skillDir = join(dir, id);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `# ${id}`);
  }
  return { dir, registryPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('job resolves ACTIVE skill before resource selection', () => {
  const f = skillFixture();
  try {
    const skillContext = matchAndLoadSkills('routing provider capability', { registryPath: f.registryPath, baseDir: f.dir });
    const preflight = buildSkillRoutingPreflight({
      jobId: 'JOB-1',
      objectiveText: 'routing provider capability',
      skillContext,
      requiredCapability: 'reasoning',
    });
    assert.deepEqual(preflight.order, ['JOB', 'SKILL', 'CAPABILITY', 'RESOURCE']);
    assert.deepEqual(preflight.selectedSkillIds, ['routing-active']);
    assert.equal(preflight.skillReason, 'ACTIVE_SKILL_MATCH');
    assert.equal(preflight.requiredCapability, 'reasoning');
    assert.equal(preflight.status, 'RESOURCE_PENDING');
    assert.equal(preflight.selectedResource, null);

    const routed = finalizeSkillRoutingPreflight(preflight, {
      resource: { id: 'NV20', resourceId: 'res:nvidia:test', provider: 'nvidia' },
      routingDecision: { chosen: { employeeId: 'NV20', resourceId: 'res:nvidia:test', provider: 'nvidia' } },
    });
    assert.equal(routed.status, 'ROUTED');
    assert.equal(routed.chain.jobId, 'JOB-1');
    assert.deepEqual(routed.chain.selectedSkillIds, ['routing-active']);
    assert.equal(routed.chain.requiredCapability, 'reasoning');
    assert.equal(routed.chain.resourceId, 'res:nvidia:test');
  } finally { f.cleanup(); }
});

test('CANDIDATE, VALIDATED, and irrelevant ACTIVE skills never auto-load', () => {
  const f = skillFixture();
  try {
    const skillContext = matchAndLoadSkills('routing provider capability', { registryPath: f.registryPath, baseDir: f.dir });
    assert.deepEqual(skillContext.skills.map((skill: { id: string }) => skill.id), ['routing-active']);
  } finally { f.cleanup(); }
});

test('no-skill path is deterministic and explicitly generic', () => {
  const preflight = buildSkillRoutingPreflight({
    jobId: 'JOB-NO-SKILL',
    objectiveText: 'totally unrelated objective',
    skillContext: { skills: [], skipped: [] },
    requiredCapability: 'general',
  });
  assert.equal(preflight.skillPolicy, 'ALLOW_GENERIC_WITH_REASON');
  assert.equal(preflight.skillReason, 'NO_RELEVANT_ACTIVE_SKILL');
  assert.equal(preflight.status, 'RESOURCE_PENDING');
});

test('registry rejection remains deterministic and does not invent a skill match', () => {
  const preflight = buildSkillRoutingPreflight({
    jobId: 'JOB-REGISTRY-ERROR',
    skillContext: { skills: [], skipped: [] },
    requiredCapability: 'reasoning',
    registryError: 'SKILL_REGISTRY_MALFORMED',
  });
  assert.deepEqual(preflight.selectedSkillIds, []);
  assert.equal(preflight.skillPolicy, 'ALLOW_GENERIC_WITH_REASON');
  assert.equal(preflight.skillReason, 'SKILL_REGISTRY_REJECTED_ALLOW_GENERIC');
  assert.equal(preflight.registryError, 'SKILL_REGISTRY_MALFORMED');
});

test('resource unavailable parks bounded and reviewer collision fails closed', () => {
  const preflight = buildSkillRoutingPreflight({
    jobId: 'JOB-REVIEW',
    skillContext: { skills: [{ id: 'automated-code-review-gate' }], skipped: [] },
    requiredCapability: 'review',
    reviewerResourceIds: ['res:implementer'],
  });
  const parked = finalizeSkillRoutingPreflight(preflight, {
    failures: [{ resourceId: 'res:first', provider: 'x', kind: 'timeout', message: 'timeout' }],
    unavailableReason: 'NO_AI_RESOURCE_AVAILABLE',
  });
  assert.equal(parked.status, 'PARKED');
  assert.equal(parked.resourceReason, 'NO_AI_RESOURCE_AVAILABLE');
  assert.equal(parked.fallback.policy, 'BOUNDED_FAILOVER_OR_PARK');
  assert.equal(parked.fallback.attemptedCount, 1);

  assert.throws(() => finalizeSkillRoutingPreflight(preflight, {
    resource: { id: 'NVX', resourceId: 'res:implementer', provider: 'test' },
  }), /SKILL_PREFLIGHT_REVIEWER_COLLISION/);
});

test('Core emits durable JOB -> SKILL -> CAPABILITY -> RESOURCE evidence around existing router', () => {
  const core = readFileSync(join(process.cwd(), 'apps/tigeriq-core/core.mjs'), 'utf8');
  const preflightIndex = core.indexOf("event('SKILL_ROUTING_PREFLIGHT'");
  const routeIndex = core.indexOf('invokeRouted(routedPrompt');
  const chainIndex = core.indexOf("event('SKILL_ROUTING_CHAIN'");
  assert.ok(preflightIndex >= 0);
  assert.ok(routeIndex > preflightIndex);
  assert.ok(chainIndex > routeIndex);
  assert.match(core, /reviewerResourceIdsForJob\(j\)/);
  assert.match(core, /SKILL_ROUTING_PARKED/);
});
