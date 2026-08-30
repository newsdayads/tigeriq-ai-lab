export interface AuditLogEntry {
  id: string;
  actor: string;
  role?: string;
  action: string;
  target: string;
  workOrderId?: string;
  commitSha?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export function appendAuditLog(log: readonly AuditLogEntry[], entry: AuditLogEntry): AuditLogEntry[] {
  return [...log, Object.freeze({ ...entry })];
}
