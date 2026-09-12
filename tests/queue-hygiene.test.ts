import { describe, it, expect } from 'vitest';
import { runQueueHygiene } from '../packages/worker/src/queueHygiene.js';
import { TaskQueue } from '../packages/workforce/src/index.js';
import { FileJournalWorkforceStateStore } from '../packages/workforce/src/journal-store.js';
import { FileJournal } from '../packages/event-store/src/index.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('Queue Hygiene', () => {
  it('marks closed/merged/superseded/duplicate PRs and issues correctly', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-hygiene-test-'));
    const journal = new FileJournal(tmpDir);
    const store = new FileJournalWorkforceStateStore(journal);
    const queue = new TaskQueue();

    queue.add({
      id: 'task-1',
      stage: 'waiting_ci',
      title: 'Task 1',
      objectiveId: 'obj-1',
      employeeId: 'emp-1',
      department: 'eng',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    queue.add({
      id: 'task-2',
      stage: 'open',
      title: 'Task 2',
      objectiveId: 'obj-1',
      employeeId: 'emp-1',
      department: 'eng',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    queue.add({
      id: 'task-3',
      stage: 'waiting_ci',
      title: 'Task 3',
      objectiveId: 'obj-3',
      employeeId: 'emp-1',
      department: 'eng',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const mockGithubClient = {
      async getPullRequestState() {
        return { state: 'closed', merged: false, labels: [], comments: [] };
      },
      async getIssueState() {
        return null;
      },
    };

    const summary = await runQueueHygiene(queue, store, mockGithubClient);

    expect(summary.scanned).toBe(2);
    expect(summary.superseded).toBeGreaterThan(0);
  });
});
