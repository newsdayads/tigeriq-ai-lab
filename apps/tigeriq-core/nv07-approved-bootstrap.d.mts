export const NV07_BOOTSTRAP_RESOURCE_ID: string;
export function validNv07ProtectedApproval(value: unknown, options?: {sourceSha?: string;nowMs?: number}): boolean;
export function runNv07ApprovedBootstrap(db: unknown, options?: {queuedJobId?: string | null}): Promise<Record<string, unknown>>;
export function queueNv07ApprovedBootstrap(db: unknown): Promise<Record<string, unknown>>;
