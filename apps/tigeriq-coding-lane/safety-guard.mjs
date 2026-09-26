export class SafetyGuardViolationError extends Error {
  constructor(reason, detail = {}) {
    super(reason);
    this.code = 'SAFETY_GUARD_VIOLATION';
    this.reason = reason;
    this.detail = { code: this.code, reason, ...detail };
  }
}

function textMetrics(value = '') {
  const text = String(value ?? '');
  const lines = text.length ? text.split(/\r?\n/).length : 0;
  const bytes = Buffer.byteLength(text, 'utf8');
  const structuralMatches = text.match(/\b(?:import|export|function|class|const|let|var|async|await|return)\b/g) || [];
  return { bytes, lines, structuralTokens: structuralMatches.length };
}

function buildDecision(reason, path, before, after, extra = {}) {
  return {
    ok: true,
    reason,
    path,
    before,
    after,
    delta: {
      bytes: after.bytes - before.bytes,
      lines: after.lines - before.lines,
      structuralTokens: after.structuralTokens - before.structuralTokens,
    },
    ...extra,
  };
}

export function evaluateFileChangeSafety({ path, before = '', after = '', isNew = false } = {}) {
  const target = String(path || '').trim();
  if (!target) throw new SafetyGuardViolationError('SAFETY_GUARD_PATH_MISSING', { path: target });

  const beforeText = String(before ?? '');
  const afterText = String(after ?? '');
  const beforeMetrics = textMetrics(beforeText);
  const afterMetrics = textMetrics(afterText);

  if (isNew || beforeMetrics.bytes === 0) {
    if (!afterMetrics.bytes) throw new SafetyGuardViolationError('SAFETY_GUARD_NEW_FILE_EMPTY', { path: target, before: beforeMetrics, after: afterMetrics });
    return buildDecision('NEW_FILE_ALLOWED', target, beforeMetrics, afterMetrics);
  }

  if (!afterMetrics.bytes) {
    throw new SafetyGuardViolationError('EXISTING_FILE_TRUNCATED_TO_EMPTY', { path: target, before: beforeMetrics, after: afterMetrics });
  }

  const removedBytes = beforeMetrics.bytes - afterMetrics.bytes;
  const removedLines = beforeMetrics.lines - afterMetrics.lines;
  const removedStructuralTokens = beforeMetrics.structuralTokens - afterMetrics.structuralTokens;
  const byteRatio = afterMetrics.bytes / Math.max(1, beforeMetrics.bytes);
  const lineRatio = afterMetrics.lines / Math.max(1, beforeMetrics.lines);
  const structuralRatio = afterMetrics.structuralTokens / Math.max(1, beforeMetrics.structuralTokens);

  if (beforeMetrics.lines >= 40 && removedLines >= 20 && lineRatio < 0.65) {
    throw new SafetyGuardViolationError('EXISTING_FILE_SUSPICIOUS_LINE_TRUNCATION', { path: target, before: beforeMetrics, after: afterMetrics, removedLines, lineRatio });
  }

  if (beforeMetrics.bytes >= 2000 && removedBytes >= 1000 && byteRatio < 0.65) {
    throw new SafetyGuardViolationError('EXISTING_FILE_SUSPICIOUS_BYTE_TRUNCATION', { path: target, before: beforeMetrics, after: afterMetrics, removedBytes, byteRatio });
  }

  if (beforeMetrics.structuralTokens >= 10 && removedStructuralTokens >= 6 && structuralRatio < 0.55) {
    throw new SafetyGuardViolationError('EXISTING_FILE_STRUCTURAL_LOSS', { path: target, before: beforeMetrics, after: afterMetrics, removedStructuralTokens, structuralRatio });
  }

  return buildDecision('EXISTING_FILE_CHANGE_ALLOWED', target, beforeMetrics, afterMetrics, { byteRatio, lineRatio, structuralRatio });
}

export function assertSafeFileChange(change) {
  return evaluateFileChangeSafety(change);
}
