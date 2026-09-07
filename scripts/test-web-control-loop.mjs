import assert from 'node:assert/strict';
import {
  WEB_LOOP_STATES,
  nextSafeWork,
  oneCommandWebControlPlan,
  planWebSelfHealingCycle,
  prioritizeSafeFindings,
  transitionWebSelfHealing,
} from '../api/web-control-loop.mjs';

const findings = [
  { id: 'unsafe', priority: 'P0', safeOffMain: false, mainMutation: true },
  { id: 'p1', priority: 'P1', severity: 2, safeOffMain: true },
  { id: 'p0', priority: 'P0', severity: 1, safeOffMain: true },
];

assert.deepEqual(prioritizeSafeFindings(findings).map((x) => x.id), ['p0', 'p1']);
assert.equal(nextSafeWork({ findings }).item.id, 'p0');

const plan = planWebSelfHealingCycle({ findings });
assert.equal(plan.ok, true);
assert.equal(plan.state, WEB_LOOP_STATES.FIXING);
assert.equal(plan.action, 'fix-off-main');
assert.equal(plan.workId, 'p0');
assert.equal(plan.priority, 'P0');
assert.equal(plan.requiresVerification, true);
assert.equal(plan.requiresEvidence, true);

for (const command of ['1', 'L', 'l', '  L ']) {
  const oneCommand = oneCommandWebControlPlan({ command, findings });
  assert.equal(oneCommand.accepted, true);
  assert.equal(oneCommand.lane, 'web-control');
  assert.equal(oneCommand.command, '1');
  assert.equal(oneCommand.inputCommand, String(command).trim());
  assert.equal(oneCommand.cycle.state, WEB_LOOP_STATES.FIXING);
  assert.equal(oneCommand.cycle.action, 'fix-off-main');
  assert.equal(oneCommand.cycle.workId, 'p0');
}

const rejectedCommand = oneCommandWebControlPlan({ command: '  2  ', findings });
assert.equal(rejectedCommand.accepted, false);
assert.equal(rejectedCommand.reason, 'unsupported_command');

const mainPlan = planWebSelfHealingCycle({ authorization: { mainMutation: true }, findings });
assert.equal(mainPlan.ok, false);
assert.equal(mainPlan.code, 'MAIN_OR_PRODUCTION_FORBIDDEN');

const paidPlan = planWebSelfHealingCycle({ authorization: { paidAction: true }, findings });
assert.equal(paidPlan.state, WEB_LOOP_STATES.AUTHORIZATION_REQUIRED);

const waitPlan = planWebSelfHealingCycle({ currentStage: 'external-wait', findings });
assert.equal(waitPlan.state, WEB_LOOP_STATES.EXTERNAL_WAIT);

const emptyPlan = planWebSelfHealingCycle({ findings: [], backlog: [] });
assert.equal(emptyPlan.ok, true);
assert.equal(emptyPlan.state, WEB_LOOP_STATES.DONE);
assert.equal(emptyPlan.action, 'record-evidence');

assert.deepEqual(transitionWebSelfHealing({ state: WEB_LOOP_STATES.IDLE, event: 'audit-start' }), { state: WEB_LOOP_STATES.AUDITING });
assert.deepEqual(transitionWebSelfHealing({ state: WEB_LOOP_STATES.AUDITING, event: 'audit-complete' }), { state: WEB_LOOP_STATES.SELECTING });
assert.deepEqual(transitionWebSelfHealing({ state: WEB_LOOP_STATES.SELECTING, event: 'safe-work-selected' }), { state: WEB_LOOP_STATES.FIXING });
assert.deepEqual(transitionWebSelfHealing({ state: WEB_LOOP_STATES.FIXING, event: 'fix-complete' }), { state: WEB_LOOP_STATES.VERIFYING });
assert.deepEqual(
  transitionWebSelfHealing({
    state: WEB_LOOP_STATES.VERIFYING,
    event: 'verification-pass',
    evidence: { exact: true, reproducible: true },
  }),
  { state: WEB_LOOP_STATES.RECORDING },
);
assert.equal(
  transitionWebSelfHealing({
    state: WEB_LOOP_STATES.VERIFYING,
    event: 'verification-pass',
    evidence: { exact: false, reproducible: true },
  }).code,
  'NO_FALSE_PASS',
);
assert.deepEqual(transitionWebSelfHealing({ state: WEB_LOOP_STATES.RECORDING, event: 'evidence-recorded' }), { state: WEB_LOOP_STATES.ADVANCING });
assert.deepEqual(transitionWebSelfHealing({ state: WEB_LOOP_STATES.ADVANCING, event: 'next-selected' }), { state: WEB_LOOP_STATES.SELECTING });
assert.equal(
  transitionWebSelfHealing({ state: WEB_LOOP_STATES.SELECTING, event: 'no-safe-work' }).state,
  WEB_LOOP_STATES.DONE,
);
assert.equal(
  transitionWebSelfHealing({ state: WEB_LOOP_STATES.FIXING, event: 'made-up-event' }).code,
  'INVALID_TRANSITION',
);

console.log('WEB_SELF_HEALING_LOOP_PASS');
