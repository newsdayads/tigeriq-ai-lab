export interface HealthStatus {
  service: 'tigeriq-ai-lab-api';
  status: 'ok';
  phase: 'phase-1';
  capabilities: readonly ['work-orders', 'evidence', 'independent-gates', 'audit-chain'];
}

export function health(): HealthStatus {
  return {
    service: 'tigeriq-ai-lab-api', status: 'ok', phase: 'phase-1',
    capabilities: ['work-orders', 'evidence', 'independent-gates', 'audit-chain'],
  };
}
