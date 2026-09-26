export const WORKER_HOSTS: Record<string, string>;
export const WORKER_HINTS: Record<string, string[]>;
export function hostname(value: string): string;
export function allowedUrl(value: string): boolean;
export function matchesWorker(workerId: string, value: string): boolean;
