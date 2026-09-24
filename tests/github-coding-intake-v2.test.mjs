import { test, expect } from 'vitest';
import { GitHubIntake } from '../../src/github-intake.js';

test('should handle reopen rearm exactly once', async () => {
  const intake = new GitHubIntake();
  const mockRepo = { id: 123, name: 'test-repo' };
  
  // Simulate initial state
  const firstResult = await intake.reopenRearm(mockRepo);
  expect(firstResult.success).toBe(true);
  expect(firstResult.attempt).toBe(1);
  
  // Simulate retry (should be idempotent)
  const secondResult = await intake.reopenRearm(mockRepo);
  expect(secondResult.success).toBe(true);
  expect(secondResult.attempt).toBe(1);
});

test('should prevent duplicate rearm operations', async () => {
  const intake = new GitHubIntake();
  const mockRepo = { id: 456, name: 'test-repo-2' };
  
  await intake.reopenRearm(mockRepo);
  const status = await intake.getStatus(mockRepo);
  expect(status.rearmCount).toBe(1);
});
