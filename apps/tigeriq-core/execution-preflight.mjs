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
      if ((state.retryCount || 0) >= (state.maxRetries || 3)) {
        errors.push(`STATE_TERMINATED_OR_BLOCKED:${state.status || 'terminated'}`);
      }
    }
    if (Array.isArray(state.auto_ui_dependencies)) {
      for (const dep of state.auto_ui_dependencies) {
        if (!dep || typeof dep !== 'string') {
          errors.push('INVALID_AUTO_UI_DEPENDENCY');
        }
      }
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

  return {
    ok: errors.length === 0,
    errors,
    timestamp: new Date().toISOString()
  };
}
