import type { TaskRecord, TaskQueue } from '../../workforce/src/index.js';
import { FileJournalWorkforceStateStore } from '../../workforce/src/journal-store.js';
import { FileJournal } from '../../event-store/src/index.js';

export interface QueueHygieneSummary {
  scanned: number;
  reconciled: number;
  superseded: number;
  skipped: number;
  blockers: string[];
}

export interface GitHubClient {
  getPullRequestState(repo: string, prNumber: number): Promise<{ state: string; merged: boolean; labels: string[]; comments: string[] } | null>;
  getIssueState(repo: string, issueNumber: number): Promise<{ state: string; labels: string[]; comments: string[] } | null>;
}

export async function runQueueHygiene(
  queue: TaskQueue,
  journalStore: FileJournalWorkforceStateStore,
  githubClient: GitHubClient,
): Promise<QueueHygieneSummary> {
  const summary: QueueHygieneSummary = {
    scanned: 0,
    reconciled: 0,
    superseded: 0,
    skipped: 0,
    blockers: [],
  };

  const tasks = queue.list();
  const activeIntentMap = new Map<string, TaskRecord>();

  for (const task of tasks) {
    if (task.stage === 'queued' || task.stage === 'assigned' || task.stage === 'running') {
      const intentKey = task.objectiveId || task.sourceIssueId;
      if (intentKey) {
        if (activeIntentMap.has(intentKey)) {
          // Duplicate detected
          task.stage = 'cancelled';
          summary.superseded++;
          summary.reconciled++;
        } else {
          activeIntentMap.set(intentKey, task);
        }
      }
    }
  }

  for (const task of tasks) {
    if (task.stage !== 'waiting_ci' && task.stage !== 'open') {
      summary.skipped++;
      continue;
    }

    summary.scanned++;

    try {
      let isSuperseded = false;
      const prNumber = (task as any).pullRequestNumber || (task as any).prNumber;
      const issueNumber = task.sourceIssueId ? parseInt(task.sourceIssueId, 10) : NaN;
      const repo = (task as any).repository || 'owner/repo';

      if (prNumber && typeof githubClient.getPullRequestState === 'function') {
        const pr = await githubClient.getPullRequestState(repo, prNumber);
        if (pr) {
          if (pr.state === 'closed' || pr.merged || pr.state === 'rejected') {
            isSuperseded = true;
          }
          if (pr.labels?.includes('superseded') || pr.comments?.some((c) => c.includes('#superseded'))) {
            isSuperseded = true;
          }
        }
      } else if (!isNaN(issueNumber) && typeof githubClient.getIssueState === 'function') {
        const issue = await githubClient.getIssueState(repo, issueNumber);
        if (issue) {
          if (issue.state === 'closed') {
            isSuperseded = true;
          }
          if (issue.labels?.includes('superseded') || issue.comments?.some((c) => c.includes('#superseded'))) {
            isSuperseded = true;
          }
        }
      }

      if (isSuperseded) {
        task.stage = 'cancelled';
        summary.superseded++;
        summary.reconciled++;
      } else {
        summary.skipped++;
      }
    } catch (err: any) {
      summary.blockers.push(`Failed to reconcile task ${task.id}: ${err.message}`);
    }
  }

  const snapshot = await journalStore.load();
  if (snapshot) {
    snapshot.tasks = queue.list();
    await journalStore.save(snapshot);
  }

  return summary;
}
