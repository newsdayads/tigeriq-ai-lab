const TERMINAL_STAGES = new Set(['done', 'blocked', 'external-wait', 'authorization-required']);
const SAFE_ACTIONS = new Set(['audit', 'select', 'fix-off-main', 'verify', 'record-evidence', 'advance']);

export const WEB_LOOP_STATES = Object.freeze({
  IDLE: 'idle',
  AUDITING: 'auditing',
  SELECTING: 'selecting',
  FIXING: 'fixing-off-main',
  VERIFYING: 'verifying',
  RECORDING: 'recording-evidence',
  ADVANCING: 'advancing',
  BLOCKED: 'blocked',
  EXTERNAL_WAIT: 'external-wait',
  AUTHORIZATION_REQUIRED: 'authorization-required',
  DONE: 'done',
});

function fail(code, message, state = WEB_LOOP_STATES.BLOCKED) {
  return Object.freeze({ ok: false, state, code, message, action: null });
}

function priorityRank(value) {
  return ({ P0: 0, P1: 1, P2: 2 }[String(value || '').toUpperCase()] ?? 9);
}

function safeFinding(finding) {
  if (!finding || typeof finding !== 'object') return false;
  if (finding.production === true || finding.mainMutation === true) return false;
  if (finding.paidAction === true || finding.credentialWidening === true) return false;
  if (finding.securityWidening === true || finding.reboot === true || finding.irreversible === true) return false;
  return finding.safeOffMain === true;
}

export function prioritizeSafeFindings(findings = []) {
  return (Array.isArray(findings) ? findings : [])
    .filter((finding) => safeFinding(finding))
    .slice()
    .sort((a, b) => {
      const priority = priorityRank(a.priority) - priorityRank(b.priority);
      if (priority !== 0) return priority;
      const severity = Number(b.severity || 0) - Number(a.severity || 0);
      if (severity !== 0) return severity;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
}

export function nextSafeWork({ findings = [], backlog = [] } = {}) {
  const safe = prioritizeSafeFindings(findings);
  if (safe.length) return { source: 'finding', item: safe[0] };
  const candidates = (Array.isArray(backlog) ? backlog : [])
    .filter((item) => safeFinding(item) && !TERMINAL_STAGES.has(String(item.stage || '').toLowerCase()))
    .sort((a, b) => {
      const priority = priorityRank(a.priority) - priorityRank(b.priority);
      if (priority !== 0) return priority;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  return candidates.length ? { source: 'backlog', item: candidates[0] } : null;
}

export function planWebSelfHealingCycle({ findings = [], backlog = [], authorization = {}, currentStage = 'queued' } = {}) {
  if (authorization.production === true || authorization.mainMutation === true) {
    return fail('MAIN_OR_PRODUCTION_FORBIDDEN', 'Web self-healing is OFF-MAIN only.');
  }
  if (authorization.paidAction === true || authorization.credentialWidening === true || authorization.securityWidening === true) {
    return fail('AUTHORIZATION_REQUIRED', 'Requested action exceeds the current Web safety envelope.', WEB_LOOP_STATES.AUTHORIZATION_REQUIRED);
  }
  if (authorization.reboot === true || authorization.irreversible === true) {
    return fail('IRREVERSIBLE_ACTION_FORBIDDEN', 'Reboot/irreversible actions require explicit authorization.');
  }
  if (currentStage === 'external-wait') return fail('EXTERNAL_WAIT', 'External dependency is still pending.', WEB_LOOP_STATES.EXTERNAL_WAIT);

  const selected = nextSafeWork({ findings, backlog });
  if (!selected) {
    return Object.freeze({ ok: true, state: WEB_LOOP_STATES.DONE, action: 'record-evidence', reason: 'no-safe-web-work' });
  }

  const item = selected.item;
  if (!safeFinding(item)) return fail('UNSAFE_WORK_ITEM', 'Selected work item is outside the safe OFF-MAIN envelope.');

  return Object.freeze({
    ok: true,
    state: WEB_LOOP_STATES.FIXING,
    action: 'fix-off-main',
    source: selected.source,
    workId: String(item.id || ''),
    priority: String(item.priority || 'P2').toUpperCase(),
    requiresVerification: true,
    requiresEvidence: true,
    allowedActions: [...SAFE_ACTIONS],
    terminalStages: [...TERMINAL_STAGES],
  });
}

export function transitionWebSelfHealing({ state, event, evidence = {} } = {}) {
  const current = String(state || WEB_LOOP_STATES.IDLE);
  const next = String(event || '');

  if (next === 'audit-start') return { state: WEB_LOOP_STATES.AUDITING };
  if (current === WEB_LOOP_STATES.AUDITING && next === 'audit-complete') return { state: WEB_LOOP_STATES.SELECTING };
  if (current === WEB_LOOP_STATES.SELECTING && next === 'safe-work-selected') return { state: WEB_LOOP_STATES.FIXING };
  if (current === WEB_LOOP_STATES.FIXING && next === 'fix-complete') return { state: WEB_LOOP_STATES.VERIFYING };
  if (current === WEB_LOOP_STATES.VERIFYING && next === 'verification-pass') {
    if (evidence.exact === true && evidence.reproducible === true) return { state: WEB_LOOP_STATES.RECORDING };
    return fail('NO_FALSE_PASS', 'Verification cannot pass without exact reproducible evidence.');
  }
  if (current === WEB_LOOP_STATES.RECORDING && next === 'evidence-recorded') return { state: WEB_LOOP_STATES.ADVANCING };
  if (current === WEB_LOOP_STATES.ADVANCING && next === 'next-selected') return { state: WEB_LOOP_STATES.SELECTING };
  if (['authorization-required', 'external-wait', 'blocked'].includes(next)) {
    const mapped = next === 'authorization-required'
      ? WEB_LOOP_STATES.AUTHORIZATION_REQUIRED
      : next === 'external-wait'
        ? WEB_LOOP_STATES.EXTERNAL_WAIT
        : WEB_LOOP_STATES.BLOCKED;
    return { state: mapped };
  }
  if (current === WEB_LOOP_STATES.SELECTING && next === 'no-safe-work') return { state: WEB_LOOP_STATES.DONE };
  return fail('INVALID_TRANSITION', `${current} -> ${next} is not allowed.`);
}
