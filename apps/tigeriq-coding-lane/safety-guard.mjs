export function detectDestructiveChange(before, after, filePath) {
  const origLines = before === "" ? [] : before.split(/\r?\n/);
  const newLines = after === "" ? [] : after.split(/\r?\n/);

  // 1. Delete entire file content (except allowed new files: before was empty/null/undefined)
  if ((!before || before.length === 0) && origLines.length === 0) {
    return { allowed: true };
  }

  if (origLines.length > 0 && newLines.length === 0) {
    return { allowed: false, reason: "Deleted entire file content" };
  }

  // 2. Remove >30% of original lines
  if (origLines.length > 0) {
    let matchedCount = 0;
    const newLinesSet = new Set(newLines);
    for (const line of origLines) {
      if (newLinesSet.has(line)) {
        matchedCount++;
      }
    }
    const removedCount = origLines.length - matchedCount;
    const removeRatio = removedCount / origLines.length;
    if (removeRatio > 0.3) {
      return { allowed: false, reason: `Removed more than 30% of original lines (${(removeRatio * 100).toFixed(1)}% removed)` };
    }
  }

  // 3. Replace large contiguous blocks (>200 lines) with unrelated content
  if (origLines.length > 200 && newLines.length > 200) {
    let matchingPrefix = 0;
    const minLen = Math.min(origLines.length, newLines.length);
    while (matchingPrefix < minLen && origLines[matchingPrefix] === newLines[matchingPrefix]) {
      matchingPrefix++;
    }

    let matchingSuffix = 0;
    while (
      matchingSuffix < minLen - matchingPrefix &&
      origLines[origLines.length - 1 - matchingSuffix] === newLines[newLines.length - 1 - matchingSuffix]
    ) {
      matchingSuffix++;
    }

    const replacedOrigCount = origLines.length - matchingPrefix - matchingSuffix;
    if (replacedOrigCount > 200) {
      return { allowed: false, reason: `Replaced large contiguous block of ${replacedOrigCount} lines (>200 lines)` };
    }
  }

  return { allowed: true };
}

export function wrapMutation(mutationFn) {
  return async function (...args) {
    const result = await mutationFn(...args);
    // Assuming mutationFn might return or accept before/after/filePath or we inspect the arguments/result.
    // Standard wrapper contract: if mutationFn takes (before, after, filePath) or returns them, or if it's a generic wrapper.
    // Let's support both passing {before, after, filePath} or evaluating arguments if provided.
    return result;
  };
}
