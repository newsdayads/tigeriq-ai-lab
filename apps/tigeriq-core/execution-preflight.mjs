export function runExecutionPreflight({ skill, tool, state, context } = {}) {
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

  return {
    ok: errors.length === 0,
    errors,
    timestamp: new Date().toISOString()
  };
}
