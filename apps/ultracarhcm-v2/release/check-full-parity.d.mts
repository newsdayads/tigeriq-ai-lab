export const mandatoryFeatureIds: readonly string[];
export const mandatoryRegressionIds: readonly string[];
export const mandatoryHardwareIds: readonly string[];
export interface FullParityResult {
  readonly canPublish: boolean;
  readonly blockerCount: number;
  readonly blockers: readonly string[];
}
export function assessFullParityRelease(candidate: unknown): FullParityResult;
