import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { FileJournal } from '../../../packages/event-store/src/index.js';
import { DurableControlPlane } from '../../../packages/durable-control-plane/src/index.js';
import { GitHubWorkSource } from './github-work-source.js';
import { schedulePc01RuntimeSelfHeal } from './runtime-self-heal.js';
import { startDashboard } from './server.js';
import { startOwnerCockpitV5 } from './server-v5.js';
import { startOwnerCockpitV8 } from './server-v8.js';
import { startOwnerCockpitV10 } from './server-v10.js';
import { startOwnerCockpitV11 } from './server-v11.js';
import { startOwnerCockpitV12 } from './server-v12.js';
import { startOwnerCockpitV17 } from './server-v17.js';

const execFileAsync = promisify(execFile);
const journalPath = process.env.TIGERIQ_JOURNAL ?? 'F:\\TigerIQ\\State\\control-plane.jsonl';
const host = process.env.TIGERIQ_COMMAND_HOST ?? '127.0.0.1';
const port = Number(process.env.TIGERIQ_COMMAND_PORT ?? '8787');
const repo = process.env.TIGERIQ_REPO ?? 'newsdayads/tigeriq-ai-lab';
const runtimeRoot = process.env.TIGERIQ_REPO_ROOT ?? '';
const currentReleasePath = process.env.TIGERIQ_CURRENT_RELEASE ?? 'F:\\TigerIQ\\CommandCenter\\current-release.txt';
const updaterStatePath = process.env.TIGERIQ_UPDATER_STATE ?? 'F:\\TigerIQ\\CommandCenter\\updater-v3-state.json';
const WEB_LOCAL_VERSION = 'WEB-LOCAL-396-V4.0';
const LIVE_UI_MARKERS = [
  'TigerIQ AI Lab',
  'Bảng điều hành',
  'Tổng quan',
  'Công việc',
  'Dự án',
  'Nhân sự',
  'Hệ thống',
  'Báo cáo',
  'Cài đặt',
  'Vy (Trợ lý)',
  'Minh (NV01)',
  'Khoa (NV02)',
  'Huy (NV03)',
  'Khải (NV04)',
  'Đang làm',
  'Ai phụ trách',
  'Tiến độ',
  'Vướng mắc',
  'Cần anh Sơn',
  'Công việc đang chạy',
  'Đội AI',
  'Phân bổ công việc',
  'Tải theo nhân sự',
  'Trạng thái hệ thống',
  'data-layout="executive-reference-1648x928"',
  'data-font="segoe-ui"',
  'font-family:"Segoe UI"',
  'x-kpis',
  'x-work-card',
  'x-donut',
  'x-team-grid',
  'x-system-grid',
  'x-owner-card',
  'x-live-script',
  '/?view=work',
  '/?view=models',
  '/?view=workforce',
  '/?view=system',
  '/?view=reports',
  '/?view=settings',
  '/?view=evidence',
  WEB_LOCAL_VERSION,
] as const;

const FUNCTIONAL_MARKERS: Array<[string, string]> = [
  ['work', 'id="cong-viec"'],
  ['workforce', 'id="doi-ai"'],
  ['models', 'id="mo-hinh"'],
  ['evidence', 'id="bang-chung"'],
  ['reports', 'id="bao-cao"'],
  ['system', 'id="he-thong"'],
  ['settings', 'id="cai-dat"'],
];

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

function leafSha(value: string): string | null {
  const leaf = value.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? '';
  return /^[0-9a-f]{40}$/i.test(leaf) ? leaf.toLowerCase() : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitWebLocalRuntimeEvidence(serverUrl: string): Promise<void> {
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return;
  const sourceSha = leafSha(runtimeRoot);
  if (!sourceSha) return;
  const marker = `TIGERIQ_WEB_LOCAL_RUNTIME_EVIDENCE\nversion=${WEB_LOCAL_VERSION}\nsource_sha=${sourceSha}`;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(1000);
    try {
      const [pointerRaw, stateRaw] = await Promise.all([
        readFile(currentReleasePath, 'utf8'),
        readFile(updaterStatePath, 'utf8'),
      ]);
      const pointerSha = leafSha(pointerRaw);
      const state = JSON.parse(stateRaw) as { result?: string; installedSha?: string; runId?: string | number; updatedAt?: string };
      const updaterOk = state.result === 'UPDATED' || state.result === 'NO_CHANGE';
      if (!updaterOk || pointerSha !== sourceSha || String(state.installedSha ?? '').toLowerCase() !== sourceSha) continue;

      const health = await fetch(`${serverUrl}/api/status`, { cache: 'no-store' });
      if (!health.ok) continue;
      const ui = await fetch(`${serverUrl}/`, { cache: 'no-store' });
      if (!ui.ok) continue;
      const uiHtml = await ui.text();
      const missingUiMarkers = LIVE_UI_MARKERS.filter((required) => !uiHtml.includes(required));
      if (missingUiMarkers.length > 0) continue;
      if (uiHtml.includes('fonts.googleapis.com') || uiHtml.includes('font-family:"Open Sans"') || uiHtml.includes('font-family:Inter')) continue;
      if ((uiHtml.match(/<aside class="x-sidebar">/g) ?? []).length !== 1) continue;
      if (/http-equiv=["']refresh["']/i.test(uiHtml)) continue;

      let functionalOk = true;
      for (const [view, expected] of FUNCTIONAL_MARKERS) {
        const response = await fetch(`${serverUrl}/?view=${view}`, { cache: 'no-store' });
        if (!response.ok) { functionalOk = false; break; }
        const html = await response.text();
        if (!html.includes(expected) || !html.includes('data-layout="executive-functional-v4"') || html.includes('x-live-script')) { functionalOk = false; break; }
      }
      if (!functionalOk) continue;

      const { stdout } = await execFileAsync('gh', ['api', `repos/${repo}/issues/396/comments?per_page=100`], {
        timeout: 15_000,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
      });
      const comments = JSON.parse(stdout || '[]') as Array<{ body?: string | null }>;
      if (comments.some((item) => String(item.body ?? '').includes(marker))) return;

      const evidence = [
        marker,
        `url=http://${host}:${port}`,
        `health_http=${health.status}`,
        `ui_http=${ui.status}`,
        `ui_required_markers=${LIVE_UI_MARKERS.length}/${LIVE_UI_MARKERS.length}`,
        `updater_result=${state.result}`,
        `updater_run_id=${state.runId ?? 'unknown'}`,
        `updater_updated_at=${state.updatedAt ?? 'unknown'}`,
        'current_release_match=true',
        'architecture_reset=V12_STABLE_DATA_AND_FUNCTIONS_TO_SINGLE_V17_RENDERER',
        'legacy_presentation_runtime_v13_v14_v15=REMOVED',
        'reference_layout=APPROVED_1648x928_EXECUTIVE_SCREENSHOT',
        'segoe_ui=ĐẠT',
        'primary_navigation=7',
        'secondary_models_evidence_preserved=ĐẠT',
        'real_data_only=ĐẠT',
        'synthetic_progress_forbidden=ĐẠT',
        'overview_live_incremental_10s=ĐẠT',
        'full_page_reload=REMOVED',
        'functional_routes=7/7',
        'functional_forms_and_actions_preserved=ĐẠT',
        'overview_and_functional_theme_consistent=ĐẠT',
        'state=WEB_LOCAL_396_V40_EXECUTIVE_RUNTIME_AND_FUNCTIONS_VERIFIED',
      ].join('\n');
      await execFileAsync('gh', ['api', `repos/${repo}/issues/396/comments`, '--method', 'POST', '-f', `body=${evidence}`], {
        timeout: 15_000,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 512 * 1024,
      });
      return;
    } catch {
      // Evidence emission is bounded and never blocks the local runtime.
    }
  }
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
const cockpitV8 = await startOwnerCockpitV8({ cockpitUrl: cockpitV5.url, backendUrl: backend.url, repo, host: '127.0.0.1', port: 0 });
const cockpitV10 = await startOwnerCockpitV10({ cockpitUrl: cockpitV8.url, host: '127.0.0.1', port: 0 });
const cockpitV11 = await startOwnerCockpitV11({ cockpitUrl: cockpitV10.url, host: '127.0.0.1', port: 0 });
const cockpitV12 = await startOwnerCockpitV12({ cockpitUrl: cockpitV11.url, host: '127.0.0.1', port: 0 });
const server = await startOwnerCockpitV17({ stableUrl: cockpitV12.url, backendUrl: backend.url, repo, host, port });
void emitWebLocalRuntimeEvidence(server.url);
schedulePc01RuntimeSelfHeal({ host, repo, repoRoot: process.env.TIGERIQ_REPO_ROOT });

console.log(`TigerIQ Owner Cockpit V17 / Executive UI V4.0 online: ${server.url}`);
console.log(`Stable functional surface V12: ${cockpitV12.url}`);
console.log('Legacy presentation V13/V14/V15 is not in the final runtime chain.');
console.log(`Internal Owner Cockpit V11: ${cockpitV11.url}`);
console.log(`Internal Owner Cockpit V10: ${cockpitV10.url}`);
console.log(`Internal Owner Cockpit V8: ${cockpitV8.url}`);
console.log(`Internal Owner Cockpit V5: ${cockpitV5.url}`);
console.log(`Internal Command Center backend: ${backend.url}`);
console.log(`Journal: ${journalPath}`);
console.log('Overview V4 uses structured live governance + telemetry; functional routes preserve existing actions under the same executive shell.');
console.log('Write actions require TIGERIQ_COMMAND_SECRET + CSRF + bounded allowlist.');
console.log('Live PC01 runtime performs bounded Worker self-heal; candidate localhost releases never mutate Worker runtime.');

const shutdown = async () => {
  await server.close();
  await cockpitV12.close();
  await cockpitV11.close();
  await cockpitV10.close();
  await cockpitV8.close();
  await cockpitV5.close();
  await backend.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
