export type WorkOrderStatus = 'draft' | 'approved' | 'running' | 'failed' | 'blocked' | 'verified';

export interface WorkOrder {
  id: string;
  project: string;
  goal: string;
  scope: string[];
  invariants: string[];
  acceptanceCriteria: string[];
  dependencies?: string[];
  edgeCases?: string[];
  rollback?: string;
  status: WorkOrderStatus;
}

export function validateWorkOrder(order: WorkOrder): string[] {
  const errors: string[] = [];
  if (!order.id.trim()) errors.push('id is required');
  if (!order.project.trim()) errors.push('project is required');
  if (!order.goal.trim()) errors.push('goal is required');
  if (order.acceptanceCriteria.length === 0) errors.push('acceptance criteria are required');
  return errors;
}
