import {describe,it,expect} from 'vitest';
import { isRetryableFailure, shouldRetry, isStaleJob, extractGitHubIssueNumber, repairInstruction } from '../apps/tigeriq-coding-lane/autonomy-supervisor.mjs';

describe('Autonomy Supervisor Tests', () => {
  it('evaluates retryability', () => {
    expect(isRetryableFailure('CI_GATES_FAILED')).toBe(true);
    expect(isRetryableFailure('OTHER')).toBe(false);
  });
  it('evaluates retry budget', () => {
    expect(shouldRetry(1, 3)).toBe(true);
    expect(shouldRetry(3, 3)).toBe(false);
  });
});
