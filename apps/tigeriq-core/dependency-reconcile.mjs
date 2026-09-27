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
  const state = value(issue?.body, 'STATE');
  return { dependencyIds, allTerminal, stale: allTerminal && /WAIT_DEPENDENCY/i.test(state), key: dependencyReconcileKey(issue) };
}
export async function reconcileStaleDependency({ issue, dependencies, comment, updateBody, closeIssue } = {}) {
  const result = staleDependencyState(issue, dependencies);
  if (!result.stale) return { ...result, action: 'NOOP' };
  if (/^(DONE|COMPLETED|CANCELLED|CANCELED|SUPERSEDED)$/i.test(value(issue?.body, 'STATE'))) {
    await closeIssue?.(issue.number);
    return { ...result, action: 'CLOSED_TERMINAL' };
  }
  const body = String(issue?.body || '').replace(/^STATE\s*=\s*WAIT_DEPENDENCY.*$/im, 'STATE=READY').replace(/^MUTATION_OWNER\s*=.*$/im, 'MUTATION_OWNER=')
    .replace(/^LEASE_ID\s*=.*$/im, 'LEASE_ID=');
  await updateBody?.(issue.number, body);
  await comment?.(issue.number, `[DEPENDENCY_REARM] key=${result.key} dependencies=${result.dependencyIds.map((x) => `#${x}`).join(',')} STATE=READY MUTATION_OWNER= CLEARED_STALE_WAIT=true`);
  return { ...result, action: 'REARMED' };
}
