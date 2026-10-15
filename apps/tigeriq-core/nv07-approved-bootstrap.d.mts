export const NV07_BOOTSTRAP_RESOURCE_ID: string;
export function validNv07ProtectedApproval(value: unknown, options?: {sourceSha?: string;nowMs?: number}): boolean;
export function runNv07ApprovedBootstrap(db: unknown): Promise<Record<string, unknown>>;
