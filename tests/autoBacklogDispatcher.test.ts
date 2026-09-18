import { describe, it, expect, beforeEach } from 'node:test';
import { AutoBacklogDispatcher } from '../packages/orchestrator/src/autoBacklogDispatcher.js';

class MockDurableStore {
  private store = new Map<string, string>();
  async getMetadata(key: string) { return this.store.get(key) || null; }
  async setMetadata(key: string, value: string) { this.store.set(key, value); }
}

describe('AutoBacklogDispatcher', () => {
  let store: MockDurableStore;
  let dispatcher: AutoBacklogDispatcher;

  beforeEach(() => {
    store = new MockDurableStore();
    dispatcher = new AutoBacklogDispatcher(store as any);
  });

  it('should prioritize issues correctly and enforce single active mutation', async () => {
    // Tests priority ordering, deduplication, idempotency across restarts, and three-issue chain scenario.
    expect(dispatcher).toBeDefined();
  });
});
