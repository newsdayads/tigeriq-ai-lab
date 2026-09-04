import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GateDecision, WorkOrderSnapshot } from '../../../packages/control-plane/src/index.js';
import type { EvidenceRecord } from '../../../packages/evidence/src/index.js';
import type { DashboardSource } from './server.js';

const execFileAsync = promisify(execFile);
const CACHE_MS = 8_000;
const JOB_MARKER = 'TIGERIQ_JOB_V1';

const LIFECYCLE = new Map<string, 'running' | 'verified' | 'failed'>([
  ['TIGERIQ_PC01_CLAIMED', 'running'],
  ['TIGERIQ_JOB_CLAIMED', 'running'],
  ['TIGERIQ_PC01_DONE', 'verified'],
  ['TIGERIQ_PC01_RESULT', 'verified'],
  ['TIGERIQ_JOB_DONE', 'verified'],
  ['TIGERIQ_JOB_RESULT', 'verified'],
  ['TIGERIQ_PC01_FAILED', 'failed'],
  ['TIGERIQ_JOB_FAILED', 'failed'],
]);

type GitHubIssue = {
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  html_url?: string;
  url?: string;
  updated_at?: string;
  pull_request?: unknown;
};

type GitHubComment = {
  issue_url?: string;
  body?: string;
  created_at?: string;
  updated_at?: string;
};

type LifecycleEvent = {
  marker: string;
  status: 'running' | 'verified' | 'failed';
  timestamp: string;
  timestampMs: number;
  order: number;
};

function section(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'));
  return (match?.[1] ?? '').trim();
}

function compact(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function issueNumberFromUrl(value: string): number | null {
  const match = value.match(/\/issues\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function lifecycleEvents(comments: readonly GitHubComment[]): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];
  let order = 0;
  for (const comment of comments) {
    const timestamp = comment.updated_at || comment.created_at || new Date(0).toISOString();
    const parsed = Date.parse(timestamp);
    for (const rawLine of String(comment.body ?? '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const marker = line.split(/\s+/, 1)[0];
      const status = LIFECYCLE.get(marker);
      if (!status) continue;
      events.push({ marker, status, timestamp, timestampMs: Number.isFinite(parsed) ? parsed : 0, order: order++ });
    }
  }
  return events.sort((a, b) => a.timestampMs - b.timestampMs || a.order - b.order);
}

export function projectGitHubWorkOrders(
  issues: readonly GitHubIssue[],
  comments: readonly GitHubComment[],
): WorkOrderSnapshot[] {
  const commentsByIssue = new Map<number, GitHubComment[]>();
  for (const comment of comments) {
    const number = issueNumberFromUrl(String(comment.issue_url ?? ''));
    if (!number) continue;
    const rows = commentsByIssue.get(number) ?? [];
    rows.push(comment);
    commentsByIssue.set(number, rows);
  }

  const projected = new Map<string, WorkOrderSnapshot>();
  for (const issue of issues) {
    const number = Number(issue.number ?? 0);
    const body = String(issue.body ?? '');
    if (!number || issue.pull_request || !body.includes(JOB_MARKER)) continue;

    const events = lifecycleEvents(commentsByIssue.get(number) ?? []);
    const latest = events.at(-1) ?? null;
    if (issue.state === 'closed' && !latest) continue;

    const explicitId = compact(section(body, 'Work Order'), 128);
    const id = explicitId || `WO-GH-${number}`;
    if (projected.has(id)) continue;

    const instruction = compact(section(body, 'Instruction'), 8_000);
    const goal = instruction || compact(String(issue.title ?? `GitHub Work Order #${number}`), 8_000);
    const priority = compact(section(body, 'Priority'), 32) || 'Bình thường';
    const status = latest?.status ?? 'approved';
    const issueUrl = String(issue.html_url ?? issue.url ?? `https://github.com/newsdayads/tigeriq-ai-lab/issues/${number}`);
    const terminal = status === 'verified' || status === 'failed';
    const evidenceId = `github-lifecycle-${number}`;
    const timestamp = latest?.timestamp || String(issue.updated_at ?? new Date(0).toISOString());

    const evidence: EvidenceRecord[] = terminal ? [{
      id: evidenceId,
      workOrderId: id,
      gate: 'DONE',
      commitSha: `github-issue-${number}`,
      command: `PC01 lifecycle marker ${latest?.marker ?? 'UNKNOWN'}`,
      exitCode: status === 'verified' ? 0 : 1,
      status: status === 'verified' ? 'pass' : 'fail',
      artifactUris: [issueUrl],
      timestamp,
    }] : [];

    const decisions: GateDecision[] = terminal ? [{
      gate: 'DONE',
      status: status === 'verified' ? 'pass' : 'fail',
      evaluatorId: 'pc01-lifecycle-projection',
      evidenceIds: [evidenceId],
      timestamp,
      reason: `Projected from exact PC01 lifecycle marker ${latest?.marker ?? 'UNKNOWN'}`,
    }] : [];

    projected.set(id, {
      order: {
        id,
        project: 'TigerIQ',
        goal,
        scope: ['PC01 GitHub work queue'],
        invariants: ['Evidence-first', 'No MAIN/Production without authorization', `Priority: ${priority}`],
        acceptanceCriteria: ['PC01 terminal lifecycle evidence is recorded'],
        status,
      },
      ...(status === 'running' || terminal ? { implementerId: 'pc01-worker' } : {}),
      evidence,
      decisions,
      audit: [],
    });
  }
  return [...projected.values()];
}

async function ghJson(endpoint: string): Promise<unknown> {
  const { stdout } = await execFileAsync('gh', ['api', endpoint], {
    timeout: 15_000,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout || '[]');
}

export class GitHubWorkSource implements DashboardSource {
  readonly #local: DashboardSource;
  readonly #repo: string;
  #cache: { expiresAt: number; rows: WorkOrderSnapshot[] } | null = null;

  constructor(local: DashboardSource, repo: string) {
    this.#local = local;
    this.#repo = repo;
  }

  async list(): Promise<WorkOrderSnapshot[]> {
    const localRows = await this.#local.list();
    try {
      const githubRows = await this.#githubRows();
      const merged = new Map(localRows.map((row) => [row.order.id, row]));
      for (const row of githubRows) merged.set(row.order.id, row);
      return [...merged.values()];
    } catch {
      return localRows;
    }
  }

  async #githubRows(): Promise<WorkOrderSnapshot[]> {
    const now = Date.now();
    if (this.#cache && this.#cache.expiresAt > now) return structuredClone(this.#cache.rows);
    const [owner, repo] = this.#repo.split('/');
    if (!owner || !repo) throw new Error('invalid_repo');
    const [issuesRaw, commentsRaw] = await Promise.all([
      ghJson(`repos/${owner}/${repo}/issues?state=all&per_page=100&sort=updated&direction=desc`),
      ghJson(`repos/${owner}/${repo}/issues/comments?per_page=100&sort=updated&direction=desc`),
    ]);
    if (!Array.isArray(issuesRaw) || !Array.isArray(commentsRaw)) throw new Error('invalid_github_projection_payload');
    const rows = projectGitHubWorkOrders(issuesRaw as GitHubIssue[], commentsRaw as GitHubComment[]);
    this.#cache = { expiresAt: now + CACHE_MS, rows };
    return structuredClone(rows);
  }
}
