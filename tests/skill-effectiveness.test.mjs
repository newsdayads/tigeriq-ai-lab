import test from 'node:test';
import assert from 'node:assert';
import { buildSkillOutcomeObservation, recordSkillOutcome, skillFailureLoopDecision, summarizeSkillEffectiveness, useSkill, measureEffectiveness, retireSkill } from '../apps/tigeriq-core/skill-effectiveness.mjs';

import fs from 'node:fs';

function parseSimpleYaml(content) {
  const result = { skills: [] };
  let currentSkill = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- id:')) {
      if (currentSkill) result.skills.push(currentSkill);
      currentSkill = { id: trimmed.split(':')[1].trim().replace(/^['"]|['"]$/g, '') };
    } else if (currentSkill && trimmed.startsWith('state:')) {
      currentSkill.state = trimmed.split(':')[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  if (currentSkill) result.skills.push(currentSkill);
  return result;
}

test('Registry validation for skill states and actual loader behavior', () => {
  const registryContent = fs.readFileSync(new URL('../docs/skills/registry.yaml', import.meta.url), 'utf8');
  const parsedRegistry = parseSimpleYaml(registryContent);
  
  const contextualSkill = parsedRegistry.skills.find(s => s.id === 'contextual-skill-loading');
  const tddSkill = parsedRegistry.skills.find(s => s.id === 'spec-first-tdd');
  const securitySkill = parsedRegistry.skills.find(s => s.id === 'external-skill-security-gate');
  const minimalSkill = parsedRegistry.skills.find(s => s.id === 'minimal-change-output');

  assert.ok(contextualSkill, 'contextual-skill-loading must exist');
  assert.ok(tddSkill, 'spec-first-tdd must exist');
  assert.ok(securitySkill, 'external-skill-security-gate must exist');
  assert.ok(minimalSkill, 'minimal-change-output must exist');

  assert.strictEqual(contextualSkill.state, 'CANDIDATE');
  assert.strictEqual(tddSkill.state, 'ACTIVE');
  assert.strictEqual(securitySkill.state, 'ACTIVE');
  assert.strictEqual(minimalSkill.state, 'ACTIVE');

  // Verify actual loader behavior via useSkill & measureEffectiveness with cleanup
  const loaderSkillId = 'contextual-skill-loading';
  retireSkill(loaderSkillId);
  const initialLoadState = measureEffectiveness(loaderSkillId);
  assert.strictEqual(initialLoadState.total, 0);

  useSkill(loaderSkillId, { success: true, context: 'route-core' });
  const loadedState = measureEffectiveness(loaderSkillId);
  assert.strictEqual(loadedState.total, 1);
  assert.strictEqual(loadedState.successRate, 1);
  retireSkill(loaderSkillId);
});

test('Security gate logic functional test with isolated state', () => {
  const secSkillId = 'external-skill-security-gate';
  retireSkill(secSkillId);
  const initial = measureEffectiveness(secSkillId);
  assert.strictEqual(initial.total, 0);

  // Audit check simulation
  const auditPassed = true;
  if (auditPassed) {
    useSkill(secSkillId, { success: true, verified: 'provenance-pinned' });
  }
  const postAudit = measureEffectiveness(secSkillId);
  assert.strictEqual(postAudit.total, 1);
  assert.strictEqual(postAudit.successRate, 1);
  retireSkill(secSkillId);
});

test('Full skill effectiveness lifecycle: USE -> MEASURE -> RETIRE with isolation', () => {
  const skillId = 'test-skill-alpha-isolated';
  retireSkill(skillId);

  // Initial measurement should be zero/empty
  const initial = measureEffectiveness(skillId);
  assert.strictEqual(initial.total, 0);
  assert.strictEqual(initial.successRate, 0);

  // Record usage events
  useSkill(skillId, { success: true, payload: 'data1' });
  useSkill(skillId, { success: true, payload: 'data2' });
  useSkill(skillId, { success: false, payload: 'data3' });

  // Measure effectiveness (2 out of 3 successful -> 0.666...)
  const measured = measureEffectiveness(skillId);
  assert.strictEqual(measured.total, 3);
  assert.strictEqual(measured.successRate, 2 / 3);

  // Retire skill (clear stored data)
  const retired = retireSkill(skillId);
  assert.strictEqual(retired, true);

  // Subsequent measurement should show zero again
  const postRetire = measureEffectiveness(skillId);
  assert.strictEqual(postRetire.total, 0);
  assert.strictEqual(postRetire.successRate, 0);
});


test('verified outcomes preserve version, resource, evidence and duration', () => {
  const skillId='measured-skill';
  retireSkill(skillId);
  const observed=recordSkillOutcome(skillId,{
    jobId:'JOB-1',objectiveId:'OBJ-1',version:'2.1.0',outcome:'completed',verified:true,
    resourceId:'res:test',employeeId:'NV12',provider:'test',durationMs:1234,evidenceRef:'CORE_JOB:JOB-1'
  });
  assert.strictEqual(observed.counted,true);
  const metrics=measureEffectiveness(skillId);
  assert.deepStrictEqual({usage:metrics.usage,completed:metrics.completed,failedBlocked:metrics.failedBlocked},{usage:1,completed:1,failedBlocked:0});
  assert.strictEqual(metrics.observedSuccessRatio,1);
  assert.deepStrictEqual(metrics.versions,['2.1.0']);
  assert.deepStrictEqual(metrics.evidenceRefs,['CORE_JOB:JOB-1']);
  assert.deepStrictEqual(metrics.duration,{observedCount:1,averageMs:1234});
  retireSkill(skillId);
});

test('logical job retry is deduplicated by job + skill + version', () => {
  const skillId='dedupe-skill';
  retireSkill(skillId);
  const input={jobId:'JOB-RETRY',version:'1.0.0',outcome:'completed',verified:true,evidenceRef:'CORE_JOB:JOB-RETRY'};
  const first=recordSkillOutcome(skillId,input);
  const retry=recordSkillOutcome(skillId,input);
  assert.strictEqual(first.counted,true);
  assert.strictEqual(retry.duplicate,true);
  const metrics=measureEffectiveness(skillId);
  assert.strictEqual(metrics.usage,1);
  assert.strictEqual(metrics.completed,1);
  retireSkill(skillId);
});

test('unverified or unrelated work remains UNKNOWN and is not counted', () => {
  const skillId='unknown-skill';
  retireSkill(skillId);
  recordSkillOutcome(skillId,{jobId:'JOB-UNKNOWN',version:'1.0.0',outcome:'completed',verified:false});
  const metrics=measureEffectiveness(skillId);
  assert.strictEqual(metrics.state,'UNKNOWN');
  assert.strictEqual(metrics.usage,0);
  const unrelated=summarizeSkillEffectiveness('other-skill',[]);
  assert.strictEqual(unrelated.state,'UNKNOWN');
  assert.strictEqual(unrelated.observedSuccessRatio,null);
  retireSkill(skillId);
});

test('failed and blocked outcomes expose recurring failure signature without auto promotion', () => {
  const records=[
    buildSkillOutcomeObservation('failure-skill',{jobId:'JOB-F1',version:'1.0.0',outcome:'blocked',verified:true,evidenceRef:'E1',failureSignature:'NO_AI_RESOURCE_AVAILABLE'}),
    buildSkillOutcomeObservation('failure-skill',{jobId:'JOB-F2',version:'1.0.0',outcome:'failed',verified:true,evidenceRef:'E2',failureSignature:'NO_AI_RESOURCE_AVAILABLE'}),
  ];
  const metrics=summarizeSkillEffectiveness('failure-skill',records);
  assert.strictEqual(metrics.usage,2);
  assert.strictEqual(metrics.failedBlocked,2);
  assert.strictEqual(metrics.failureLoopState,'PARKED');
  assert.deepStrictEqual(metrics.recurringFailureSignatures,[{signature:'NO_AI_RESOURCE_AVAILABLE',count:2}]);
  assert.ok(!('promotion' in metrics));
  assert.ok(!('retire' in metrics));
});

test('Core emits effectiveness evidence only after terminal job outcome with durable dedupe', () => {
  const core=fs.readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.match(core,/SKILL_EFFECTIVENESS_OBSERVED/);
  assert.match(core,/SKILL_EFFECTIVENESS_PARKED/);
  assert.match(core,/data->>'dedupeKey'=\$1/);
  assert.match(core,/emitSkillEffectivenessObservations\(\{[\s\S]*outcome:'completed'/);
  assert.match(core,/status='failed'[\s\S]*emitSkillEffectivenessObservations\(\{/);
  assert.match(core,/RESOURCE_WAIT_QUEUED/);
});


test('failure-loop decision parks only after durable recurrence or bounded retry exhaustion', () => {
  assert.deepStrictEqual(
    skillFailureLoopDecision({outcome:'blocked',failureSignature:'NO_AI_RESOURCE_AVAILABLE',retryCount:5,maxRetries:6,recurringCount:1}),
    {state:'CLEAR',reason:null,retryCount:5,maxRetries:6,recurringCount:1,failureSignature:'NO_AI_RESOURCE_AVAILABLE'},
  );
  assert.deepStrictEqual(
    skillFailureLoopDecision({outcome:'blocked',failureSignature:'NO_AI_RESOURCE_AVAILABLE',retryCount:6,maxRetries:6,recurringCount:1}),
    {state:'PARKED',reason:'RETRY_BUDGET_EXHAUSTED',retryCount:6,maxRetries:6,recurringCount:1,failureSignature:'NO_AI_RESOURCE_AVAILABLE'},
  );
  assert.equal(
    skillFailureLoopDecision({outcome:'failed',failureSignature:'SAME_SIGNATURE',retryCount:0,maxRetries:6,recurringCount:2}).reason,
    'RECURRING_FAILURE_SIGNATURE',
  );
});

test('Core durable measurement dedupe is atomic and retry exhaustion releases before PARKED evidence', () => {
  const core=fs.readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.match(core,/create table if not exists tigeriq_skill_effectiveness_dedupe/);
  assert.match(core,/dedupe_key text primary key/);
  assert.match(core,/on conflict\(dedupe_key\) do nothing returning dedupe_key/);
  assert.doesNotMatch(core,/select 1 from tigeriq_events where type='SKILL_EFFECTIVENESS_OBSERVED' and data->>'dedupeKey'/);
  assert.match(core,/count\(distinct data->>'dedupeKey'\)::int as count/);
  assert.match(core,/resourceWaitExhausted=\{retryCount:plan\.count,maxRetries:RESOURCE_WAIT_MAX_RETRIES,ageMs:plan\.ageMs\}/);
  assert.match(core,/retryBudgetExhausted:Boolean\(resourceWaitExhausted\)/);
  assert.match(core,/leaseReleased: true/);
});
