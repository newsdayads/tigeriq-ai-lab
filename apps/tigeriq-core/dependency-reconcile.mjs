const TERMINAL = new Set(['closed', 'done', 'completed', 'cancelled', 'canceled', 'superseded']);

function value(body, key) { return String(body || '').match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'im'))?.[1]?.trim() || ''; }
function refs(body) { return String(value(body, 'DEPENDS_ON') || value(body, 'DEPENDENCY')).split(/[\\s,]+/).map((x) => Number(x.replace(/^#/, ''))).filter(Boolean); }
export function dependencyReconcileKey(issue) {
  const body = String(issue?.body || '');
  return [value(body, 'RESOURCE_SCOPE'), value(body, 'GOAL'), value(body, 'ACTIVE_INTENT')].join('|');
}
export function staleDependencyState(issue, dependencies) {
  const dependencyIds = refs(issue?.body);
  const allTerminal = dependencyIds.length > 0 && dependencyIds.every((id) => {
    const dep = dependencies instanceof Map ? dependencies.get(id) : dependencies?.[id];
    return TERMINAL.has(String(dep?.state || dep?.state_reason || dep || '').toLowerCase());
  });
  const state = `${value(issue?.body, 'STATE')} ${value(issue?.body, 'CURRENT_STATE')}`;
  return { dependencyIds, allTerminal, stale: allTerminal && /WAIT_DEPENDENCY|WAIT_SCOPE_RELEASE|WAIT_SCOPE/i.test(state), key: dependencyReconcileKey(issue) };
}
async function assertBeforeWrite(assertWriteOwnership, action) {
  if (typeof assertWriteOwnership !== 'function') throw new Error(`WRITE_OWNERSHIP_GUARD_REQUIRED:${action}`);
  await assertWriteOwnership(action);
}

export async function reconcileStaleDependency({ issue, dependencies, comment, updateBody, closeIssue, alreadyReconciled = false, assertWriteOwnership } = {}) {
  const result = staleDependencyState(issue, dependencies);
  if (!result.stale) return { ...result, action: 'NOOP' };
  const body = String(issue?.body || '');
  if (alreadyReconciled) return { ...result, action: 'ALREADY_RECONCILED' };
  if (/TIGERIQ_EXECUTABLE\s*=\s*false|AUTO_QUEUE\s*=\s*EXCLUDED|pc_operator|DEVICE_BOUND/i.test(body)) {
    if (comment) {
      await assertBeforeWrite(assertWriteOwnership, 'DEPENDENCY_RECONCILE_COMMENT');
      await comment(issue.number, `[DEPENDENCY_RECONCILE] key=${result.key} dependencies=${result.dependencyIds.map((x) => `#${x}`).join(',')} TERMINAL=true REARM=false REASON=NON_EXECUTABLE_OR_SCOPE_HELD`);
    }
    return { ...result, action: 'DEPENDENCY_CLOSED_SCOPE_HELD' };
  }
  if (/^(DONE|COMPLETED|CANCELLED|CANCELED|SUPERSEDED)$/i.test(value(issue?.body, 'STATE'))) {
    if (closeIssue) {
      await assertBeforeWrite(assertWriteOwnership, 'DEPENDENCY_CLOSE_ISSUE');
      await closeIssue(issue.number);
    }
    return { ...result, action: 'CLOSED_TERMINAL' };
  }
  const rearmedBody = body.replace(/^STATE\s*=\s*WAIT_DEPENDENCY.*$/im, 'STATE=READY').replace(/^CURRENT_STATE\s*=.*$/im, 'CURRENT_STATE=READY').replace(/^MUTATION_OWNER\s*=.*$/im, 'MUTATION_OWNER=')
    .replace(/^LEASE_ID\s*=.*$/im, 'LEASE_ID=');
  if (updateBody) {
    await assertBeforeWrite(assertWriteOwnership, 'DEPENDENCY_REARM_BODY');
    await updateBody(issue.number, rearmedBody);
  }
  if (comment) {
    await assertBeforeWrite(assertWriteOwnership, 'DEPENDENCY_REARM_COMMENT');
    await comment(issue.number, `[DEPENDENCY_REARM] key=${result.key} dependencies=${result.dependencyIds.map((x) => `#${x}`).join(',')} STATE=READY MUTATION_OWNER= CLEARED_STALE_WAIT=true`);
  }
  return { ...result, action: 'REARMED' };
}
