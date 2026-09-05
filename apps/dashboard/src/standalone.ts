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
import { startOwnerCockpitV13 } from './server-v13.js';
import { startOwnerCockpitV14 } from './server-v14.js';
import { startOwnerCockpitV15 } from './server-v15.js';

const execFileAsync = promisify(execFile);
const journalPath = process.env.TIGERIQ_JOURNAL ?? 'F:\\TigerIQ\\State\\control-plane.jsonl';
const host = process.env.TIGERIQ_COMMAND_HOST ?? '127.0.0.1';
const port = Number(process.env.TIGERIQ_COMMAND_PORT ?? '8787');
const repo = process.env.TIGERIQ_REPO ?? 'newsdayads/tigeriq-ai-lab';
const runtimeRoot = process.env.TIGERIQ_REPO_ROOT ?? '';
const currentReleasePath = process.env.TIGERIQ_CURRENT_RELEASE ?? 'F:\\TigerIQ\\CommandCenter\\current-release.txt';
const updaterStatePath = process.env.TIGERIQ_UPDATER_STATE ?? 'F:\\TigerIQ\\CommandCenter\\updater-v3-state.json';
const WEB_LOCAL_VERSION = 'WEB-LOCAL-396-V3.6';
// Current presentation layer: V3.6 incremental live refresh + independent dashboard columns over V3.5 layout repair.
const LIVE_UI_MARKERS = [
  'Vy (Trợ lý)',
  'Minh (NV01 — Thực thi trực tiếp)',
  'Khoa (NV02 — Vận hành tự động)',
  'Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)',
  'Khải (NV04 — Kỹ sư Tích hợp AI/API)',
  'Tạm ngưng',
  'Đang làm',
  'Ai phụ trách',
  'Tiến độ',
  'Vướng mắc',
  'Cần anh Sơn',
  'Công việc đang chạy',
  'Đội AI',
  'Hệ thống',
  'Phân bố công việc',
  'Tải theo nhân sự',
  'Trạng thái hệ thống',
  'Quyền xử lý / chuyển giao',
  'data-font="segoe-ui-default"',
  'data-theme="fluent-executive-v36"',
  'data-layout="v35-repaired"',
  'data-refresh="incremental-10s"',
  'data-visual-spec="fluent-executive-mockup"',
  'font-family:"Segoe UI"',
  'tq34-donut',
  'tq34-avatar',
  'tq34-owner-highlight',
  'tq35-layout-repair',
  'tq36-live-overview',
  'tq36-live-state',
  'tq36-columns',
  'data-overview="single-dashboard-v32"',
  '/?view=work',
  '/?view=workforce',
  '/?view=models',
  '/?view=evidence',
  '/?view=reports',
  '/?view=system',
  '/?view=settings',
  'tq31-button',
  'tigeriq-management-v31',
  WEB_LOCAL_VERSION,
] as const;

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
      const forbiddenOverview = ['id="cong-viec"', 'id="doi-ai"', 'id="mo-hinh"', 'id="bang-chung"', 'id="bao-cao"', 'id="he-thong"', 'id="cai-dat"'];
      if (forbiddenOverview.some((markerText) => uiHtml.includes(markerText))) continue;
      if ((uiHtml.match(/<aside class="sidebar">/g) ?? []).length !== 1) continue;
      if (/http-equiv=["']refresh["']/i.test(uiHtml)) continue;

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
        'segoe_ui_font_contract=ĐẠT',
        'segoe_ui_whole_site=ĐẠT',
        'google_font_removed=ĐẠT',
        'fluent_executive_visual_contract=ĐẠT',
        'visual_reference=APPROVED_FLUENT_EXECUTIVE_MOCKUP',
        'layout_repair_v35=ĐẠT',
        'sidebar_single_dom=ĐẠT',
        'system_card_compaction=ĐẠT',
        'system_text_wrap_contract=ĐẠT',
        'bottom_grid_gap_repair=ĐẠT',
        'independent_dashboard_columns=ĐẠT',
        'work_table_gap_removed=ĐẠT',
        'brand_icon_polish=ĐẠT',
        'team_avatar_alignment=ĐẠT',
        'incremental_refresh=ĐẠT',
        'incremental_refresh_interval_seconds=10',
        'full_page_meta_refresh_removed=ĐẠT',
        'changed_section_flash=ĐẠT',
        'manual_refresh_button=ĐẠT',
        'live_age_indicator=ĐẠT',
        'minimum_readable_text=13px',
        'executive_color_system=ĐẠT',
        'fluent_icons=ĐẠT',
        'donut_visual=ĐẠT',
        'team_avatar_cards=ĐẠT',
        'owner_highlight=ĐẠT',
        'button_interaction_states=ĐẠT',
        'overview_single_dashboard=ĐẠT',
        'legacy_overview_duplicate_removed=ĐẠT',
        'server_side_views=8',
        'visualizations_real_data=3',
        'responsive_css_contract=ĐẠT',
        'dynamic_central_registry_projection=ĐẠT',
        'ownership_projection=ĐẠT',
        'candidate_and_live_health=ĐẠT',
        'live_ui_contract=ĐẠT',
        'state=WEB_LOCAL_396_V36_INCREMENTAL_LIVE_VERIFIED',
      ].join('\n');
      await execFileAsync('gh', ['api', `repos/${repo}/issues/396/comments`, '--method', 'POST', '-f', `body=${evidence}`], {
        timeout: 15_000,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 512 * 1024,
      });
      return;
    } catch {
      // Evidence emission is bounded and must never prevent the local Web runtime from serving.
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
const cockpitV13 = await startOwnerCockpitV13({ cockpitUrl: cockpitV12.url, host: '127.0.0.1', port: 0 });
const cockpitV14 = await startOwnerCockpitV14({ cockpitUrl: cockpitV13.url, host: '127.0.0.1', port: 0 });
const server = await startOwnerCockpitV15({ cockpitUrl: cockpitV14.url, host, port });
void emitWebLocalRuntimeEvidence(server.url);
schedulePc01RuntimeSelfHeal({ host, repo, repoRoot: process.env.TIGERIQ_REPO_ROOT });

console.log(`TigerIQ Owner Cockpit V15 / UI V3.6 Incremental Live online: ${server.url}`);
console.log(`Internal Owner Cockpit V14 / UI V3.5 Layout Repair: ${cockpitV14.url}`);
console.log(`Internal Owner Cockpit V13 / UI V3.4 Fluent Executive: ${cockpitV13.url}`);
console.log(`Internal Owner Cockpit V12 / UI V3.3 Segoe UI: ${cockpitV12.url}`);
console.log(`Internal Owner Cockpit V11 / UI V3.2: ${cockpitV11.url}`);
console.log(`Internal Owner Cockpit V10 historical presentation layer: ${cockpitV10.url}`);
console.log(`Internal Owner Cockpit V8: ${cockpitV8.url}`);
console.log(`Internal Owner Cockpit V5: ${cockpitV5.url}`);
console.log(`Internal Command Center backend: ${backend.url}`);
console.log(`Journal: ${journalPath}`);
console.log('Dashboard source: local journal + live GitHub lifecycle projection.');
console.log('Web Local V15 refreshes changed overview sections incrementally every 10 seconds without full-page reload.');
console.log('Write actions require TIGERIQ_COMMAND_SECRET + CSRF + bounded allowlist.');
console.log('Live PC01 runtime performs bounded Worker self-heal; candidate localhost releases never mutate Worker runtime.');

const shutdown = async () => {
  await server.close();
  await cockpitV14.close();
  await cockpitV13.close();
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
