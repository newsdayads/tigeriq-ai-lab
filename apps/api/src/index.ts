export interface HealthStatus {
  service: 'tigeriq-ai-lab-api';
  status: 'ok';
  phase: 'phase-5';
  capabilities: readonly ['work-orders', 'evidence', 'independent-gates', 'audit-chain', 'durable-journal', 'authenticated-http', 'restart-recovery', 'durable-idempotency'];
}

export function health(): HealthStatus {
  return {
    service: 'tigeriq-ai-lab-api', status: 'ok', phase: 'phase-5',
    capabilities: ['work-orders', 'evidence', 'independent-gates', 'audit-chain', 'durable-journal', 'authenticated-http', 'restart-recovery', 'durable-idempotency'],
  };
}
