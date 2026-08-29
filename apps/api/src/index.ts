export interface HealthStatus {
  service: 'tigeriq-ai-lab-api';
  status: 'ok';
  phase: 'phase-3';
  capabilities: readonly ['work-orders', 'evidence', 'independent-gates', 'audit-chain', 'durable-journal', 'authenticated-http'];
}

export function health(): HealthStatus {
  return {
    service: 'tigeriq-ai-lab-api', status: 'ok', phase: 'phase-3',
    capabilities: ['work-orders', 'evidence', 'independent-gates', 'audit-chain', 'durable-journal', 'authenticated-http'],
  };
}
