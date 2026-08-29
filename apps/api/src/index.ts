export interface HealthStatus {
  service: 'tigeriq-ai-lab-api';
  status: 'ok';
  phase: 'phase-0';
}

export function health(): HealthStatus {
  return { service: 'tigeriq-ai-lab-api', status: 'ok', phase: 'phase-0' };
}
