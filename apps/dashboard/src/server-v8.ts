import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import type { ServerTelemetry } from './server.js';

const execFileAsync = promisify(execFile);
export const WEB_LOCAL_VERSION_V8 = 'WEB-LOCAL-322-V4';
const WEB_LOCAL_SOURCE = 'wo250/command-center-artifact-updater-v3';
const MAX_BODY_BYTES = 64 * 1024;

type Issue = { number?: number; title?: string; body?: string | null; state?: string; state_reason?: string | null; html_url?: string; updated_at?: string };
type Comment = { body?: string | null; created_at?: string | null; updated_at?: string | null; html_url?: string };
type EmployeeCode = 'NV01' | 'NV02' | 'NV03' | 'NV04';
type Lane = { issue: Issue; comments: Comment[] };

export type GovernanceV8 = {
  central: Issue | null;
  centralComments: Comment[];
  registry: Issue | null;
  currentIssue: Issue | null;
  currentComments: Comment[];
  lanes: Lane[];
  installedSha: string | null;
};

export interface OwnerCockpitV8Options {
  cockpitUrl: string;
  backendUrl: string;
  repo: string;
  host?: string;
  port?: number;
  governance?: () => Promise<GovernanceV8>;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function compact(value: string, max = 180): string {
  const out = String(value || '').replace(/\s+/g, ' ').trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

function sectionPrefix(bodyText: string, headingPrefix: string): string {
  const escaped = headingPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = bodyText.match(new RegExp(`(?:^|\\n)##\\s+${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'));
  return (match?.[1] ?? '').trim();
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true;
  const p = host.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 127 || p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

async function body(req: IncomingMessage): Promise<string | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.length;
    if (total > MAX_BODY_BYTES) throw new Error('payload_too_large');
    chunks.push(part);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function copyHeaders(upstream: Response, res: ServerResponse, contentType?: string): void {
  const blocked = new Set(['content-length', 'transfer-encoding', 'connection', 'content-encoding']);
  for (const [key, value] of upstream.headers.entries()) if (!blocked.has(key.toLowerCase())) res.setHeader(key, value);
  if (contentType) res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
}

async function ghJson<T>(repo: string, endpoint: string): Promise<T> {
  const { stdout } = await execFileAsync('gh', ['api', `repos/${repo}/${endpoint}`], {
    timeout: 15_000,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout || '{}') as T;
}

async function installedSha(): Promise<string | null> {
  const currentPath = process.env.TIGERIQ_CURRENT_RELEASE ?? 'F:\\TigerIQ\\CommandCenter\\current-release.txt';
  try {
    const current = (await readFile(currentPath, 'utf8')).trim();
    const leaf = current.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
    return /^[0-9a-f]{40}$/i.test(leaf) ? leaf.toLowerCase() : null;
  } catch { return null; }
}

function commentTime(comment: Comment): number {
  const value = Date.parse(comment.updated_at || comment.created_at || '1970-01-01');
  return Number.isFinite(value) ? value : 0;
}

export function resolvePriorityIssueNumberV8(central: Issue | null, comments: Comment[] = []): number | null {
  const newest = [...comments].sort((a, b) => commentTime(b) - commentTime(a));
  for (const comment of newest) {
    const text = String(comment.body ?? '');
    const current = text.match(/ƯU TIÊN HIỆN HÀNH\s*:?\s*[\s\S]{0,900}?#(\d+)/i);
    if (current) return Number(current[1]);
    const absolute = text.match(/P0_ABSOLUTE[^\n#]{0,160}#(\d+)|#(\d+)[^\n]{0,160}P0_ABSOLUTE/i);
    if (absolute) return Number(absolute[1] || absolute[2]);
  }
  const centralBody = String(central?.body ?? '');
  const prioritySection = sectionPrefix(centralBody, 'Ưu tiên hiện hành');
  const sectionMatch = prioritySection.match(/#(\d+)/);
  if (sectionMatch) return Number(sectionMatch[1]);
  const bodyMatch = centralBody.match(/##\s*P0 hiện hành[^\n]*#(\d+)/i);
  return bodyMatch ? Number(bodyMatch[1]) : null;
}

export function resolveLaneIssueNumbersV8(central: Issue | null, currentNumber: number | null): number[] {
  const block = sectionPrefix(String(central?.body ?? ''), 'Ưu tiên hiện hành');
  const numbers: number[] = [];
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+\.\s+.*?#(\d+)/);
    if (match) numbers.push(Number(match[1]));
  }
  if (currentNumber) numbers.unshift(currentNumber);
  return [...new Set(numbers.filter((value) => Number.isInteger(value) && value > 0))].slice(0, 4);
}

async function defaultGovernance(repo: string): Promise<GovernanceV8> {
  const [central, centralCommentsRaw, registry, sha] = await Promise.all([
    ghJson<Issue>(repo, 'issues/280').catch(() => null),
    ghJson<Comment[]>(repo, 'issues/280/comments?per_page=100').catch(() => []),
    ghJson<Issue>(repo, 'issues/335').catch(() => null),
    installedSha(),
  ]);
  const centralComments = Array.isArray(centralCommentsRaw) ? centralCommentsRaw : [];
  const currentNumber = resolvePriorityIssueNumberV8(central, centralComments);
  const laneNumbers = resolveLaneIssueNumbersV8(central, currentNumber);
  const lanes = await Promise.all(laneNumbers.map(async (number): Promise<Lane | null> => {
    const [issue, comments] = await Promise.all([
      ghJson<Issue>(repo, `issues/${number}`).catch(() => null),
      ghJson<Comment[]>(repo, `issues/${number}/comments?per_page=100`).catch(() => []),
    ]);
    return issue ? { issue, comments: Array.isArray(comments) ? comments : [] } : null;
  }));
  const validLanes = lanes.filter((lane): lane is Lane => lane !== null);
  const currentLane = validLanes.find((lane) => Number(lane.issue.number) === currentNumber) ?? null;
  return {
    central,
    centralComments,
    registry,
    currentIssue: currentLane?.issue ?? null,
    currentComments: currentLane?.comments ?? [],
    lanes: validLanes,
    installedSha: sha,
  };
}

function latestLifecycle(comments: Comment[]): { state: string; css: string; note: string; active: boolean } {
  const newest = [...comments].sort((a, b) => commentTime(b) - commentTime(a));
  for (const comment of newest) {
    const text = String(comment.body ?? '');
    const stateMatch = [...text.matchAll(/(?:^|\n)state=([^\n]+)/gi)].at(-1)?.[1]?.trim();
    const note = compact(stateMatch || text.split(/\r?\n/).find((line) => line.trim()) || 'Có bằng chứng cập nhật', 110);
    if (stateMatch && /HOÀN_TẤT|HOÀN TẤT|DONE|COMPLETED/i.test(stateMatch)) return { state: 'HOÀN TẤT', css: 'ok', note, active: false };
    if (stateMatch && /LỖI|BỊ_CHẶN|BỊ CHẶN|FAILED|BLOCKED/i.test(stateMatch)) return { state: 'LỖI / BỊ CHẶN', css: 'bad', note, active: false };
    if (stateMatch && /CHỜ|PENDING|WAIT/i.test(stateMatch)) return { state: 'ĐANG CHỜ', css: 'neutral', note, active: false };
    if (stateMatch && /ĐANG_XỬ_LÝ|ĐANG XỬ LÝ|IN_PROGRESS/i.test(stateMatch)) return { state: 'ĐANG XỬ LÝ', css: 'run', note, active: true };
    if (/TIGERIQ_(?:JOB|COMMAND|PC01)_(?:DONE|RESULT)/i.test(text)) return { state: 'HOÀN TẤT', css: 'ok', note, active: false };
    if (/TIGERIQ_(?:JOB|COMMAND|PC01)_FAILED/i.test(text)) return { state: 'LỖI / BỊ CHẶN', css: 'bad', note, active: false };
    if (/TIGERIQ_(?:JOB|COMMAND|PC01)_CLAIMED|heartbeat/i.test(text)) return { state: 'ĐANG XỬ LÝ', css: 'run', note, active: true };
  }
  return { state: 'CHỜ VIỆC', css: 'neutral', note: 'Chưa có claim/heartbeat mới', active: false };
}

function employeeCode(value: string): EmployeeCode | null {
  const exact = value.match(/\b(NV0[1-4])\b/i)?.[1]?.toUpperCase() as EmployeeCode | undefined;
  if (exact) return exact;
  if (/Minh\s*\(/i.test(value)) return 'NV01';
  if (/Khoa\s*\(/i.test(value)) return 'NV02';
  if (/Huy\s*\(/i.test(value)) return 'NV03';
  if (/Khải\s*\(/i.test(value)) return 'NV04';
  return null;
}

export function ownerCodeV8(issue: Issue | null, comments: Comment[]): EmployeeCode | null {
  const newest = [...comments].sort((a, b) => commentTime(b) - commentTime(a));
  for (const comment of newest) {
    const text = String(comment.body ?? '');
    const field = text.match(/(?:^|\n)(?:employee_id|owner|claimed_by|active_owner|assigned_to|new_owner)=([^\n]+)/i)?.[1];
    const code = field ? employeeCode(field) : null;
    if (code) return code;
  }
  const titleCode = employeeCode(String(issue?.title ?? ''));
  if (titleCode) return titleCode;
  const responsible = sectionPrefix(String(issue?.body ?? ''), 'Người phụ trách');
  const responsibleCode = employeeCode(responsible.slice(0, 500));
  if (responsibleCode) return responsibleCode;
  const explicitOwner = String(issue?.body ?? '').match(/(?:^|\n)(?:owner|employee_id|assigned_to)=([^\n]+)/i)?.[1];
  return explicitOwner ? employeeCode(explicitOwner) : null;
}

function ownerName(code: EmployeeCode | null): string {
  if (code === 'NV01') return 'Minh (NV01 — Thực thi trực tiếp)';
  if (code === 'NV02') return 'Khoa (NV02 — Vận hành tự động)';
  if (code === 'NV03') return 'Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)';
  if (code === 'NV04') return 'Khải (NV04 — Kỹ sư Tích hợp AI/API)';
  return 'CHƯA XÁC MINH';
}

function nv03Paused(governance: GovernanceV8): boolean {
  const registry = String(governance.registry?.body ?? '');
  const central = String(governance.central?.body ?? '');
  return /NV03[^\n]*active=false[^\n]*TẠM NGƯNG/i.test(registry)
    || /`3`[^\n]*false[^\n]*TẠM NGƯNG/i.test(registry)
    || /Huy[^\n]*NV03[^\n]*TẠM NGƯNG/i.test(central)
    || /Command `3`[^\n]*enabled=false/i.test(`${registry}\n${central}`);
}

export function controlPlaneStateV8(telemetry: ServerTelemetry): { label: string; css: string; note: string } {
  if (!telemetry.available || telemetry.controller === null) return { label: 'CHƯA XÁC MINH', css: 'neutral', note: 'Chưa có dữ liệu Controller' };
  if (telemetry.controller.online !== true) return { label: 'SUY GIẢM / BỊ LỖI', css: 'bad', note: telemetry.controller.port ? `Controller cổng ${telemetry.controller.port} không phản hồi` : 'Controller không phản hồi' };
  return { label: 'TRỰC TUYẾN', css: 'ok', note: telemetry.controller.port ? `Controller cổng ${telemetry.controller.port}` : 'Controller đã phản hồi' };
}

function serverState(telemetry: ServerTelemetry): { label: string; css: string; note: string } {
  if (!telemetry.available) return { label: 'CHƯA XÁC MINH', css: 'neutral', note: 'Không có dữ liệu máy chủ' };
  const note = [telemetry.tailscale?.ip ? `Tailscale ${telemetry.tailscale.ip}` : null, telemetry.uptimeSeconds === null ? null : `thời gian chạy ${Math.floor(telemetry.uptimeSeconds / 3600)}h`].filter(Boolean).join(' · ');
  return { label: 'TRỰC TUYẾN', css: 'ok', note: note || 'Máy chủ có phản hồi' };
}

function systemCards(telemetry: ServerTelemetry, governance: GovernanceV8): string {
  const server = serverState(telemetry);
  const control = controlPlaneStateV8(telemetry);
  const ai = nv03Paused(governance)
    ? { label: 'TẠM NGƯNG', css: 'neutral', note: 'Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local) đang tạm ngưng; Ollama trực tuyến không đồng nghĩa có việc đang chạy' }
    : telemetry.ollama?.online
      ? { label: 'SẴN SÀNG', css: 'neutral', note: `${telemetry.ollama.models.length} model khả dụng; chưa suy diễn có việc đang chạy` }
      : { label: 'CHƯA XÁC MINH', css: 'neutral', note: 'Không có dữ liệu AI PC01' };
  return [
    ['PC01 SERVER', server],
    ['TIGERIQ CONTROL PLANE', control],
    ['AI PC01', ai],
  ].map(([name, state]) => {
    const s = state as { label: string; css: string; note: string };
    return `<article class="tq-system"><div><b>${esc(name)}</b><span class="tq-badge ${esc(s.css)}">${esc(s.label)}</span></div><small>${esc(s.note)}</small></article>`;
  }).join('');
}

function laneFor(governance: GovernanceV8, code: EmployeeCode): { lane: Lane; lifecycle: ReturnType<typeof latestLifecycle> } | null {
  for (const lane of governance.lanes) {
    if (ownerCodeV8(lane.issue, lane.comments) === code) return { lane, lifecycle: latestLifecycle(lane.comments) };
  }
  return null;
}

function employeeCards(governance: GovernanceV8): string {
  const paused = nv03Paused(governance);
  const rows: Array<[string, string, string, string, string]> = [];
  rows.push(['Vy (Trợ lý)', 'Điều phối', 'ĐIỀU PHỐI', 'neutral', 'Điều phối, không chiếm quyền thực thi']);
  const defs: Array<[EmployeeCode, string, string]> = [
    ['NV01', 'Minh (NV01 — Thực thi trực tiếp)', 'Lệnh 1 · điều khiển trực tiếp'],
    ['NV02', 'Khoa (NV02 — Vận hành tự động)', 'Lệnh 2 · tự động ưu tiên P0'],
    ['NV03', 'Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)', 'Lệnh 3 · hệ thống cục bộ PC01'],
    ['NV04', 'Khải (NV04 — Kỹ sư Tích hợp AI/API)', 'Lệnh 4 · tích hợp AI/API'],
  ];
  for (const [code, name, role] of defs) {
    if (code === 'NV03' && paused) {
      rows.push([name, role, 'TẠM NGƯNG', 'neutral', 'Theo Registry #335 / chỉ đạo anh Sơn']);
      continue;
    }
    const resolved = laneFor(governance, code);
    if (!resolved) {
      rows.push([name, role, 'CHỜ VIỆC', 'neutral', 'Không có phạm vi đang xử lý được xác minh']);
      continue;
    }
    const issueNumber = resolved.lane.issue.number ?? '?';
    const life = resolved.lifecycle;
    const state = life.active ? `ĐANG XỬ LÝ #${issueNumber}` : `${life.state} #${issueNumber}`;
    rows.push([name, role, state, life.active ? 'run' : life.css, life.note]);
  }
  return rows.map(([name, role, state, css, note]) => `<article class="tq-person"><div><b>${esc(name)}</b><small>${esc(role)}</small></div><span class="tq-badge ${esc(css)}">${esc(state)}</span><small>${esc(note)}</small></article>`).join('');
}

function allEvidenceComments(governance: GovernanceV8): Comment[] {
  const merged = [...governance.centralComments, ...governance.lanes.flatMap((lane) => lane.comments)];
  return merged.sort((a, b) => commentTime(b) - commentTime(a));
}

export function ownershipEventV8(governance: GovernanceV8): { label: string; css: string; note: string } {
  for (const comment of allEvidenceComments(governance)) {
    const text = String(comment.body ?? '');
    const line = text.split(/\r?\n/).find((row) => /^(?:OWNER_HOLD\s*=|TAKEOVER\b|SKIP\b|TRANSFER\b|CHUYỂN GIAO\b|TIGERIQ_[A-Z0-9_]*(?:TAKEOVER|SKIP|TRANSFER))/i.test(row.trim()));
    if (!line) continue;
    const trimmed = line.trim();
    const label = /^OWNER_HOLD\s*=\s*true/i.test(trimmed) ? 'GIỮ QUYỀN XỬ LÝ' : /^TAKEOVER|TAKEOVER/i.test(trimmed) ? 'TIẾP QUẢN' : /^SKIP|SKIP/i.test(trimmed) ? 'BỎ QUA ĐÚNG QUYỀN' : 'CHUYỂN GIAO';
    return { label, css: label === 'GIỮ QUYỀN XỬ LÝ' ? 'warn' : 'neutral', note: compact(trimmed, 180) };
  }
  return { label: 'KHÔNG CÓ SỰ KIỆN MỚI', css: 'neutral', note: 'Chưa có bằng chứng mới về SKIP / TAKEOVER / OWNER_HOLD / chuyển giao; không tự suy diễn.' };
}

function ownerAction(governance: GovernanceV8): string {
  const explicit = allEvidenceComments(governance).map((item) => String(item.body ?? '')).find((text) => /OWNER_ACTION_REQUIRED=true|CẦN ANH SƠN\s*:/i.test(text));
  if (!explicit) return '<div class="tq-owner ok">✅ Không có việc nào đang cần anh Sơn duyệt hoặc thao tác thật.</div>';
  const line = explicit.split(/\r?\n/).find((row) => /CẦN ANH SƠN|OWNER_ACTION_REQUIRED/i.test(row)) ?? 'Có thao tác cần anh Sơn';
  return `<div class="tq-owner warn">⚠️ ${esc(compact(line, 180))}</div>`;
}

function managementSummary(governance: GovernanceV8): { number: number | null; title: string; status: string; css: string; owner: string; progress: string; current: string; next: string; updated: string } {
  const issue = governance.currentIssue;
  const lifecycle = latestLifecycle(governance.currentComments);
  const owner = ownerName(ownerCodeV8(issue, governance.currentComments));
  if (!issue) return { number: null, title: 'Chưa xác định được P0 hiện hành từ CENTRAL #280', status: 'CHƯA XÁC MINH', css: 'neutral', owner, progress: '—', current: 'Không suy đoán trạng thái', next: 'Kiểm tra CENTRAL #280 / Registry #335', updated: '—' };
  const closed = issue.state === 'closed';
  const status = closed ? 'HOÀN TẤT — CHỜ CENTRAL CHUYỂN P0' : lifecycle.state;
  const css = closed ? 'ok' : lifecycle.css;
  const progress = closed ? '100%' : lifecycle.active ? 'Đang xử lý' : lifecycle.state === 'ĐANG CHỜ' ? 'Đang chờ điều kiện' : 'Chờ claim';
  const current = closed ? 'Issue đã đóng; không tiếp tục chiếu như P0 đang chạy' : lifecycle.note;
  const acceptance = sectionPrefix(String(issue.body ?? ''), 'Điều kiện ĐẠT').split(/\r?\n/).map((line) => line.replace(/^[-*\d.\s]+/, '').trim()).find(Boolean);
  const next = closed ? 'CENTRAL #280 chọn P0 kế tiếp' : compact(acceptance || `Hoàn thành điều kiện #${issue.number} → ghi bằng chứng → cập nhật CENTRAL`, 150);
  return { number: Number(issue.number || 0), title: compact(String(issue.title || ''), 150), status, css, owner, progress, current, next, updated: issue.updated_at ? new Date(issue.updated_at).toLocaleString('vi-VN', { hour12: false }) : '—' };
}

export function renderManagementPanelV8(telemetry: ServerTelemetry, governance: GovernanceV8, now = new Date()): string {
  const summary = managementSummary(governance);
  const ownership = ownershipEventV8(governance);
  const sourceSha = governance.installedSha ?? 'CHƯA XÁC MINH';
  const sourceShort = sourceSha === 'CHƯA XÁC MINH' ? sourceSha : sourceSha.slice(0, 12);
  const issueLabel = summary.number ? `#${summary.number}` : '—';
  return `<style>
.tq322{border:1px solid #31506d;background:#091520;border-radius:15px;margin-bottom:14px;overflow:hidden}.tq322 *{box-sizing:border-box}.tq-head{display:flex;justify-content:space-between;gap:14px;padding:14px;border-bottom:1px solid #21394f}.tq-head b{font-size:15px}.tq-head small,.tq322 small{display:block;color:#8fa3b8;font-size:11px}.tq-build{text-align:right}.tq-section{padding:12px 14px;border-top:1px solid #1c3044}.tq-section h3{margin:0 0 9px;font-size:12px;color:#9eb5cd}.tq-summary{display:grid;grid-template-columns:1.8fr .8fr 1fr 1fr;gap:8px}.tq-cell,.tq-person,.tq-system{border:1px solid #20394f;background:#0d1d2b;border-radius:10px;padding:10px}.tq-cell span{display:block;color:#8fa3b8;font-size:10px}.tq-cell b{display:block;margin-top:4px}.tq-work{width:100%;border-collapse:collapse;font-size:12px}.tq-work th,.tq-work td{text-align:left;padding:8px;border-bottom:1px solid #1c3044;vertical-align:top}.tq-work th{color:#8fa3b8;font-size:10px}.tq-people{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.tq-person{display:grid;grid-template-columns:1fr auto;gap:4px 8px}.tq-person>small{grid-column:1/3}.tq-systems{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.tq-system>div{display:flex;justify-content:space-between;gap:8px}.tq-badge{border-radius:999px;padding:3px 7px;font-size:10px;font-weight:800;white-space:nowrap;border:1px solid #405269}.tq-badge.ok{color:#82e9b2;border-color:#2d694d}.tq-badge.run{color:#98ceff;border-color:#315e88}.tq-badge.bad{color:#ff9da8;border-color:#6b3942}.tq-badge.neutral{color:#aebdca;border-color:#405269;background:#111d29}.tq-badge.warn{color:#ffd17a;border-color:#6c542b;background:#2b2112}.tq-owner{padding:10px;border-radius:10px;font-size:12px;font-weight:700}.tq-owner.ok{border:1px solid #2d694d;color:#82e9b2;background:#0e2a20}.tq-owner.warn{border:1px solid #6c542b;color:#ffd17a;background:#2b2112}.tq-tech{color:#8fa3b8;font-size:11px}.tq-tech summary{cursor:pointer;font-weight:700;color:#aebdca}@media(max-width:900px){.tq-summary{grid-template-columns:1fr 1fr}.tq-people,.tq-systems{grid-template-columns:1fr}.tq-build{text-align:left}}@media(max-width:620px){.tq-head{display:block}.tq-build{margin-top:6px}.tq-summary{grid-template-columns:1fr}.tq-work thead{display:none}.tq-work,.tq-work tbody,.tq-work tr,.tq-work td{display:block;width:100%}.tq-work tr{border:1px solid #20394f;border-radius:10px;padding:5px}.tq-work td{border:0;padding:5px 8px}.tq-work td:before{content:attr(data-label);display:block;color:#8fa3b8;font-size:9px}}
</style><section class="tq322" id="tigeriq-management-v4"><div class="tq-head"><div><b>🐯 TIGERIQ · BẢNG ĐIỀU HÀNH TRẠNG THÁI ĐỘNG</b><small>CENTRAL #280 + Registry #335 + bằng chứng vòng đời hiện hành · không hard-code P0 hoặc người phụ trách</small></div><div class="tq-build"><b>${WEB_LOCAL_VERSION_V8}</b><small>Nguồn ${WEB_LOCAL_SOURCE}@${esc(sourceShort)} · ${esc(now.toLocaleString('vi-VN', { hour12: false }))}</small></div></div><div class="tq-section"><h3>📊 TIẾN ĐỘ TỔNG THỂ</h3><div class="tq-summary"><div class="tq-cell"><span>CÔNG VIỆC HIỆN HÀNH</span><b>${esc(issueLabel)} · ${esc(summary.title)}</b></div><div class="tq-cell"><span>TIẾN ĐỘ</span><b>${esc(summary.progress)}</b></div><div class="tq-cell"><span>TRẠNG THÁI</span><b><span class="tq-badge ${esc(summary.css)}">${esc(summary.status)}</span></b></div><div class="tq-cell"><span>NGƯỜI PHỤ TRÁCH</span><b>${esc(summary.owner)}</b></div></div></div><div class="tq-section"><h3>🔄 VIỆC ĐANG XỬ LÝ</h3><table class="tq-work"><thead><tr><th>Công việc</th><th>Người phụ trách</th><th>Tiến độ</th><th>Trạng thái</th><th>Mốc kế tiếp</th><th>Cập nhật cuối</th></tr></thead><tbody><tr><td data-label="Công việc">${esc(issueLabel)} · ${esc(summary.title)}</td><td data-label="Người phụ trách">${esc(summary.owner)}</td><td data-label="Tiến độ">${esc(summary.progress)}</td><td data-label="Trạng thái">${esc(summary.status)}</td><td data-label="Mốc kế tiếp">${esc(summary.next)}</td><td data-label="Cập nhật cuối">${esc(summary.updated)}</td></tr></tbody></table><div class="tq-cell" style="margin-top:8px"><span>BƯỚC HIỆN TẠI</span><b>${esc(summary.current)}</b></div></div><div class="tq-section"><h3>🔐 QUYỀN XỬ LÝ / CHUYỂN GIAO</h3><div class="tq-cell"><span class="tq-badge ${esc(ownership.css)}">${esc(ownership.label)}</span><b>${esc(ownership.note)}</b></div></div><div class="tq-section"><h3>🔴 CẦN ANH SƠN</h3>${ownerAction(governance)}</div><div class="tq-section"><h3>👥 NHÂN SỰ AI</h3><div class="tq-people">${employeeCards(governance)}</div></div><div class="tq-section"><h3>🖥️ TÌNH TRẠNG HỆ THỐNG</h3><div class="tq-systems">${systemCards(telemetry, governance)}</div></div><div class="tq-section"><details class="tq-tech"><summary>🧾 Bằng chứng kỹ thuật</summary><p>CENTRAL #280 cập nhật: ${esc(governance.central?.updated_at || 'CHƯA XÁC MINH')} · Registry #335 cập nhật: ${esc(governance.registry?.updated_at || 'CHƯA XÁC MINH')} · P0 xác định: ${esc(issueLabel)} · số lane: ${governance.lanes.length} · build ${esc(sourceShort)}</p></details></div></section>`;
}

export function injectManagementPanelV8(html: string, panel: string, telemetry: ServerTelemetry): string {
  const control = controlPlaneStateV8(telemetry);
  let out = html;
  if (control.css !== 'ok') out = out.replace(/✓\s*Hệ thống\s+hoạt động/gi, control.css === 'bad' ? '⚠ Control Plane SUY GIẢM' : '⚠ Hệ thống CHƯA XÁC MINH');
  const marker = '</header>';
  const index = out.indexOf(marker);
  return index >= 0 ? `${out.slice(0, index + marker.length)}${panel}${out.slice(index + marker.length)}` : `${panel}${out}`;
}

async function fetchTelemetry(backendUrl: string): Promise<ServerTelemetry> {
  const response = await fetch(`${backendUrl}/api/server`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`telemetry_${response.status}`);
  return response.json() as Promise<ServerTelemetry>;
}

async function proxyResponse(options: OwnerCockpitV8Options, req: IncomingMessage, res: ServerResponse, governanceReader: () => Promise<GovernanceV8>): Promise<void> {
  const requestHeaders = new Headers();
  if (req.headers.cookie) requestHeaders.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') requestHeaders.set('content-type', contentType);
  const upstream = await fetch(`${options.cockpitUrl}${req.url ?? '/'}`, { method: req.method, headers: requestHeaders, body: await body(req), redirect: 'manual' });
  const upstreamType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
  if (req.method === 'GET' && new URL(req.url ?? '/', 'http://local').pathname === '/' && upstream.ok && upstreamType.includes('text/html')) {
    const [html, telemetry, governance] = await Promise.all([upstream.text(), fetchTelemetry(options.backendUrl), governanceReader()]);
    const page = injectManagementPanelV8(html, renderManagementPanelV8(telemetry, governance), telemetry);
    copyHeaders(upstream, res, 'text/html; charset=utf-8');
    res.statusCode = upstream.status;
    res.end(page);
    return;
  }
  const payload = Buffer.from(await upstream.arrayBuffer());
  copyHeaders(upstream, res);
  res.statusCode = upstream.status;
  res.end(payload);
}

export async function startOwnerCockpitV8(options: OwnerCockpitV8Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public_bind_forbidden');
  const governanceReader = options.governance ?? (() => defaultGovernance(options.repo));
  const server = createServer(async (req, res) => {
    try { await proxyResponse(options, req, res, governanceReader); }
    catch (error) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ error: 'owner_cockpit_v8_unavailable', detail: String(error instanceof Error ? error.message : error).slice(0, 160) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
