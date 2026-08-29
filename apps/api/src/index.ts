export interface HealthStatus {
  service: 'tigeriq-ai-lab-api';
  status: 'ok';
  phase: 'phase-4';
  capabilities: readonly ['work-orders', 'evidence', 'independent-gates', 'audit-chain', 'durable-journal', 'authenticated-http', 'restart-recovery'];
}

export function health(): HealthStatus {
  return {
    service: 'tigeriq-ai-lab-api', status: 'ok', phase: 'phase-4',
    capabilities: ['work-orders', 'evidence', 'independent-gates', 'audit-chain', 'durable-journal', 'authenticated-http', 'restart-recovery'],
  };
}
