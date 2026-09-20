import { jest } from '@jest/globals';
import { runJobWithRetry } from '../apps/tigeriq-core/core.mjs';

test('concurrent jobs wait for resource release and succeed', async () => {
  const mockJob = { id: 'test-job' } as any;
  let callCount = 0;

  // Mock the original runJob to simulate temporary busyness then success
  const coreModule = await import('../apps/tigeriq-core/core.mjs');
  jest.spyOn(coreModule, 'runJob').mockImplementation(async (job: any) => {
    callCount++;
    if (callCount < 3) {
      const err: any = new Error('No idle resource');
      err.code = 'NO_IDLE_RESOURCE';
      throw err;
    }
    return 'success';
  });

  const result = await runJobWithRetry(mockJob, 5);
  expect(result).toBe('success');
  expect(callCount).toBe(3);
});