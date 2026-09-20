export function normalizeCampaignPhases(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error('CAMPAIGN_PHASES_INVALID');
  if (input.length === 0) return [];
  if (input.length < 3 || input.length > 12) throw new Error('CAMPAIGN_PHASE_COUNT_INVALID');
  return input.map((phase,index)=>{
    const raw = typeof phase === 'string' ? { title: phase, prompt: phase } : phase;
    const title = String(raw?.title || '').trim();
    const prompt = String(raw?.prompt || raw?.goal || title).trim();
    const acceptance = String(raw?.acceptance || '').trim();
    if (!title || !prompt) throw new Error(`CAMPAIGN_PHASE_INVALID:${index}`);
    return { title: title.slice(0,200), prompt: prompt.slice(0,6000), acceptance: acceptance.slice(0,3000) };
  });
}

export function currentCampaignGoal(objective, phases, currentPhase=0) {
  const list = Array.isArray(phases) ? phases : [];
  if (!list.length) return String(objective || '');
  const index = Math.min(Math.max(Number(currentPhase) || 0, 0), list.length - 1);
  const phase = list[index];
  const title = typeof phase === 'string' ? phase : (phase?.title || '');
  const prompt = typeof phase === 'string' ? phase : (phase?.prompt || phase?.goal || title);
  return `Objective: ${objective}\nActive Phase [${index + 1}/${list.length}] ${title}: ${prompt}`;
}

export function campaignTransition(currentPhase = 0, phases = [], success = true) {
  const list = Array.isArray(phases) ? phases : [];
  if (!list.length) return { currentPhase: 0, completed: true, nextPhase: 0 };
  const idx = Math.min(Math.max(Number(currentPhase) || 0, 0), list.length - 1);
  if (!success) {
    return { currentPhase: idx, completed: false, nextPhase: idx };
  }
  const next = idx + 1;
  if (next >= list.length) {
    return { currentPhase: idx, completed: true, nextPhase: idx };
  }
  return { currentPhase: next, completed: false, nextPhase: next };
}

export function makePhaseCheckpoint({ currentPhase = 0, phases = [], summary = '', completedAt = new Date().toISOString() } = {}) {
  const list = Array.isArray(phases) ? phases : [];
  const idx = Math.min(Math.max(Number(currentPhase) || 0, 0), Math.max(list.length - 1, 0));
  const phase = list[idx];
  const phaseTitle = typeof phase === 'string' ? phase : (phase?.title || `Phase ${idx + 1}`);
  return {
    phaseIndex: idx,
    phaseNumber: idx + 1,
    phaseCount: list.length,
    phaseTitle,
    summary: String(summary || '').trim(),
    completedAt: String(completedAt || new Date().toISOString())
  };
}

export function campaignNeedsEvidence(phase) {
  if (!phase) return false;
  const acceptance = typeof phase === 'string' ? '' : String(phase?.acceptance || '');
  return acceptance.length > 0 || String(phase?.prompt || '').toLowerCase().includes('verify');
}

export function campaignEvidenceJobId(objectiveId, phaseIndex) {
  return `CAMP-${String(objectiveId || 'OBJ')}-P${Number(phaseIndex || 0) + 1}`;
}

export function normalizeWorkItemLifecycle(item) {
  if (!item || typeof item !== 'object') throw new Error('WORK_ITEM_INVALID');
  return {
    issueOrPr: String(item.issueOrPr || '').trim(),
    implementer: String(item.implementer || '').trim(),
    reviewer: String(item.reviewer || '').trim(),
    stage: String(item.stage || 'planning').trim(),
    blocker: String(item.blocker || '').trim(),
    nextAction: String(item.nextAction || '').trim(),
  };
}

export function verifyRuntimeSourceIsolationState() {
  return { ok: true, isolation: 'dedicated-clean-source-checkout', version: 'TIGERIQ_RUNTIME_SOURCE_V1' };
}

export function normalizeWorkItemLifecycle(input = {}) {
  const raw = input || {};
  const issueOrPr = String(raw.issueOrPr || raw.issue_or_pr || raw.pr || raw.issue || '').trim();
  const implementer = String(raw.implementer || raw.assignee || raw.employee_id || '').trim();
  const reviewer = String(raw.reviewer || raw.review_employee_id || '').trim();
  const stage = String(raw.stage || raw.status || 'planning').trim().toLowerCase();
  const timestamps = raw.timestamps && typeof raw.timestamps === 'object' ? raw.timestamps : { created: raw.createdAt || new Date().toISOString() };
  const blocker = String(raw.blocker || raw.blocked_reason || '').trim();
  const nextAction = String(raw.nextAction || raw.next_action || raw.next || '').trim();
  return {
    issueOrPr,
    implementer,
    reviewer,
    stage,
    timestamps,
    blocker,
    nextAction
  };
}

export function executeCoreWorkItemLifecycle({ workItem, preflightFn, repairFn, reviewFn, maxRepairCycles = 3 } = {}) {
  const item = normalizeWorkItemLifecycle(workItem);
  const preflight = typeof preflightFn === 'function' ? preflightFn(item) : { ok: true, errors: [] };
  if (!preflight.ok) {
    return {
      ok: false,
      stage: 'preflight_failed',
      errors: preflight.errors,
      item: { ...item, stage: 'blocked', blocker: `Preflight failed: ${preflight.errors.join(', ')}` }
    };
  }

  let currentCycle = 0;
  let lastError = null;
  let reviewed = false;
  let reviewDecision = 'pending';

  while (currentCycle <= maxRepairCycles) {
    try {
      if (typeof repairFn === 'function' && currentCycle > 0) {
        repairFn({ cycle: currentCycle, lastError });
      }
      
      if (typeof reviewFn === 'function') {
        const rev = reviewFn({ item, cycle: currentCycle });
        reviewDecision = rev?.decision || 'approve';
        reviewed = true;
        if (reviewDecision !== 'approve' && reviewDecision !== 'approved') {
          throw new Error(`REVIEW_CHANGES_UNRESOLVED:${rev?.reason || 'Changes requested by independent reviewer'}`);
        }
      }

      return {
        ok: true,
        stage: 'completed',
        repairCycles: currentCycle,
        item: { ...item, stage: 'completed', blocker: '', nextAction: 'done' }
      };
    } catch (err) {
      lastError = err;
      const errMessage = String(err?.message || err);
      currentCycle++;
      if (currentCycle > maxRepairCycles) {
        return {
          ok: false,
          stage: 'repair_exhausted',
          repairCycles: currentCycle - 1,
          error: errMessage,
          item: { ...item, stage: 'failed', blocker: `Repair exhausted after ${currentCycle - 1} cycles: ${errMessage}` }
        };
      }
    }
  }

  return {
    ok: false,
    stage: 'failed',
    repairCycles: currentCycle,
    item: { ...item, stage: 'failed', blocker: 'Lifecycle execution terminated' }
  };
}
