import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import type { ServerTelemetry, WorkforceEmployeeTelemetry } from './server.js';

const execFileAsync = promisify(execFile);

type DashboardWorkOrder = {
  id: string;
  project: string;
  goal: string;
  status: string;
  latestGateStatus: string | null;
  evidenceCount: number;
};

type DashboardSummary = {
  generatedAt?: string;
  workOrders: DashboardWorkOrder[];
  evidenceCount: number;
};

type GitHubIssue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  pull_request?: unknown;
};

type GitHubComment = {
  id: number;
  body: string | null;
  created_at: string | null;
  updated_at: string | null;
  html_url: string;
};

type UpdaterState = {
  result: string;
  installedSha: string | null;
  updatedAt: string | null;
  error: string | null;
  runId: string | null;
};

export interface GithubControlAdapter {
  listIssues(): Promise<GitHubIssue[]>;
  comments(issueNumber: number): Promise<GitHubComment[]>;
  comment(issueNumber: number, body: string): Promise<void>;
  close(issueNumber: number): Promise<void>;
  create(title: string, body: string): Promise<string>;
}

export interface OwnerCockpitV5Options {
  backendUrl: string;
  repo: string;
  host?: string;
  port?: number;
  github?: GithubControlAdapter;
  readUpdaterState?: () => Promise<UpdaterState>;
}

const headers = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function respond(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...headers, ...extra, 'content-type': type });
  res.end(body);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { ...headers, location });
  res.end();
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true;
  const p = host.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 127 || p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 64 * 1024) throw new Error('payload_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function proxy(backendUrl: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const h = new Headers();
  if (req.headers.cookie) h.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') h.set('content-type', contentType);
  const upstream = await fetch(`${backendUrl}${req.url ?? '/'}`, {
    method: req.method,
    headers: h,
    body: await readBody(req),
    redirect: 'manual',
  });
  const extra: Record<string, string> = {};
  const location = upstream.headers.get('location');
  const cookie = upstream.headers.get('set-cookie');
  if (location) extra.location = location;
  if (cookie) extra['set-cookie'] = cookie;
  respond(res, upstream.status, upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8', await upstream.text(), extra);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authorizeWrite(backendUrl: string, req: IncomingMessage, form: URLSearchParams): Promise<boolean> {
  if (!req.headers.cookie) return false;
  const upstream = await fetch(`${backendUrl}/`, { headers: { cookie: req.headers.cookie } });
  if (!upstream.ok) return false;
  const html = await upstream.text();
  const expected = html.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
  const provided = form.get('csrf') ?? '';
  return Boolean(expected && provided && safeEqual(expected, provided));
}

function section(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'));
  return (match?.[1] ?? '').trim();
}

function issueWorkOrderId(issue: GitHubIssue): string {
  const explicit = section(String(issue.body ?? ''), 'Work Order').replace(/\s+/g, ' ').trim();
  return explicit || `WO-GH-${issue.number}`;
}

function createDefaultGithub(repo: string): GithubControlAdapter {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('invalid_repo');
  const gh = async (args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync('gh', args, {
      timeout: 30_000,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  };
  const apiJson = async <T>(endpoint: string): Promise<T> => JSON.parse(await gh(['api', endpoint])) as T;
  return {
    async listIssues() {
      const rows = await apiJson<GitHubIssue[]>(`repos/${repo}/issues?state=all&per_page=100&sort=updated&direction=desc`);
      return rows.filter((row) => !row.pull_request);
    },
    async comments(issueNumber) {
      return apiJson<GitHubComment[]>(`repos/${repo}/issues/${issueNumber}/comments?per_page=100`);
    },
    async comment(issueNumber, body) {
      await gh(['api', '-X', 'POST', `repos/${repo}/issues/${issueNumber}/comments`, '-f', `body=${body}`]);
    },
    async close(issueNumber) {
      await gh(['api', '-X', 'PATCH', `repos/${repo}/issues/${issueNumber}`, '-f', 'state=closed']);
    },
    async create(title, body) {
      const created = await apiJson<{ html_url?: string }>(`repos/${repo}/issues` + `?__unused=1`).catch(() => null);
      void created;
      const raw = await gh(['api', '-X', 'POST', `repos/${repo}/issues`, '-f', `title=${title}`, '-f', `body=${body}`]);
      const parsed = JSON.parse(raw) as { html_url?: string };
      if (!parsed.html_url) throw new Error('github_issue_create_failed');
      return parsed.html_url;
    },
  };
}

async function defaultUpdaterState(): Promise<UpdaterState> {
  const statePath = process.env.TIGERIQ_UPDATER_STATE ?? 'F:\\TigerIQ\\CommandCenter\\updater-v3-state.json';
  const currentPath = process.env.TIGERIQ_CURRENT_RELEASE ?? 'F:\\TigerIQ\\CommandCenter\\current-release.txt';
  let raw: Record<string, unknown> = {};
  let installedSha: string | null = null;
  try { raw = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>; } catch {}
  try {
    const current = (await readFile(currentPath, 'utf8')).trim();
    const leaf = current.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
    if (/^[0-9a-f]{40}$/i.test(leaf)) installedSha = leaf;
  } catch {}
  if (!installedSha && typeof raw.installedSha === 'string') installedSha = raw.installedSha;
  return {
    result: typeof raw.result === 'string' ? raw.result : 'CHƯA CÓ DỮ LIỆU',
    installedSha,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    error: typeof raw.error === 'string' ? raw.error : null,
    runId: typeof raw.runId === 'string' || typeof raw.runId === 'number' ? String(raw.runId) : null,
  };
}

function stateClass(value: string): string {
  if (['verified', 'completed', 'idle'].includes(value)) return 'ok';
  if (['failed', 'offline'].includes(value)) return 'bad';
  if (['blocked', 'degraded'].includes(value)) return 'wait';
  if (['running', 'busy', 'assigned', 'queued', 'approved'].includes(value)) return 'run';
  return 'muted';
}

function stateLabel(value: string): string {
  const map: Record<string, string> = {
    draft: 'Việc mới', approved: 'Đã duyệt', running: 'Đang làm', failed: 'Lỗi', blocked: 'Đang vướng', verified: 'Hoàn thành',
    queued: 'Đang chờ', assigned: 'Đã giao', completed: 'Hoàn thành', busy: 'Đang bận', idle: 'Đang rảnh', offline: 'Mất kết nối', degraded: 'Cần kiểm tra',
  };
  return map[value] ?? value;
}

function icon(name: string): string {
  const paths: Record<string, string> = {
    tiger: '<path d="M5 8 4 4l4 2.2A8 8 0 0 1 12 5a8 8 0 0 1 4 1.2L20 4l-1 4v4c0 5-3 8-7 9-4-1-7-4-7-9V8Z"/><path d="M8 10h2M14 10h2M9 14c1.8 1.5 4.2 1.5 6 0M12 8v4M9 7l1.5 2M15 7l-1.5 2"/>',
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    tasks: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="m9 10 1.5 1.5L14 8"/><path d="M9 16h6"/>',
    users: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20c.5-4 2.5-6 5.5-6s5 2 5.5 6"/><path d="M14 15c3.5-.5 5.5 1 6.5 4"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 2.8A3.2 3.2 0 0 0 7 14v2a3 3 0 0 0 3 3"/><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 2.8A3.2 3.2 0 0 1 17 14v2a3 3 0 0 1-3 3"/><path d="M12 4v16"/>',
    shield: '<path d="M12 3 20 6v5c0 5-3.2 8.4-8 10-4.8-1.6-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 5 5"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12 4 4L19 6"/>', refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M18 12a6 6 0 0 0-10-4L5 11M6 12a6 6 0 0 0 10 4l3-3"/>',
  };
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.home}</svg>`;
}

function translateRole(value: string): string {
  const map: Record<string, string> = { 'ai chief of staff': 'Trợ lý điều hành AI', 'code & script': 'Lập trình & tự động hóa', analysis: 'Phân tích', review: 'Rà soát', judge: 'Kiểm định', builder: 'Xây dựng' };
  return map[value.trim().toLowerCase()] ?? value;
}

function translateDepartment(value: string): string {
  const map: Record<string, string> = { engineering: 'Kỹ thuật', research: 'Nghiên cứu', operations: 'Vận hành', operation: 'Vận hành', executive: 'Điều hành', governance: 'Quản trị', finance: 'Tài chính', sales: 'Kinh doanh', product: 'Sản phẩm', marketing: 'Tiếp thị' };
  return map[value.trim().toLowerCase()] ?? value;
}

function syntheticVy(summary: DashboardSummary): WorkforceEmployeeTelemetry {
  const active = summary.workOrders.filter((item) => item.status !== 'verified');
  return { employeeId: 'vy-chief-of-staff', displayName: 'Vy', department: 'Điều hành', role: 'Trợ lý điều hành AI', nodeId: 'web-control', provider: 'TigerIQ', model: null, availability: active.length ? 'busy' : 'idle', healthScore: 100, concurrencyLimit: 99, activeTaskCount: active.length, currentTaskIds: active.map((item) => item.id) };
}

function taskFor(id: string, telemetry: ServerTelemetry) { return telemetry.workforce?.taskList?.find((task) => task.taskId === id || task.taskId.includes(id)); }
function ownerFor(id: string, telemetry: ServerTelemetry): string { const task = taskFor(id, telemetry); if (!task?.assignedEmployeeId) return 'Vy'; return telemetry.workforce?.roster?.find((employee) => employee.employeeId === task.assignedEmployeeId)?.displayName ?? task.assignedEmployeeId; }
function taskTitle(item: DashboardWorkOrder): string {
  const id = item.id.toUpperCase();
  if (id.includes('UPDATER-AUDIT')) return 'Kiểm tra bộ cập nhật tự động PC01';
  if (id.includes('UPDATER')) return 'Cập nhật tự động Web Control trên PC01';
  if (id.includes('WORKFORCE')) return 'Kiểm tra đội AI và bộ điều phối';
  if (id.includes('OLLAMA')) return 'Kiểm tra các mô hình AI cục bộ';
  if (id.includes('WORKER')) return 'Kiểm tra bộ thực thi PC01';
  if (id.includes('COMMAND-CENTER')) return 'Xác minh Bảng điều hành TigerIQ';
  if (id.includes('E2E')) return 'Kiểm tra toàn tuyến Web đến PC01';
  if (id.includes('VERIFY')) return 'Xác minh trạng thái hệ thống';
  const normalized = item.goal.replace(/\s+/g, ' ').trim();
  if (/[À-ỹ]/.test(normalized)) return normalized.length > 100 ? `${normalized.slice(0, 97)}…` : normalized;
  return `Công việc kỹ thuật ${item.id}`;
}

function progressFor(status: string): number { if (status === 'verified' || status === 'completed') return 100; if (status === 'failed') return 30; if (status === 'blocked') return 45; if (status === 'running' || status === 'busy') return 68; if (status === 'approved' || status === 'assigned') return 38; if (status === 'queued') return 18; return 12; }
function needsOwnerDecision(item: DashboardWorkOrder): boolean {
  const needsAttention = item.status === 'blocked' || item.latestGateStatus === 'fail' || item.latestGateStatus === 'blocked';
  if (!needsAttention) return false;
  const text = `${item.id} ${item.goal}`.toLocaleLowerCase('vi-VN');
  return /(anh sơn|owner\b|chủ sở hữu|quyết định|phê duyệt|duyệt|authorize|authorization|approval|approve|permission)/i.test(text);
}
function isTechnicalProblem(item: DashboardWorkOrder): boolean { return item.status === 'failed' || item.status === 'blocked' || item.latestGateStatus === 'fail' || item.latestGateStatus === 'blocked'; }

function formatTime(value: string | null | undefined): string {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('vi-VN', { hour12: false }) : value;
}

function markerLabel(body: string): string {
  const first = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? 'Ghi chú';
  const map: Record<string, string> = {
    TIGERIQ_PC01_CLAIMED: 'PC01 đã nhận việc', TIGERIQ_JOB_CLAIMED: 'PC01 đã nhận việc', TIGERIQ_PC01_DONE: 'PC01 đã hoàn thành', TIGERIQ_JOB_DONE: 'Đã hoàn thành', TIGERIQ_PC01_RESULT: 'Kết quả PC01', TIGERIQ_JOB_RESULT: 'Kết quả', TIGERIQ_PC01_FAILED: 'PC01 báo lỗi', TIGERIQ_JOB_FAILED: 'Công việc lỗi', TIGERIQ_PC01_NEEDS_EXTERNAL_REVIEW: 'Cần quyết định bên ngoài', TIGERIQ_OWNER_DECISION_V1: 'Quyết định của anh Sơn',
  };
  return map[first] ?? first.replaceAll('_', ' ');
}

async function renderPage(summary: DashboardSummary, telemetry: ServerTelemetry, backendHtml: string, url: URL, github: GithubControlAdapter, updater: UpdaterState): Promise<string> {
  const csrf = backendHtml.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
  const loginNeeded = backendHtml.includes('name="secret"');
  const q = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('vi-VN');
  const activeAll = summary.workOrders.filter((item) => item.status !== 'verified');
  const active = activeAll.filter((item) => !q || `${item.id} ${item.project} ${item.goal}`.toLocaleLowerCase('vi-VN').includes(q));
  const done = summary.workOrders.filter((item) => item.status === 'verified').length;
  const ownerNeeds = summary.workOrders.filter(needsOwnerDecision);
  const problems = summary.workOrders.filter(isTechnicalProblem).length;
  const roster = telemetry.workforce?.roster ?? [];
  const allAi = [syntheticVy(summary), ...roster.filter((employee) => employee.employeeId !== 'vy-chief-of-staff')];
  const filteredAi = allAi.filter((employee) => !q || `${employee.displayName} ${employee.role} ${employee.department} ${employee.model ?? ''} ${employee.provider ?? ''}`.toLocaleLowerCase('vi-VN').includes(q));
  const models = (telemetry.ollama?.models ?? []).filter((model) => !q || model.toLocaleLowerCase('vi-VN').includes(q));
  const systemOk = Boolean(telemetry.available && telemetry.worker?.online && telemetry.ollama?.online && telemetry.tailscale?.online);
  const notice = (url.searchParams.get('notice') ?? '').slice(0, 300);
  const selectedId = (url.searchParams.get('work') ?? '').slice(0, 160);
  let selectedIssue: GitHubIssue | null = null;
  let selectedComments: GitHubComment[] = [];
  if (selectedId) {
    try {
      const issues = await github.listIssues();
      selectedIssue = issues.find((issue) => issueWorkOrderId(issue) === selectedId || `WO-GH-${issue.number}` === selectedId || issue.title.includes(`[${selectedId}]`)) ?? null;
      if (selectedIssue) selectedComments = await github.comments(selectedIssue.number);
    } catch {}
  }

  const command = csrf ? `<form class="assign" method="post" action="/jobs"><div><b>Giao việc cho Vy</b><span>Anh nhập mục tiêu, TigerIQ tự đưa vào hàng đợi PC01.</span></div><textarea name="instruction" maxlength="8000" required placeholder="Nhập mục tiêu cần TigerIQ thực hiện..."></textarea><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="idempotency" value="v5-${Date.now()}-${randomBytes(8).toString('hex')}"><select name="priority"><option>Bình thường</option><option>Cao</option><option>Khẩn cấp</option><option>Thấp</option></select><button type="submit">${icon('plus')} Giao việc</button></form>` : loginNeeded ? `<form class="login" method="post" action="/login"><div><b>Quyền điều khiển</b><span>Đăng nhập để giao việc và ra quyết định.</span></div><input type="password" name="secret" placeholder="Mã điều khiển nội bộ" required><button type="submit">Đăng nhập</button></form>` : `<div class="notice warn">Đang ở chế độ chỉ xem.</div>`;

  const workRows = active.length ? active.slice(0, 20).map((item) => { const stage = taskFor(item.id, telemetry)?.stage ?? item.status; const progress = progressFor(stage); const owner = ownerFor(item.id, telemetry); return `<a class="work-row" href="/?work=${encodeURIComponent(item.id)}${q ? `&q=${encodeURIComponent(q)}` : ''}#chi-tiet"><div><b>${esc(taskTitle(item))}</b><span>${esc(item.id)} · ${esc(item.project)}</span></div><div class="who"><i>${esc(owner.slice(0, 2).toUpperCase())}</i>${esc(owner)}</div><div class="progress"><em><i style="width:${progress}%"></i></em><span>${progress}% <small>ước lượng</small></span></div><span class="badge ${stateClass(stage)}">${esc(stateLabel(stage))}</span></a>`; }).join('') : `<div class="empty">${q ? 'Không tìm thấy công việc phù hợp.' : 'Chưa có công việc đang chạy.'}</div>`;

  const ownerCards = ownerNeeds.length ? ownerNeeds.slice(0, 8).map((item) => `<a class="need-item" href="/?work=${encodeURIComponent(item.id)}#chi-tiet"><div><b>${esc(taskTitle(item))}</b><span>Cần anh quyết định hoặc phê duyệt</span></div><span class="badge wait">Cần xem</span></a>`).join('') : `<div class="all-good">${icon('check')}<div><b>Không có việc cần anh Sơn</b><span>Lỗi kỹ thuật được theo dõi riêng.</span></div></div>`;

  const aiRows = filteredAi.length ? filteredAi.map((employee) => { const current = employee.currentTaskIds.length ? employee.currentTaskIds.slice(0, 2).map((id) => summary.workOrders.find((item) => item.id === id)).filter(Boolean).map((item) => taskTitle(item as DashboardWorkOrder)).join(' · ') : 'Đang rảnh'; return `<div class="ai-row"><div><i class="avatar">${esc(employee.displayName.slice(0, 2).toUpperCase())}</i><span><b>${esc(employee.displayName)}</b><small>${esc(translateRole(employee.role))}</small></span></div><span><b>${esc(employee.model ?? 'Chưa gán mô hình')}</b><small>${esc(translateDepartment(employee.department))}</small></span><span><b>${esc(current)}</b><small>${employee.activeTaskCount ? `${employee.activeTaskCount} việc đang xử lý` : 'Không có việc đang chạy'}</small></span><span class="badge ${stateClass(employee.availability)}">${esc(stateLabel(employee.availability))}</span><span>${employee.activeTaskCount}/${employee.concurrencyLimit}</span></div>`; }).join('') : `<div class="empty">Không tìm thấy AI phù hợp.</div>`;

  const modelRows = models.length ? models.map((model) => { const users = roster.filter((employee) => employee.model?.toLowerCase() === model.toLowerCase()).map((employee) => employee.displayName); return `<div class="model-item">${icon('brain')}<div><b>${esc(model)}</b><span>${users.length ? `Đang dùng: ${esc(users.join(', '))}` : 'Chưa gán cho AI nào'}</span></div><i class="${telemetry.ollama?.online ? 'on' : 'off'}"></i></div>`; }).join('') : `<div class="empty">${q ? 'Không tìm thấy mô hình phù hợp.' : 'Chưa đọc được danh sách mô hình.'}</div>`;

  const selectedWork = selectedId ? summary.workOrders.find((item) => item.id === selectedId) ?? null : null;
  const detail = selectedId ? `<section class="panel detail" id="chi-tiet"><div class="panel-head"><h2>Chi tiết công việc</h2><a href="/#cong-viec">Đóng</a></div>${selectedWork ? `<div class="detail-grid"><div><label>Công việc</label><b>${esc(taskTitle(selectedWork))}</b><small>${esc(selectedWork.id)} · ${esc(selectedWork.project)}</small></div><div><label>Trạng thái</label><span class="badge ${stateClass(selectedWork.status)}">${esc(stateLabel(selectedWork.status))}</span></div><div><label>Phụ trách</label><b>${esc(ownerFor(selectedWork.id, telemetry))}</b></div><div><label>Bằng chứng</label><b>${selectedWork.evidenceCount}</b></div></div><div class="goal"><label>Mục tiêu gốc</label><p>${esc(selectedWork.goal)}</p></div>` : `<div class="empty">Không còn tìm thấy Work Order này trong state hiện tại.</div>`}${selectedIssue ? `<div class="source"><b>Nguồn GitHub #${selectedIssue.number}</b><a href="${esc(selectedIssue.html_url)}">Mở nguồn</a><span>Trạng thái nguồn: ${esc(selectedIssue.state)}</span></div><div class="evidence-list"><h3>Lifecycle / bằng chứng thực tế</h3>${selectedComments.length ? selectedComments.slice(-12).reverse().map((comment) => `<article><b>${esc(markerLabel(String(comment.body ?? '')))}</b><time>${esc(formatTime(comment.updated_at || comment.created_at))}</time><p>${esc(String(comment.body ?? '').slice(0, 1200))}</p><a href="${esc(comment.html_url)}">Mở bằng chứng</a></article>`).join('') : '<div class="empty">Issue chưa có comment lifecycle/evidence.</div>'}</div>` : `<div class="empty">Chưa xác định được GitHub issue nguồn; các hành động ghi sẽ bị khóa.</div>`}${selectedWork && needsOwnerDecision(selectedWork) && selectedIssue ? `<div class="decision-box"><h3>Quyết định của anh Sơn</h3>${csrf ? `<form method="post" action="/decision"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="workOrderId" value="${esc(selectedWork.id)}"><input type="hidden" name="idempotency" value="decision-${randomBytes(12).toString('hex')}"><button name="decision" value="approve" class="approve">Duyệt & tiếp tục</button><button name="decision" value="defer" class="defer">Để sau</button><button name="decision" value="reject" class="reject">Từ chối & đóng việc</button></form>` : '<p>Đăng nhập quyền điều khiển để ra quyết định.</p>'}</div>` : ''}</section>` : '';

  const services = [['PC01', telemetry.available, telemetry.available ? 'Đang hoạt động' : 'Chưa có dữ liệu'], ['Bộ thực thi PC01', telemetry.worker?.online, telemetry.worker?.pid ? `PID ${telemetry.worker.pid}` : ''], ['Mô hình AI cục bộ', telemetry.ollama?.online, `${telemetry.ollama?.models?.length ?? 0} mô hình`], ['Mạng riêng Tailscale', telemetry.tailscale?.online, telemetry.tailscale?.ip ?? ''], ['Bộ điều phối', telemetry.controller?.online, telemetry.controller?.port ? `Cổng ${telemetry.controller.port}` : ''], ['Cơ sở dữ liệu', telemetry.postgresql?.online, telemetry.postgresql?.service ?? '']].map(([name, ok, note]) => `<div class="service"><i class="${ok ? 'on' : 'off'}"></i><div><b>${esc(name)}</b><span>${esc(note || (ok ? 'Hoạt động' : 'Ngắt kết nối'))}</span></div></div>`).join('');

  const total = summary.workOrders.length;
  const completion = total ? Math.round((done / total) * 100) : 0;
  const p0 = summary.workOrders.find((item) => isTechnicalProblem(item));
  const current = summary.workOrders.find((item) => item.status === 'running') ?? activeAll[0];
  const next = ownerNeeds[0] ? `Anh Sơn quyết định: ${taskTitle(ownerNeeds[0])}` : current ? `Hoàn tất: ${taskTitle(current)}` : 'Không có việc đang chờ';
  const report = `<div class="report-grid"><article><span>1. Tổng tiến độ</span><b>${completion}%</b><small>${done}/${total} công việc đã hoàn thành</small></article><article><span>2. Hạng mục chính</span><b>${activeAll.length} đang xử lý</b><small>${problems} lỗi/đang vướng</small></article><article><span>3. P0 Vướng mắc</span><b>${esc(p0 ? taskTitle(p0) : 'Không có')}</b><small>${p0 ? esc(stateLabel(p0.status)) : 'Không ghi nhận vướng mắc'}</small></article><article><span>4. Đang xử lý</span><b>${esc(current ? taskTitle(current) : 'Không có')}</b><small>${current ? esc(stateLabel(current.status)) : 'Đang rảnh'}</small></article><article><span>5. Nhân sự AI</span><b>${telemetry.workforce?.busy ?? 0} đang bận · ${telemetry.workforce?.idle ?? 0} rảnh</b><small>${telemetry.workforce?.offline ?? 0} mất kết nối</small></article><article><span>6. Mốc kế tiếp</span><b>${esc(next)}</b><small>Dựa trên state hiện tại</small></article></div>`;

  const updaterGood = ['UPDATED', 'NO_CHANGE'].includes(updater.result);
  const systemAction = csrf ? `<form method="post" action="/system-action" class="system-actions"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="idempotency" value="sys-${randomBytes(12).toString('hex')}"><button name="action" value="system-status">${icon('refresh')} Kiểm tra lại PC01</button><button name="action" value="ollama-status">${icon('brain')} Kiểm tra Ollama</button></form>` : '<span class="muted-note">Đăng nhập để gửi kiểm tra deterministic.</span>';

  const refreshMeta = csrf ? '' : '<meta http-equiv="refresh" content="30">';
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${refreshMeta}<title>TigerIQ — Bảng điều hành</title><style>
:root{font-family:"Segoe UI Variable","Segoe UI",Arial,sans-serif;--bg:#071019;--side:#08131e;--panel:#0d1824;--panel2:#101e2c;--line:#203246;--text:#f4f7fa;--muted:#8ea0b2;--orange:#ff9b21;--green:#35d990;--blue:#55aaff;--yellow:#ffc45e;--red:#ff6375}*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5}button,input,select,textarea{font:inherit}a{color:inherit;text-decoration:none}.ico{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.shell{min-height:100vh;display:grid;grid-template-columns:236px minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;background:var(--side);border-right:1px solid var(--line);padding:18px 14px;display:flex;flex-direction:column}.brand{display:flex;gap:10px;align-items:center;padding:0 8px 16px;border-bottom:1px solid #17283a}.mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(145deg,#ffb044,#ff7d00);display:grid;place-items:center;color:#111}.mark .ico{width:24px;height:24px}.brand b{font-size:16px}.brand b span{color:var(--orange)}.brand small{display:block;color:var(--muted)}.nav{display:grid;gap:5px;margin-top:18px}.nav a{display:flex;align-items:center;gap:11px;padding:10px 11px;border-radius:10px;color:#94a6b8;font-weight:600}.nav a:hover,.nav a:first-child{background:#112235;color:#fff}.nav a:first-child{box-shadow:inset 3px 0 0 var(--orange)}.foot{margin-top:auto;padding:12px 8px;border-top:1px solid #17283a;color:#a7b7c6}.foot i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:8px}.foot i.warn{background:var(--yellow)}.content{min-width:0;padding:18px 22px 36px}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:14px}.top h1{margin:0;font-size:24px}.top p{margin:4px 0 0;color:var(--muted)}.search{display:flex;align-items:center;gap:8px;background:#0a1621;border:1px solid var(--line);border-radius:10px;padding:8px 10px}.search input{width:240px;background:transparent;border:0;outline:0;color:#fff}.assign,.login,.notice{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:14px;margin-bottom:14px}.assign{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(0,1.6fr) 120px 108px;gap:10px;align-items:center}.assign div b,.assign div span,.login div b,.login div span{display:block}.assign div span,.login div span{color:var(--muted);font-size:12px}.assign textarea{min-height:46px;resize:vertical;background:#07131e;border:1px solid #2c4054;border-radius:9px;color:#fff;padding:10px}.assign select,.login input{background:#07131e;border:1px solid #2c4054;border-radius:9px;color:#fff;padding:9px}.assign button,.login button,.system-actions button,.decision-box button{border:0;border-radius:9px;padding:9px 11px;font-weight:800;cursor:pointer}.assign button,.login button{background:var(--orange);color:#16100a}.login{display:flex;align-items:center;gap:10px}.login div{margin-right:auto}.notice.success{border-color:#28563f;background:#0c2118;color:#9cebc0}.notice.warn{color:var(--yellow)}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 15px}.kpi span{color:var(--muted);font-size:12px}.kpi strong{display:block;font-size:26px}.kpi.blue strong{color:var(--blue)}.kpi.yellow strong{color:var(--yellow)}.kpi.green strong{color:var(--green)}.kpi.red strong{color:var(--red)}.grid-main{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(300px,.72fr);gap:12px;margin-bottom:14px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:14px}.panel-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid var(--line)}.panel-head h2{font-size:15px;margin:0}.panel-head span,.panel-head a{color:var(--muted);font-size:12px}.work-head,.work-row{display:grid;grid-template-columns:minmax(260px,1.8fr) 140px minmax(150px,.8fr) 115px;gap:12px;align-items:center}.work-head{padding:9px 14px;background:#0a1520;color:#7f92a5;font-size:12px}.work-row{padding:12px 14px;border-top:1px solid #192b3b}.work-row:hover{background:#0f1d2a}.work-row>div:first-child b,.work-row>div:first-child span{display:block}.work-row>div:first-child span{color:var(--muted);font-size:12px}.who{display:flex;gap:8px;align-items:center}.who i,.avatar{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#17314a;color:#9fd0ff;font-size:10px;font-style:normal;font-weight:800}.progress{display:flex;gap:8px;align-items:center}.progress em{height:6px;flex:1;background:#17283a;border-radius:99px;overflow:hidden}.progress em i{display:block;height:100%;background:var(--blue)}.progress span{font-size:12px;color:var(--muted);white-space:nowrap}.progress small{display:block;font-size:10px}.badge{display:inline-flex;align-items:center;justify-content:center;border:1px solid #33485c;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:700;white-space:nowrap}.badge.ok{color:#7ce8ae;border-color:#2b6a4b;background:#0d251a}.badge.run{color:#91c9ff;border-color:#2b5f8d;background:#0d2032}.badge.wait{color:#ffd17d;border-color:#6a5229;background:#2b2110}.badge.bad{color:#ff9aa6;border-color:#6c3640;background:#2b1519}.need-list{padding:10px}.need-item{display:flex;justify-content:space-between;gap:10px;padding:11px;border:1px solid #4e3d25;background:#1a160f;border-radius:10px;margin-bottom:8px}.need-item b,.need-item div span{display:block}.need-item div span{color:#a99579;font-size:12px}.all-good{display:flex;gap:10px;align-items:center;padding:14px;color:#85e9b2}.all-good span{display:block;color:#82a992;font-size:12px}.ai-head,.ai-row{display:grid;grid-template-columns:minmax(190px,1.1fr) minmax(180px,.9fr) minmax(260px,1.5fr) 110px 55px;gap:12px;align-items:center}.ai-head{padding:9px 14px;background:#0a1520;color:#7f92a5;font-size:12px}.ai-row{padding:11px 14px;border-top:1px solid #192b3b}.ai-row>div{display:flex;gap:9px;align-items:center}.ai-row b,.ai-row small{display:block}.ai-row small{color:var(--muted)}.model-list,.service-list{padding:10px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.model-item,.service{display:flex;align-items:center;gap:9px;border:1px solid #203447;background:#091621;border-radius:9px;padding:10px}.model-item>div,.service>div{min-width:0;flex:1}.model-item b,.model-item span,.service b,.service span{display:block}.model-item span,.service span{color:var(--muted);font-size:12px}.model-item>i,.service>i{width:8px;height:8px;border-radius:50%;background:var(--red)}.model-item>i.on,.service>i.on{background:var(--green)}.detail{scroll-margin-top:12px}.detail-grid{display:grid;grid-template-columns:2fr 1fr 1fr .6fr;gap:10px;padding:14px}.detail-grid>div,.goal,.source,.decision-box{border:1px solid #203447;background:#091621;border-radius:9px;padding:11px}.detail label{display:block;color:var(--muted);font-size:11px;margin-bottom:5px}.detail small{display:block;color:var(--muted);margin-top:3px}.goal,.source,.decision-box{margin:0 14px 12px}.goal p{white-space:pre-wrap;margin:4px 0 0}.source{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.source a{color:#8dc7ff}.source span{color:var(--muted)}.evidence-list{padding:0 14px 14px}.evidence-list h3,.decision-box h3{font-size:14px}.evidence-list article{border-top:1px solid #203447;padding:10px 0}.evidence-list article:first-of-type{border-top:0}.evidence-list time{color:var(--muted);font-size:11px;margin-left:8px}.evidence-list p{white-space:pre-wrap;color:#b7c4cf;max-height:130px;overflow:auto}.evidence-list a{color:#8dc7ff;font-size:12px}.decision-box form{display:flex;gap:8px;flex-wrap:wrap}.decision-box .approve{background:#1e7d50;color:#fff}.decision-box .defer{background:#6a5229;color:#fff}.decision-box .reject{background:#7a2b38;color:#fff}.report-grid{padding:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.report-grid article{border:1px solid #203447;background:#091621;border-radius:9px;padding:11px}.report-grid span,.report-grid b,.report-grid small{display:block}.report-grid span,.report-grid small{color:var(--muted);font-size:12px}.report-grid b{margin:4px 0}.settings{padding:10px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.setting{border:1px solid #203447;background:#091621;border-radius:9px;padding:11px}.setting span,.setting b,.setting small{display:block}.setting span,.setting small{color:var(--muted);font-size:12px}.system-actions{padding:0 10px 10px;display:flex;gap:8px}.system-actions button{display:inline-flex;gap:7px;align-items:center;background:#16314a;color:#b8dcff}.muted-note,.empty{color:var(--muted)}.muted-note{display:block;padding:0 10px 10px}.empty{padding:22px;text-align:center}@media(max-width:1100px){.shell{grid-template-columns:82px 1fr}.brand div:last-child,.nav span,.foot span{display:none}.nav a{justify-content:center}.grid-main{grid-template-columns:1fr}.assign{grid-template-columns:1fr}.detail-grid{grid-template-columns:1fr 1fr}.report-grid{grid-template-columns:1fr 1fr}}@media(max-width:760px){.shell{display:block}.sidebar{position:sticky;z-index:20;width:100%;height:auto;flex-direction:row;padding:8px 10px;border-right:0;border-bottom:1px solid var(--line)}.brand{border:0;padding:0;margin-right:8px}.nav{display:flex;margin:0;overflow:auto}.nav a{padding:8px}.foot{display:none}.content{padding:12px}.top{align-items:flex-start}.top h1{font-size:20px}.search input{width:140px}.assign{grid-template-columns:1fr 110px}.assign div,.assign textarea{grid-column:1/-1}.kpis{grid-template-columns:repeat(2,1fr)}.work-head{display:none}.work-row{grid-template-columns:1fr auto}.work-row .who,.work-row .progress{grid-column:1/-1}.ai-head{display:none}.ai-row{grid-template-columns:1fr auto}.ai-row>span:nth-of-type(1),.ai-row>span:nth-of-type(2){grid-column:1/-1}.model-list,.service-list,.report-grid,.settings,.detail-grid{grid-template-columns:1fr}.login{flex-wrap:wrap}.login div{width:100%}}
</style></head><body><div class="shell"><aside class="sidebar"><a class="brand" href="#tong-quan"><div class="mark">${icon('tiger')}</div><div><b><span>TigerIQ</span> AI Lab</b><small>Bảng điều hành</small></div></a><nav class="nav"><a href="#tong-quan">${icon('home')}<span>Tổng quan</span></a><a href="#cong-viec">${icon('tasks')}<span>Công việc</span></a><a href="#doi-ai">${icon('users')}<span>Đội AI</span></a><a href="#mo-hinh">${icon('brain')}<span>Mô hình AI</span></a><a href="#bang-chung">${icon('shield')}<span>Bằng chứng</span></a><a href="#bao-cao">${icon('chart')}<span>Báo cáo</span></a><a href="#he-thong">${icon('server')}<span>Hệ thống</span></a><a href="#cai-dat">${icon('settings')}<span>Cài đặt</span></a></nav><div class="foot"><i class="${systemOk ? '' : 'warn'}"></i><span>${systemOk ? 'PC01 đang hoạt động' : 'Có hạng mục cần kiểm tra'}</span></div></aside><main class="content" id="tong-quan"><header class="top"><div><h1>Xin chào anh Sơn</h1><p>Đây là tình hình TigerIQ hiện tại.</p></div><form class="search" method="get">${icon('search')}<input name="q" value="${esc(url.searchParams.get('q') ?? '')}" placeholder="Tìm công việc, AI, mô hình..."></form></header>${notice ? `<div class="notice success">${esc(notice)}</div>` : ''}${command}<section class="kpis"><article class="kpi blue"><span>Đang xử lý</span><strong>${activeAll.length}</strong></article><article class="kpi yellow"><span>Chờ anh quyết định</span><strong>${ownerNeeds.length}</strong></article><article class="kpi green"><span>Đã hoàn thành</span><strong>${done}</strong></article><article class="kpi red"><span>Lỗi / đang vướng</span><strong>${problems}</strong></article></section><section class="grid-main" id="cong-viec"><div class="panel"><div class="panel-head"><h2>Công việc đang xử lý</h2><span>${active.length}${q ? ` / ${activeAll.length}` : ''} việc</span></div><div class="work-head"><span>Công việc</span><span>Phụ trách</span><span>Tiến độ</span><span>Trạng thái</span></div>${workRows}</div><aside class="panel"><div class="panel-head"><h2>Cần anh Sơn</h2><span>Chỉ việc cần quyết định</span></div><div class="need-list">${ownerCards}</div></aside></section>${detail}<section class="panel" id="doi-ai"><div class="panel-head"><h2>Đội AI đang làm gì</h2><span>${filteredAi.length} AI</span></div><div class="ai-head"><span>AI / vai trò</span><span>Mô hình / nhóm</span><span>Đang làm</span><span>Trạng thái</span><span>Tải</span></div>${aiRows}<div class="muted-note">Điều chuyển AI / đổi model: Chưa khả dụng vì chưa có deterministic allowlist tương ứng. Không tạo nút giả.</div></section><section class="panel" id="mo-hinh"><div class="panel-head"><h2>Mô hình AI</h2><span>${models.length} mô hình</span></div><div class="model-list">${modelRows}</div></section><section class="panel" id="bang-chung"><div class="panel-head"><h2>Bằng chứng & kiểm tra</h2><span>${summary.evidenceCount} bằng chứng</span></div><div class="empty">Chọn một Công việc để xem lifecycle, marker, thời gian và link bằng chứng thực tế.</div></section><section class="panel" id="bao-cao"><div class="panel-head"><h2>Báo cáo vận hành</h2><span>Dữ liệu hiện tại</span></div>${report}</section><section class="panel" id="he-thong"><div class="panel-head"><h2>Trạng thái hệ thống PC01</h2><span>${systemOk ? 'Hoạt động' : 'Cần kiểm tra'}</span></div><div class="service-list">${services}<div class="service"><i class="${updaterGood ? 'on' : 'off'}"></i><div><b>Bộ cập nhật Web Control V3</b><span>${esc(updater.result)} · ${esc(updater.installedSha?.slice(0, 12) ?? 'chưa có SHA')}</span></div></div></div>${systemAction}</section><section class="panel" id="cai-dat"><div class="panel-head"><h2>Cài đặt</h2><span>Chỉ đọc</span></div><div class="settings"><div class="setting"><span>Kênh phát hành</span><b>wo250/command-center-artifact-updater-v3</b><small>Không MAIN/Production/Vercel</small></div><div class="setting"><span>Bản đang cài</span><b>${esc(updater.installedSha?.slice(0, 16) ?? 'Chưa đọc được')}</b><small>${esc(formatTime(updater.updatedAt))}</small></div><div class="setting"><span>Kết quả cập nhật cuối</span><b>${esc(updater.result)}</b><small>${esc(updater.error ?? 'Không có lỗi được ghi nhận')}</small></div><div class="setting"><span>Tự làm mới</span><b>${csrf ? 'Tắt khi đang đăng nhập' : '30 giây'}</b><small>Tránh làm mất nội dung form đang nhập</small></div></div><div class="muted-note">Đổi mã điều khiển, firewall, credential và security policy: không cho phép từ Web Control.</div></section></main></div></body></html>`;
}

export async function startOwnerCockpitV5(options: OwnerCockpitV5Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public bind is forbidden');
  const github = options.github ?? createDefaultGithub(options.repo);
  const updaterReader = options.readUpdaterState ?? defaultUpdaterState;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && (url.pathname === '/api/status' || url.pathname === '/api/server')) return proxy(options.backendUrl, req, res);
      if (req.method === 'POST' && (url.pathname === '/login' || url.pathname === '/jobs')) return proxy(options.backendUrl, req, res);
      if (req.method === 'POST' && url.pathname === '/decision') {
        const form = new URLSearchParams(await readBody(req));
        if (!(await authorizeWrite(options.backendUrl, req, form))) return respond(res, 403, 'application/json; charset=utf-8', JSON.stringify({ error: 'authorization_rejected' }));
        const workOrderId = (form.get('workOrderId') ?? '').trim();
        const decision = (form.get('decision') ?? '').trim();
        const idempotency = (form.get('idempotency') ?? '').trim();
        if (!/^[A-Za-z0-9_-]{8,96}$/.test(idempotency) || !['approve', 'reject', 'defer'].includes(decision) || workOrderId.length < 3 || workOrderId.length > 160) return respond(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'invalid_decision' }));
        const issue = (await github.listIssues()).find((row) => issueWorkOrderId(row) === workOrderId || `WO-GH-${row.number}` === workOrderId || row.title.includes(`[${workOrderId}]`));
        if (!issue) return respond(res, 409, 'application/json; charset=utf-8', JSON.stringify({ error: 'source_issue_not_found' }));
        const comments = await github.comments(issue.number);
        if (comments.some((row) => String(row.body ?? '').includes(`idempotency=${idempotency}`))) return redirect(res, `/?notice=${encodeURIComponent('Quyết định này đã được ghi trước đó.')}&work=${encodeURIComponent(workOrderId)}#chi-tiet`);
        const status = decision === 'approve' ? 'APPROVED' : decision === 'reject' ? 'REJECTED' : 'DEFERRED';
        await github.comment(issue.number, `TIGERIQ_OWNER_DECISION_V1\nworkOrder=${workOrderId}\ndecision=${status}\nidempotency=${idempotency}\nsource=WebControl\ntimestamp=${new Date().toISOString()}`);
        if (decision === 'reject') {
          await github.close(issue.number);
        } else if (decision === 'approve') {
          const resumeId = `WO-RESUME-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`;
          const body = `PC01_REQUIRED=true\nCLOUD_EXECUTOR_ALLOWED=false\n\nTIGERIQ_JOB_V1\n\n## Work Order\n${resumeId}\n\n## Instruction\nAnh Sơn đã DUYỆT tiếp tục ${workOrderId}. Đọc nguồn ${issue.html_url}, tiếp tục phần còn vướng trong phạm vi đã được phê duyệt, giữ nguyên các giới hạn an toàn, và trả evidence cuối.\n\n## Priority\nKhẩn cấp\n\n## Owner Decision\nAPPROVED ${workOrderId}`;
          await github.create(`[Owner Approved][${workOrderId}] Tiếp tục công việc`, body);
        }
        const message = decision === 'approve' ? 'Đã ghi quyết định DUYỆT và tạo việc tiếp tục cho PC01.' : decision === 'reject' ? 'Đã ghi quyết định TỪ CHỐI và đóng issue nguồn.' : 'Đã ghi quyết định ĐỂ SAU; công việc chưa bị thay đổi.';
        return redirect(res, `/?notice=${encodeURIComponent(message)}&work=${encodeURIComponent(workOrderId)}#chi-tiet`);
      }
      if (req.method === 'POST' && url.pathname === '/system-action') {
        const form = new URLSearchParams(await readBody(req));
        if (!(await authorizeWrite(options.backendUrl, req, form))) return respond(res, 403, 'application/json; charset=utf-8', JSON.stringify({ error: 'authorization_rejected' }));
        const action = form.get('action') ?? '';
        const idempotency = (form.get('idempotency') ?? '').trim();
        if (!/^[A-Za-z0-9_-]{8,96}$/.test(idempotency) || !['system-status', 'ollama-status'].includes(action)) return respond(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'invalid_system_action' }));
        const commandAction = action === 'system-status' ? 'system.status' : 'ollama.status';
        const body = `PC01_REQUIRED=true\nCLOUD_EXECUTOR_ALLOWED=false\n\nTIGERIQ_COMMAND_V1\n\`\`\`json\n${JSON.stringify({ idempotency_key: idempotency, action: commandAction, args: {} })}\n\`\`\`\n\nPurpose: Owner-requested bounded read-only check from Web Control. No mutation.`;
        await github.create(`[Web Control][VERIFY] ${action === 'system-status' ? 'Kiểm tra PC01' : 'Kiểm tra Ollama'}`, body);
        return redirect(res, `/?notice=${encodeURIComponent('Đã gửi kiểm tra tới Secure Worker V3. Kết quả sẽ xuất hiện trong Công việc/Bằng chứng.')}#he-thong`);
      }
      if (req.method === 'GET' && url.pathname === '/') {
        const cookieHeaders = req.headers.cookie ? { cookie: req.headers.cookie } : undefined;
        const [summaryResponse, telemetryResponse, backendResponse, updater] = await Promise.all([fetch(`${options.backendUrl}/api/status`), fetch(`${options.backendUrl}/api/server`), fetch(`${options.backendUrl}/`, { headers: cookieHeaders }), updaterReader()]);
        if (!summaryResponse.ok || !telemetryResponse.ok || !backendResponse.ok) throw new Error('backend_unavailable');
        const summary = await summaryResponse.json() as DashboardSummary;
        const telemetry = await telemetryResponse.json() as ServerTelemetry;
        return respond(res, 200, 'text/html; charset=utf-8', await renderPage(summary, telemetry, await backendResponse.text(), url, github, updater));
      }
      return respond(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not_found' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      return respond(res, 503, 'application/json; charset=utf-8', JSON.stringify({ error: 'owner_cockpit_unavailable', detail: message.slice(0, 160) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
