export function runExecutionPreflight({ skill, tool, state, context, workItem } = {}) {
  const errors = [];
  
  if (skill) {
    if (typeof skill !== 'object' || Array.isArray(skill)) {
      errors.push('INVALID_SKILL_FORMAT');
    } else {
      if (!skill.name && !skill.id) {
        errors.push('SKILL_MISSING_IDENTIFIER');
      }
    }
  }

  if (tool) {
    if (typeof tool !== 'object' || Array.isArray(tool)) {
      errors.push('INVALID_TOOL_FORMAT');
    } else {
      if (!tool.name && !tool.id) {
        errors.push('TOOL_MISSING_IDENTIFIER');
      }
    }
  }

  if (state) {
    if (typeof state !== 'object' || Array.isArray(state)) {
      errors.push('INVALID_STATE_FORMAT');
    } else if (state.status === 'blocked' || state.status === 'failed' || state.terminated === true) {
      errors.push(`STATE_TERMINATED_OR_BLOCKED:${state.status || 'terminated'}`);
    }
  }

  if (workItem) {
    if (typeof workItem !== 'object' || Array.isArray(workItem)) {
      errors.push('INVALID_WORK_ITEM_FORMAT');
    } else {
      if (!workItem.issueOrPr && !workItem.issue_or_pr && !workItem.pr && !workItem.issue) {
        errors.push('WORK_ITEM_MISSING_IDENTIFIER');
      }
      if (workItem.implementer && workItem.reviewer && workItem.implementer === workItem.reviewer) {
        errors.push('IMPLEMENTER_REVIEWER_COLLISION');
      }
    }
  }

  const watchdogPass = !state || (state.watchdogFailed !== true && state.healthProbeHealthy !== false);
  if (!watchdogPass) {
    errors.push('INDEPENDENT_WATCHDOG_REPAIR_REQUIRED');
  }
  if (state && state.restartCount > (state.maxRestarts || 3)) {
    errors.push('BOUNDED_RESTART_EXHAUSTED');
  }
  if (state && state.requiresRollback === true && !state.lastKnownGoodRestored) {
    errors.push('LAST_KNOWN_GOOD_ROLLBACK_REQUIRED');
  }
  return {
    ok: errors.length === 0 && watchdogPass,
    errors,
    timestamp: new Date().toISOString()
  };
}
