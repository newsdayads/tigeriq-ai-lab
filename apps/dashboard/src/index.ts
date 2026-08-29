export interface DashboardSummary {
  activeWorkOrders: number;
  failingGates: number;
  releaseEligible: boolean;
}

export function emptyDashboard(): DashboardSummary {
  return { activeWorkOrders: 0, failingGates: 0, releaseEligible: false };
}
