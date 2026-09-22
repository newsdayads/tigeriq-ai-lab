export interface ContinuityState {
  version: number;
  lastActiveWorker?: string;
  updatedAt: string;
}

export function createDefaultContinuityState(): ContinuityState {
  return {
    version: 1,
    updatedAt: new Date().toISOString()
  };
}
