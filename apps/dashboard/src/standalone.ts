import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileJournal } from '../../../packages/event-store/src/index.js';
import { DurableControlPlane } from '../../../packages/durable-control-plane/src/index.js';
import { GitHubWorkSource } from './github-work-source.js';
import { schedulePc01RuntimeSelfHeal } from './runtime-self-heal.js';
import { startDashboard } from './server.js';
import { startOwnerCockpitV5 } from './server-v5.js';
import { startOwnerCockpitV6 } from './server-v6.js';

const execFileAsync = promisify(execFile);
const journalPath = process.env.TIGERIQ_JOURNAL ?? 'F:\\TigerIQ\\State\\control-plane.jsonl';
const host = process.env.TIGERIQ_COMMAND_HOST ?? '127.0.0.1';
const port = Number(process.env.TIGERIQ_COMMAND_PORT ?? '8787');
const repo = process.env.TIGERIQ_REPO ?? 'newsdayads/tigeriq-ai-lab';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('TIGERIQ_COMMAND_PORT must be an integer between 1 and 65535');
}

const plane = new DurableControlPlane(new FileJournal(journalPath));
const dashboardSource = new GitHubWorkSource(plane, repo);

function workOrderId(instruction: string, priority: string): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const suffix = createHash('sha256').update(`${instruction}\n${priority}\n${Date.now()}`).digest('hex').slice(0, 8).toUpperCase();
  return `WO-WEB-${stamp}-${suffix}`;
}

async function submitPc01WorkOrder(instruction: string, priority: string): Promise<string> {
  const id = workOrderId(instruction, priority);
  await plane.create({
    id,
    project: 'TigerIQ',
    goal: instruction,
    scope: ['PC01 Command Center', 'PC01 execution pipeline'],
    invariants: ['Evidence-first', 'No MAIN/Production without authorization', 'Private PC01 execution only', `Priority: ${priority}`],
    acceptanceCriteria: ['PC01 execution result and evidence are recorded'],
    status: 'draft',
  }, { id: 'vy-web-intake', role: 'planner' });
  await plane.transition(id, 'approved', { id: 'vy-web-approver', role: 'approver' });

  const title = `[Command Center][${id}] ${instruction.replace(/\s+/g, ' ').slice(0, 60)}`;
  const body = `PC01_REQUIRED=true\nCLOUD_EXECUTOR_ALLOWED=false\n\nTIGERIQ_JOB_V1\n\n## Work Order\n${id}\n\n## Instruction\n${instruction}\n\n## Priority\n${priority}`;
  try {
    const { stdout } = await execFileAsync('gh', ['issue', 'create', '--repo', repo, '--title', title, '--body', body], {
      timeout: 30_000,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 512 * 1024,
    });
    const url = stdout.trim().split(/\r?\n/).find((line) => /^https:\/\/github\.com\//.test(line));
    if (!url) throw new Error('queue_create_failed');
    return url;
  } catch (error) {
    await plane.transition(id, 'blocked', { id: 'pc01-command-center', role: 'operator' });
    throw error;
  }
}

const backend = await startDashboard(dashboardSource, {
  host: '127.0.0.1',
  port: 0,
  repo,
  submitJob: submitPc01WorkOrder,
});

const cockpitV5 = await startOwnerCockpitV5({ backendUrl: backend.url, repo, host: '127.0.0.1', port: 0 });
const server = await startOwnerCockpitV6({ cockpitUrl: cockpitV5.url, backendUrl: backend.url, repo, host, port });
schedulePc01RuntimeSelfHeal({ host, repo, repoRoot: process.env.TIGERIQ_REPO_ROOT });

console.log(`TigerIQ Owner Cockpit V6 online: ${server.url}`);
console.log(`Internal Owner Cockpit V5: ${cockpitV5.url}`);
console.log(`Internal Command Center backend: ${backend.url}`);
console.log(`Journal: ${journalPath}`);
console.log('Dashboard source: local journal + live GitHub TIGERIQ_JOB_V1 lifecycle projection.');
console.log('Web Local V6 overlays #338 governance + PC01 three-layer status without weakening V5 auth/CSRF.');
console.log('Write actions require TIGERIQ_COMMAND_SECRET + CSRF + bounded allowlist.');
console.log('Live PC01 runtime performs bounded Worker self-heal; candidate localhost releases never mutate Worker runtime.');

const shutdown = async () => {
  await server.close();
  await cockpitV5.close();
  await backend.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
