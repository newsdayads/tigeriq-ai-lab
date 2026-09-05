import type { ContextPlaneMetricsSnapshot, StartupResult } from './index.js';

export interface LegacyStartupSnapshot {
  command: string;
  employee_id: string;
  background: boolean;
  activation_state: string;
  current_work?: string | null;
  checkpoint_key?: string | null;
}

export interface ShadowComparison {
  match: boolean;
  mismatches: string[];
  candidate_ok: boolean;
}

export interface StartupBudget {
  max_source_fetches: number;
  max_deep_reads: number;
  max_bytes_loaded?: number;
}

export interface StartupBudgetResult {
  pass: boolean;
  violations: string[];
}

export function compareShadow(legacy: LegacyStartupSnapshot, candidate: StartupResult): ShadowComparison {
  const mismatches: string[] = [];
  if (!candidate.ok) mismatches.push(`candidate_error:${candidate.error ?? 'UNKNOWN'}`);
  if (candidate.command !== legacy.command) mismatches.push('command');
  if (candidate.employee_id !== legacy.employee_id) mismatches.push('employee_id');
  if (candidate.background !== legacy.background) mismatches.push('background');
  if (candidate.activation_state !== legacy.activation_state) mismatches.push('activation_state');

  const currentWork = candidate.state?.current_work ?? null;
  if ((legacy.current_work ?? null) !== currentWork) mismatches.push('current_work');

  const checkpointKey = candidate.state?.checkpoint?.key ?? null;
  if ((legacy.checkpoint_key ?? null) !== checkpointKey) mismatches.push('checkpoint_key');

  return { match: mismatches.length === 0, mismatches, candidate_ok: candidate.ok };
}

export function assessStartupBudget(metrics: ContextPlaneMetricsSnapshot, budget: StartupBudget): StartupBudgetResult {
  const violations: string[] = [];
  if (metrics.source_fetches > budget.max_source_fetches) violations.push(`source_fetches:${metrics.source_fetches}>${budget.max_source_fetches}`);
  if (metrics.deep_reads > budget.max_deep_reads) violations.push(`deep_reads:${metrics.deep_reads}>${budget.max_deep_reads}`);
  if (budget.max_bytes_loaded !== undefined && metrics.bytes_loaded > budget.max_bytes_loaded) {
    violations.push(`bytes_loaded:${metrics.bytes_loaded}>${budget.max_bytes_loaded}`);
  }
  return { pass: violations.length === 0, violations };
}
