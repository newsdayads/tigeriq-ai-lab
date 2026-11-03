import { createHash } from 'node:crypto';

export const SPEC_INTEGRITY_SCHEMA = 'TIGERIQ_SPEC_INTEGRITY_V1';

export const SPEC_INTEGRITY_STATUS = Object.freeze({
  PASSED: 'PASSED',
  ACCEPTED: 'ACCEPTED',
  BLOCKED: 'BLOCKED',
  INCOMPLETE_ASSESSMENT: 'INCOMPLETE_ASSESSMENT',
});

const isSha = s => /^[a-f0-9]{40}$/i.test(String(s ?? '').trim());
const string = s => String(s ?? '').trim();

const PLACEHOLDER_PATTERN = /\b(TBD|TODO|FIXME|TBA|PENDING)\b|\?{2,}/i;

function isValidUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  const s = rawUrl.trim();
  if (!s || s === 'https://' || s === 'http://') return false;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (!u.hostname) return false;
    if (u.username || u.password) return false;
    return true;
  } catch {
    return false;
  }
}

function parseBooleanOption(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return Boolean(val);
}

function hasUnresolved(item) {
  if (!item) return false;
  if (Array.isArray(item)) return item.length > 0;
  if (typeof item === 'object') return Object.keys(item).length > 0;
  if (typeof item === 'string') return item.trim().length > 0;
  return true;
}

export function validateSpecArtifacts(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { valid: false, code: 'SPEC_INVALID', reasons: ['SPEC_MUST_BE_OBJECT'] };
  }

  if (hasUnresolved(spec.unresolved_questions) || hasUnresolved(spec.unresolvedQuestions)) {
    return { valid: false, code: 'UNRESOLVED_QUESTIONS_PRESENT', reasons: ['SPEC_CONTAINS_UNRESOLVED_QUESTIONS'] };
  }

  if (hasUnresolved(spec.conflicts)) {
    return { valid: false, code: 'SPEC_CONFLICTS_PRESENT', reasons: ['SPEC_CONTAINS_CONFLICTS'] };
  }

  return { valid: true };
}

export function verifyTraceabilityMatrix(spec, plan, receipts, options = {}) {
  return evaluateSpecIntegrity({ spec, plan, receipts, ...options });
}

export function evaluateSpecIntegrity(input = {}, options = {}) {
  // Preflight: robust fail-closed for root input
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      pass: false,
      status: SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT,
      code: 'INPUT_INVALID',
      reasons: ['ROOT_INPUT_INVALID'],
      checked: 0,
      total: 0,
      details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
    };
  }

  const opts = (options && typeof options === 'object' && !Array.isArray(options)) ? options : {};
  const requirePlan = parseBooleanOption(opts.require_plan ?? opts.requirePlan ?? input.require_plan ?? input.requirePlan);

  const spec = input.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return {
      pass: false,
      status: SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT,
      code: 'SPEC_MISSING',
      reasons: ['SPEC_MUST_BE_OBJECT'],
      checked: 0,
      total: 0,
      details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
    };
  }

  const specCheck = validateSpecArtifacts(spec);
  if (!specCheck.valid) {
    return {
      pass: false,
      status: SPEC_INTEGRITY_STATUS.BLOCKED,
      code: specCheck.code,
      reasons: specCheck.reasons,
      checked: 0,
      total: 0,
      details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
    };
  }

  // Preflight plan_decisions format
  const plan = input.plan;
  if (plan !== undefined && plan !== null) {
    if (typeof plan !== 'object' || Array.isArray(plan)) {
      return {
        pass: false,
        status: SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT,
        code: 'PLAN_INVALID_FORMAT',
        reasons: ['PLAN_MUST_BE_OBJECT'],
        checked: 0,
        total: 0,
        details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
      };
    }
    if (plan.plan_decisions !== undefined && plan.plan_decisions !== null && !Array.isArray(plan.plan_decisions)) {
      return {
        pass: false,
        status: SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT,
        code: 'PLAN_DECISIONS_INVALID_FORMAT',
        reasons: ['PLAN_DECISIONS_MUST_BE_ARRAY'],
        checked: 0,
        total: 0,
        details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
      };
    }
  }

  // Preflight receipts format
  if (input.receipts !== undefined && input.receipts !== null && !Array.isArray(input.receipts)) {
    return {
      pass: false,
      status: SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT,
      code: 'RECEIPTS_INVALID_FORMAT',
      reasons: ['RECEIPTS_MUST_BE_ARRAY'],
      checked: 0,
      total: 0,
      details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
    };
  }

  if (requirePlan && (!plan || !Array.isArray(plan.tasks) || plan.tasks.length === 0)) {
    return {
      pass: false,
      status: SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT,
      code: 'PLAN_REQUIRED_BUT_MISSING',
      reasons: ['PLAN_REQUIRED_BUT_MISSING_OR_EMPTY'],
      checked: 0,
      total: 0,
      details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
    };
  }

  // Collect requirements
  const reqItems = [];
  const addReq = (id, text, type = 'FR') => {
    const cid = string(id);
    const ctext = string(text);
    if (cid || ctext) {
      reqItems.push({ id: cid || `${type}-${reqItems.length + 1}`, text: ctext, type });
    }
  };

  const rawReqs = spec.requirements || spec.fr;
  if (Array.isArray(rawReqs)) {
    for (const r of rawReqs) {
      if (typeof r === 'string') addReq('', r, 'FR');
      else if (r && typeof r === 'object') addReq(r.id, r.text || r.name || r.description, 'FR');
    }
  }

  const rawSc = spec.sc || spec.success_criteria || spec.successCriteria;
  if (Array.isArray(rawSc)) {
    for (const s of rawSc) {
      if (typeof s === 'string') addReq('', s, 'SC');
      else if (s && typeof s === 'object') addReq(s.id, s.text || s.name || s.description, 'SC');
    }
  }

  const rawAc = spec.acceptance || spec.acceptance_criteria || spec.acceptanceCriteria;
  if (Array.isArray(rawAc)) {
    for (const a of rawAc) {
      if (typeof a === 'string') addReq('', a, 'AC');
      else if (a && typeof a === 'object') addReq(a.id, a.text || a.name || a.description, 'AC');
    }
  }

  if (reqItems.length === 0) {
    return {
      pass: false,
      status: SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT,
      code: 'SPEC_MISSING_REQUIREMENTS',
      reasons: ['SPEC_HAS_NO_REQUIREMENTS_OR_ACCEPTANCE_CRITERIA'],
      checked: 0,
      total: 0,
      details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
    };
  }

  // Placeholder check in requirements / acceptance
  for (const r of reqItems) {
    if (PLACEHOLDER_PATTERN.test(r.text) || PLACEHOLDER_PATTERN.test(r.id)) {
      return {
        pass: false,
        status: SPEC_INTEGRITY_STATUS.BLOCKED,
        code: 'ACCEPTANCE_PLACEHOLDER_DETECTED',
        reasons: [`CRITERIA_CONTAINS_PLACEHOLDER:${r.id || r.text}`],
        checked: 0,
        total: reqItems.length,
        details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
      };
    }
  }

  // Plan verification if plan provided
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  if (plan && !Array.isArray(plan.tasks)) {
    return {
      pass: false,
      status: SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT,
      code: 'PLAN_TASKS_INVALID_FORMAT',
      reasons: ['PLAN_TASKS_MUST_BE_ARRAY'],
      checked: 0,
      total: reqItems.length,
      details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
    };
  }

  const seenTaskIds = new Set();
  const taskMap = new Map();
  for (const t of tasks) {
    if (!t || typeof t !== 'object') {
      return {
        pass: false,
        status: SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT,
        code: 'PLAN_TASK_INVALID',
        reasons: ['TASK_MUST_BE_OBJECT'],
        checked: 0,
        total: reqItems.length,
        details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
      };
    }
    const tid = string(t.id || t.taskId || t.task_id);
    if (!tid) {
      return {
        pass: false,
        status: SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT,
        code: 'PLAN_TASK_INVALID',
        reasons: ['TASK_ID_MISSING'],
        checked: 0,
        total: reqItems.length,
        details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
      };
    }
    if (seenTaskIds.has(tid)) {
      return {
        pass: false,
        status: SPEC_INTEGRITY_STATUS.BLOCKED,
        code: 'PLAN_TASKS_DUPLICATED',
        reasons: [`DUPLICATE_TASK_ID:${tid}`],
        checked: 0,
        total: reqItems.length,
        details: { unmappedRequirements: [], missingReceipts: [], invalidReceipts: [] }
      };
    }
    seenTaskIds.add(tid);
    taskMap.set(tid, t);
  }

  // Expected source head SHA
  const expectedSha = string(input.sourceHeadSha || input.headSha || input.source_revision).toLowerCase();
  const rawReceipts = Array.isArray(input.receipts) ? input.receipts : [];

  const unmappedRequirements = [];
  const missingReceipts = [];
  const invalidReceipts = [];
  let checkedCount = 0;

  for (const req of reqItems) {
    // If plan exists, check mapping from req -> task
    if (tasks.length > 0) {
      const isMapped = tasks.some(t => {
        const reqs = Array.isArray(t.requirements) ? t.requirements : [t.requirements, t.requirement_id, t.req_id].filter(Boolean);
        return reqs.map(string).includes(req.id);
      });
      if (!isMapped) {
        unmappedRequirements.push(req.id);
      }
    }

    // Check receipt for this req
    const matchingReceipts = rawReceipts.filter(rc => {
      if (!rc || typeof rc !== 'object') return false;
      const rReqId = string(rc.requirement_id || rc.req_id || rc.requirementId || rc.id);
      return rReqId === req.id || (!rReqId && rawReceipts.length === 1 && reqItems.length === 1);
    });

    if (matchingReceipts.length === 0) {
      missingReceipts.push(req.id);
      continue;
    }

    let reqPassed = false;
    for (const rc of matchingReceipts) {
      const rSha = string(rc.head_sha || rc.headSha || rc.sha).toLowerCase();
      const rUrl = string(rc.proof_url || rc.proofUrl || rc.url || rc.details_url);
      const rStatus = string(rc.status).toLowerCase();
      const rConclusion = string(rc.conclusion).toLowerCase();

      if (!isValidUrl(rUrl)) {
        invalidReceipts.push({ reqId: req.id, reason: 'PROOF_URL_INVALID', url: rUrl });
        continue;
      }

      if (expectedSha && isSha(expectedSha)) {
        if (!rSha || !isSha(rSha)) {
          invalidReceipts.push({ reqId: req.id, reason: 'SHA_INVALID', sha: rSha });
          continue;
        }
        if (rSha !== expectedSha) {
          invalidReceipts.push({ reqId: req.id, reason: 'STALE_SHA_DETECTED', sha: rSha, expected: expectedSha });
          continue;
        }
      }

      const isCompleted = !rStatus || rStatus === 'completed' || rStatus === 'done' || rStatus === 'success';
      const isSuccess = !rConclusion || rConclusion === 'success' || rConclusion === 'passed';
      if (!isCompleted || !isSuccess) {
        invalidReceipts.push({ reqId: req.id, reason: 'RECEIPT_NOT_SUCCESSFUL', status: rStatus, conclusion: rConclusion });
        continue;
      }

      reqPassed = true;
    }

    if (reqPassed) {
      checkedCount++;
    }
  }

  const reasons = [];
  if (unmappedRequirements.length > 0) {
    reasons.push(`UNMAPPED_REQUIREMENTS:${unmappedRequirements.join(',')}`);
  }
  if (missingReceipts.length > 0) {
    reasons.push(`MISSING_RECEIPTS:${missingReceipts.join(',')}`);
  }
  if (invalidReceipts.length > 0) {
    reasons.push(`INVALID_RECEIPTS:${invalidReceipts.map(i => `${i.reqId}:${i.reason}`).join(',')}`);
  }

  const allPassed = checkedCount === reqItems.length && reqItems.length > 0 && reasons.length === 0;

  return {
    pass: allPassed,
    status: allPassed ? SPEC_INTEGRITY_STATUS.ACCEPTED : SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT,
    code: allPassed ? 'SPEC_INTEGRITY_PASSED' : (reasons[0]?.split(':')[0] || 'INCOMPLETE_ASSESSMENT'),
    reasons,
    checked: checkedCount,
    total: reqItems.length,
    details: {
      unmappedRequirements,
      missingReceipts,
      invalidReceipts
    }
  };
}

export function assertSpecIntegrity(input, options) {
  const result = evaluateSpecIntegrity(input, options);
  if (!result.pass) {
    const msg = `SPEC_INTEGRITY_FAILED: ${result.code} - ${result.reasons.join('; ')}`;
    const err = new Error(msg);
    err.result = result;
    throw err;
  }
  return result;
}
