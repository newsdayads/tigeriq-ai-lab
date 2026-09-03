import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { WorkOrderSnapshot } from '../../../packages/control-plane/src/index.js';
import { buildDashboard } from './index.js';

const execFileAsync = promisify(execFile);

export interface DashboardSource {
  list(): WorkOrderSnapshot[] | Promise<WorkOrderSnapshot[]>;
}

export type ServerTelemetry = {
  available: boolean;
  server: string;
  generatedAt: string;
  cpu: { utilizationPercent: number | null } | null;
  memory: { usedBytes: number; totalBytes: number; utilizationPercent: number | null } | null;
  uptimeSeconds: number | null;
  disk: { drive: string; freeBytes: number; totalBytes: number; utilizationPercent: number | null } | null;
  worker: { online: boolean; pid: number | null; instances: number } | null;
  controller: { online: boolean; ip: string | null; port: number | null } | null;
  workforce: { employeesTotal: number; idle: number; busy: number; offline: number; degraded: number; activeTasks: number; tasksActive: number; tasksFailed: number } | null;
  postgresql: { online: boolean; service: string | null; port: number | null } | null;
  ollama: { online: boolean; models: string[] } | null;
  tailscale: { online: boolean; ip: string | null } | null;
  gpu: { name: string; utilizationPercent: number | null; memoryUsedMiB: number | null; memoryTotalMiB: number | null } | null;
};

export interface CommandCenterOptions {
  host?: string;
  port?: number;
  commandSecret?: string;
  repo?: string;
  submitJob?: (instruction: string, priority: string) => Promise<string>;
  serverTelemetry?: () => Promise<ServerTelemetry>;
}

type Session = { csrf: string; createdAt: number };
type IdempotentResult = { fingerprint: string; url: string };

const sessions = new Map<string, Session>();
const submissions = new Map<string, IdempotentResult>();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16_384;
const MAX_INSTRUCTION = 8_000;
const TELEMETRY_TIMEOUT_MS = 4_000;

const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function respond(response: ServerResponse, status: number, contentType: string, body: string, extraHeaders: Record<string, string> = {}): void {
  response.writeHead(status, { ...securityHeaders, ...extraHeaders, 'content-type': contentType });
  response.end(body);
}

function redirect(response: ServerResponse, location: string, extraHeaders: Record<string, string> = {}): void {
  response.writeHead(303, { ...securityHeaders, ...extraHeaders, location });
  response.end();
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  const raw = request.headers.cookie ?? '';
  return Object.fromEntries(raw.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function getSession(request: IncomingMessage): Session | null {
  const id = parseCookies(request).tigeriq_session;
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return session;
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error('payload_too_large');
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function cleanExpiredState(): void {
  const now = Date.now();
  for (const [id, session] of sessions) if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
  if (submissions.size > 500) submissions.clear();
}

async function submitGithubJob(repo: string, instruction: string, priority: string): Promise<string> {
  const title = `[Command Center] ${instruction.replace(/\s+/g, ' ').slice(0, 72)}`;
  const body = `TIGERIQ_JOB_V1\n\n## Instruction\n${instruction}\n\n## Priority\n${priority}`;
  const { stdout } = await execFileAsync('gh', ['issue', 'create', '--repo', repo, '--title', title, '--body', body], {
    timeout: 30_000,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 512 * 1024,
  });
  const url = stdout.trim().split(/\r?\n/).find((line) => /^https:\/\/github\.com\//.test(line));
  if (!url) throw new Error('queue_create_failed');
  return url;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 256 ? value : null;
}
function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function unavailableTelemetry(): ServerTelemetry {
  return {
    available: false,
    server: 'PC01',
    generatedAt: new Date().toISOString(),
    cpu: null,
    memory: null,
    uptimeSeconds: null,
    disk: null,
    worker: null,
    controller: null,
    workforce: null,
    postgresql: null,
    ollama: null,
    tailscale: null,
    gpu: null,
  };
}

function normalizeWorkforce(value: Record<string, unknown> | null): ServerTelemetry['workforce'] {
  if (!value) return null;
  const keys = ['employeesTotal', 'idle', 'busy', 'offline', 'degraded', 'activeTasks', 'tasksActive', 'tasksFailed'] as const;
  const numbers = Object.fromEntries(keys.map((key) => [key, numberOrNull(value[key])])) as Record<(typeof keys)[number], number | null>;
  if (keys.some((key) => numbers[key] === null || numbers[key]! < 0)) return null;
  return {
    employeesTotal: numbers.employeesTotal!,
    idle: numbers.idle!,
    busy: numbers.busy!,
    offline: numbers.offline!,
    degraded: numbers.degraded!,
    activeTasks: numbers.activeTasks!,
    tasksActive: numbers.tasksActive!,
    tasksFailed: numbers.tasksFailed!,
  };
}

function normalizeTelemetry(raw: unknown): ServerTelemetry {
  const data = objectOrNull(raw);
  if (!data) return unavailableTelemetry();
  const cpu = objectOrNull(data.cpu);
  const memory = objectOrNull(data.memory);
  const disk = objectOrNull(data.disk);
  const worker = objectOrNull(data.worker);
  const controller = objectOrNull(data.controller);
  const workforce = normalizeWorkforce(objectOrNull(data.workforce));
  const postgresql = objectOrNull(data.postgresql);
  const ollama = objectOrNull(data.ollama);
  const tailscale = objectOrNull(data.tailscale);
  const gpu = objectOrNull(data.gpu);
  const models = Array.isArray(ollama?.models) ? ollama.models.filter((x): x is string => typeof x === 'string').slice(0, 16).map((x) => x.slice(0, 128)) : [];
  return {
    available: true,
    server: stringOrNull(data.server) ?? 'PC01',
    generatedAt: stringOrNull(data.generatedAt) ?? new Date().toISOString(),
    cpu: cpu ? { utilizationPercent: numberOrNull(cpu.utilizationPercent) } : null,
    memory: memory && numberOrNull(memory.usedBytes) !== null && numberOrNull(memory.totalBytes) !== null ? { usedBytes: numberOrNull(memory.usedBytes)!, totalBytes: numberOrNull(memory.totalBytes)!, utilizationPercent: numberOrNull(memory.utilizationPercent) } : null,
    uptimeSeconds: numberOrNull(data.uptimeSeconds),
    disk: disk && stringOrNull(disk.drive) && numberOrNull(disk.freeBytes) !== null && numberOrNull(disk.totalBytes) !== null ? { drive: stringOrNull(disk.drive)!, freeBytes: numberOrNull(disk.freeBytes)!, totalBytes: numberOrNull(disk.totalBytes)!, utilizationPercent: numberOrNull(disk.utilizationPercent) } : null,
    worker: worker ? { online: worker.online === true, pid: numberOrNull(worker.pid), instances: numberOrNull(worker.instances) ?? 0 } : null,
    controller: controller ? { online: controller.online === true, ip: stringOrNull(controller.ip), port: numberOrNull(controller.port) } : null,
    workforce,
    postgresql: postgresql ? { online: postgresql.online === true, service: stringOrNull(postgresql.service), port: numberOrNull(postgresql.port) } : null,
    ollama: ollama ? { online: ollama.online === true, models } : null,
    tailscale: tailscale ? { online: tailscale.online === true, ip: stringOrNull(tailscale.ip) } : null,
    gpu: gpu && stringOrNull(gpu.name) ? { name: stringOrNull(gpu.name)!, utilizationPercent: numberOrNull(gpu.utilizationPercent), memoryUsedMiB: numberOrNull(gpu.memoryUsedMiB), memoryTotalMiB: numberOrNull(gpu.memoryTotalMiB) } : null,
  };
}

async function collectPc01Telemetry(): Promise<ServerTelemetry> {
  try {
    const repoRoot = process.env.TIGERIQ_REPO_ROOT ?? process.cwd();
    const script = resolve(repoRoot, 'scripts', 'pc-worker', 'pc01-telemetry.ps1');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      timeout: TELEMETRY_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
    });
    return normalizeTelemetry(JSON.parse(stdout.trim()));
  } catch {
    return unavailableTelemetry();
  }
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return false;
  if (octets[0] === 127) return true;
  if (octets[0] === 10) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
  return false;
}

function assertPrivateBind(host: string): void {
  if (host === 'localhost' || host === '::1' || isPrivateIpv4(host)) return;
  throw new Error('public bind is forbidden; use localhost, RFC1918, or an explicit Tailscale address');
}

export async function startDashboard(source: DashboardSource, options: CommandCenterOptions = {}) {
  const host = options.host ?? '127.0.0.1';
  assertPrivateBind(host);
  const repo = options.repo ?? process.env.TIGERIQ_REPO ?? 'newsdayads/tigeriq-ai-lab';
  const commandSecret = options.commandSecret ?? process.env.TIGERIQ_COMMAND_SECRET ?? '';
  const createJob = options.submitJob ?? ((instruction: string, priority: string) => submitGithubJob(repo, instruction, priority));
  const getTelemetry = options.serverTelemetry ?? collectPc01Telemetry;

  const server = createServer(async (request, response) => {
    cleanExpiredState();
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;

    try {
      if (request.method === 'GET' && path === '/api/status') {
        return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(buildDashboard(await source.list())));
      }
      if (request.method === 'GET' && path === '/api/server') {
        return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(await getTelemetry()));
      }
      if (request.method === 'POST' && path === '/login') {
        if (!commandSecret) return respond(response, 503, 'application/json; charset=utf-8', JSON.stringify({ error: 'write_auth_not_configured' }));
        const form = await readForm(request);
        const supplied = form.get('secret') ?? '';
        if (!safeEqual(supplied, commandSecret)) return respond(response, 401, 'text/html; charset=utf-8', renderMessage('Đăng nhập thất bại', 'Mã điều khiển không đúng.'));
        const sessionId = randomBytes(32).toString('base64url');
        sessions.set(sessionId, { csrf: randomBytes(24).toString('base64url'), createdAt: Date.now() });
        return redirect(response, '/', { 'set-cookie': `tigeriq_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
      }
      if (request.method === 'POST' && path === '/jobs') {
        const session = getSession(request);
        if (!commandSecret || !session) return respond(response, 401, 'application/json; charset=utf-8', JSON.stringify({ error: 'unauthorized' }));
        const form = await readForm(request);
        const csrf = form.get('csrf') ?? '';
        if (!safeEqual(csrf, session.csrf)) return respond(response, 403, 'application/json; charset=utf-8', JSON.stringify({ error: 'csrf_rejected' }));
        const instruction = (form.get('instruction') ?? '').trim();
        const priority = (form.get('priority') ?? 'Bình thường').trim();
        const idempotencyKey = (form.get('idempotency') ?? '').trim();
        if (instruction.length < 3 || instruction.length > MAX_INSTRUCTION) return respond(response, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'invalid_instruction' }));
        if (!['Thấp', 'Bình thường', 'Cao', 'Khẩn cấp'].includes(priority)) return respond(response, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'invalid_priority' }));
        if (!/^[A-Za-z0-9_-]{16,96}$/.test(idempotencyKey)) return respond(response, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'invalid_idempotency_key' }));
        const fingerprint = createHash('sha256').update(`${instruction}\n${priority}`).digest('hex');
        const previous = submissions.get(idempotencyKey);
        if (previous) {
          if (previous.fingerprint !== fingerprint) return respond(response, 409, 'application/json; charset=utf-8', JSON.stringify({ error: 'idempotency_conflict' }));
          return redirect(response, `/?submitted=${encodeURIComponent(previous.url)}`);
        }
        const issueUrl = await createJob(instruction, priority);
        submissions.set(idempotencyKey, { fingerprint, url: issueUrl });
        return redirect(response, `/?submitted=${encodeURIComponent(issueUrl)}`);
      }
      if (request.method === 'GET' && path === '/') {
        const summary = buildDashboard(await source.list());
        const telemetry = await getTelemetry();
        const session = getSession(request);
        const submitted = url.searchParams.get('submitted');
        return respond(response, 200, 'text/html; charset=utf-8', render(summary, telemetry, session, Boolean(commandSecret), submitted));
      }
      return respond(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not_found' }));
    } catch {
      return respond(response, 503, 'application/json; charset=utf-8', JSON.stringify({ error: 'command_center_unavailable' }));
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, resolveListen);
  });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())) };
}

function statusText(status: string): string {
  const labels: Record<string, string> = { draft: 'Việc mới', approved: 'Đã lên kế hoạch', running: 'Đang làm', failed: 'Lỗi / Cần sửa', blocked: 'Vướng / Chờ', verified: 'Hoàn thành' };
  return labels[status] ?? status;
}
function pct(value: number | null | undefined): string { return value === null || value === undefined ? '—' : `${Math.round(value)}%`; }
function gb(bytes: number | null | undefined): string { return bytes === null || bytes === undefined ? '—' : `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`; }
function uptime(seconds: number | null): string {
  if (seconds === null) return '—';
  const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); const mins = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${mins}m`;
}
function activityText(summary: ReturnType<typeof buildDashboard>): string {
  const active = summary.workOrders.find((item) => item.status === 'running');
  return active ? `${active.id} · ${statusText(active.status)}` : 'Chưa xác định';
}
function healthText(value: { online: boolean } | null | undefined): string {
  if (!value) return 'Chưa có dữ liệu';
  return value.online ? 'ONLINE' : 'OFFLINE';
}
function healthClass(value: { online: boolean } | null | undefined): string {
  return value?.online ? 'good' : 'wait';
}
function statusClass(status: string): string {
  if (status === 'verified') return 'good';
  if (status === 'failed') return 'danger';
  if (status === 'blocked') return 'wait';
  if (status === 'running') return 'active';
  return 'muted';
}
function boundedPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}
function metricBar(value: number | null | undefined): string {
  const bounded = boundedPercent(value);
  return bounded === null ? '<span class="meter unavailable"><i></i></span>' : `<span class="meter"><i style="width:${bounded}%"></i></span>`;
}
function displayTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { hour12: false });
}

function render(summary: ReturnType<typeof buildDashboard>, telemetry: ServerTelemetry, session: Session | null, writeConfigured: boolean, submitted: string | null): string {
  const workCards = summary.workOrders.map((item) => `<article class="work"><div class="work-top"><div class="work-id"><span class="work-dot ${statusClass(item.status)}"></span><b>${escapeHtml(item.id)}</b></div><span class="status ${statusClass(item.status)}">${escapeHtml(statusText(item.status))}</span></div><h3>${escapeHtml(item.goal)}</h3><div class="meta-row"><span>◈ Gate: ${escapeHtml(item.latestGate ?? 'chưa có')}</span><span class="${statusClass(item.status)}">${escapeHtml(item.latestGateStatus ?? '-')}</span><span>▥ ${item.evidenceCount} evidence</span></div></article>`).join('');
  const submittedNotice = submitted && /^https:\/\/github\.com\//.test(submitted) ? `<div class="notice">✅ Vy đã đưa Work Order vào hàng đợi PC01: <a href="${escapeHtml(submitted)}">xem evidence</a></div>` : '';
  const taskPanel = session ? `<form class="task" method="post" action="/jobs"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="idempotency" value="${randomBytes(24).toString('base64url')}"><div class="task-head"><div><span class="eyebrow">GIAO MỤC TIÊU</span><h2>Vy nhận việc từ anh Sơn</h2><small>Goal → Vy → AI Employee → Review → Evidence</small></div><span class="command-badge">WRITE ENABLED</span></div><textarea name="instruction" maxlength="8000" required placeholder="Nhập mục tiêu cần TigerIQ xử lý…"></textarea><div class="task-actions"><select name="priority" aria-label="Mức ưu tiên"><option>Bình thường</option><option>Cao</option><option>Khẩn cấp</option><option>Thấp</option></select><button type="submit">GIAO VIỆC <span>→</span></button></div></form>` : writeConfigured ? `<form class="login" method="post" action="/login"><div><span class="eyebrow">QUYỀN ĐIỀU KHIỂN</span><b>Mở quyền giao việc cho Vy</b></div><input type="password" name="secret" autocomplete="current-password" placeholder="Mã điều khiển local" required><button type="submit">ĐĂNG NHẬP</button></form>` : `<div class="notice warn">🔒 Chế độ chỉ xem. Cần cấu hình TIGERIQ_COMMAND_SECRET trên PC01 để bật giao việc.</div>`;
  const serverPanel = telemetry.available ? `<div class="server-grid"><div class="metric"><small>CPU</small><b>${pct(telemetry.cpu?.utilizationPercent)}</b>${metricBar(telemetry.cpu?.utilizationPercent)}</div><div class="metric"><small>RAM</small><b>${pct(telemetry.memory?.utilizationPercent)}</b><span>${gb(telemetry.memory?.usedBytes)} / ${gb(telemetry.memory?.totalBytes)}</span>${metricBar(telemetry.memory?.utilizationPercent)}</div><div class="metric"><small>DISK ${escapeHtml(telemetry.disk?.drive ?? '')}</small><b>${pct(telemetry.disk?.utilizationPercent)}</b><span>${gb(telemetry.disk?.freeBytes)} trống</span>${metricBar(telemetry.disk?.utilizationPercent)}</div><div class="metric"><small>UPTIME</small><b>${escapeHtml(uptime(telemetry.uptimeSeconds))}</b><span>${escapeHtml(telemetry.server)}</span></div><div class="service"><div class="service-icon">W</div><div><small>Native Worker</small><b class="${healthClass(telemetry.worker)}">${healthText(telemetry.worker)}</b><span>${telemetry.worker ? `PID ${telemetry.worker.pid ?? '—'} · ${telemetry.worker.instances} instance` : 'Unavailable'}</span></div></div><div class="service"><div class="service-icon">C</div><div><small>Controller</small><b class="${healthClass(telemetry.controller)}">${healthText(telemetry.controller)}</b><span>${escapeHtml(telemetry.controller?.ip ?? '—')}:${telemetry.controller?.port ?? '—'}</span></div></div><div class="service"><div class="service-icon">DB</div><div><small>PostgreSQL</small><b class="${healthClass(telemetry.postgresql)}">${healthText(telemetry.postgresql)}</b><span>${escapeHtml(telemetry.postgresql?.service ?? 'Unavailable')} · ${telemetry.postgresql?.port ?? '—'}</span></div></div><div class="service"><div class="service-icon">AI</div><div><small>Ollama</small><b class="${healthClass(telemetry.ollama)}">${healthText(telemetry.ollama)}</b><span>${escapeHtml(telemetry.ollama?.models.join(', ') || 'Unavailable')}</span></div></div><div class="service"><div class="service-icon">TS</div><div><small>Tailscale</small><b class="${healthClass(telemetry.tailscale)}">${healthText(telemetry.tailscale)}</b><span>${escapeHtml(telemetry.tailscale?.ip ?? 'Unavailable')}</span></div></div><div class="service"><div class="service-icon">GPU</div><div><small>GPU</small><b>${telemetry.gpu ? pct(telemetry.gpu.utilizationPercent) : 'Chưa có dữ liệu'}</b><span>${escapeHtml(telemetry.gpu?.name ?? 'Unavailable')}</span></div></div></div>` : `<div class="notice warn">PC01 Server: Chưa có telemetry. Web vẫn hoạt động ở chế độ an toàn.</div>`;
  const workforceSummary = telemetry.workforce
    ? `<div class="ai-row"><div class="avatar">AI</div><div class="ai-copy"><span>AI Employees</span><small>${telemetry.workforce.employeesTotal} tổng · ${telemetry.workforce.busy} đang làm · ${telemetry.workforce.idle} rảnh</small></div><b>${telemetry.workforce.employeesTotal}</b></div><div class="ai-row"><div class="avatar">WO</div><div class="ai-copy"><span>AI Tasks</span><small>${telemetry.workforce.tasksActive} active · ${telemetry.workforce.tasksFailed} failed · ${telemetry.workforce.activeTasks} assigned</small></div><b>${telemetry.workforce.tasksActive}</b></div>`
    : `<div class="ai-row"><div class="avatar">AI</div><div class="ai-copy"><span>AI Workforce Registry</span><small class="wait">Chưa có dữ liệu runtime</small></div><b>—</b></div>`;
  const workforcePanel = `<div class="ai"><div class="ai-row lead"><div class="avatar tiger">VY</div><div class="ai-copy"><span>Vy — AI Chief of Staff</span><small>Điều phối mục tiêu, Work Order và evidence</small></div><b class="good">ACTIVE</b></div><div class="ai-row"><div class="avatar">PC</div><div class="ai-copy"><span>PC01 Native Worker</span><small>Executor local</small></div><b class="${healthClass(telemetry.worker)}">${healthText(telemetry.worker)}</b></div><div class="ai-row"><div class="avatar">CT</div><div class="ai-copy"><span>Workforce Controller</span><small>Control plane</small></div><b class="${healthClass(telemetry.controller)}">${healthText(telemetry.controller)}</b></div>${workforceSummary}<div class="ai-row"><div class="avatar">LLM</div><div class="ai-copy"><span>Ollama local models</span><small>${escapeHtml(telemetry.ollama?.models.join(', ') || 'Chưa có dữ liệu')}</small></div><b class="${healthClass(telemetry.ollama)}">${healthText(telemetry.ollama)}</b></div></div>`;
  const controllerWarning = telemetry.available && telemetry.controller && !telemetry.controller.online ? `<div class="notice warn">⚠ Workforce Controller đang OFFLINE hoặc health-check không đạt. Command Center vẫn giữ chế độ an toàn.</div>` : '';
  const generatedAt = telemetry.available ? escapeHtml(displayTime(telemetry.generatedAt)) : 'Chưa có telemetry';

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="refresh" content="15"><title>TigerIQ Command Center</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#edf3f8;background:#070a0f;--orange:#ff9418;--orange-soft:#2b2115;--green:#66e5a1;--yellow:#ffc565;--red:#ff6f7d;--blue:#70b8ff;--line:#25303d;--panel:#111821;--panel2:#0d141c;--muted:#8594a6}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 78% -10%,#1d2937 0,#0c1219 34%,#070a0f 72%);color:#edf3f8}.shell{min-height:100vh;display:grid;grid-template-columns:248px minmax(0,1fr)}.side{border-right:1px solid #202a35;padding:22px 16px;background:#090e14;position:sticky;top:0;height:100vh;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:10px;font-weight:950;font-size:19px;color:var(--orange);padding:7px 9px 22px}.brand-mark{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(145deg,#ffae43,#ff7a00);color:#111;font-size:20px;box-shadow:0 8px 22px #ff8a0028}.brand span:last-child{color:#fff}.side-label{font-size:10px;letter-spacing:.12em;color:#596878;font-weight:800;padding:10px 12px 7px}.nav{display:grid;gap:5px}.nav a{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:11px;color:#92a1b2;text-decoration:none;font-size:13px;border:1px solid transparent}.nav a:hover{background:#121a23;color:#fff}.nav a.on{background:linear-gradient(90deg,#302316,#171a1f);color:#ffad4f;border-color:#4b3520}.nav-ico{width:22px;text-align:center;font-size:15px}.side-status{margin-top:auto;border-top:1px solid #1f2833;padding:16px 10px 4px}.side-status small{display:block;color:#637283;font-size:11px}.side-status b{display:flex;align-items:center;gap:7px;margin-top:6px;font-size:12px}.live-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px #66e5a116}.main{padding:24px 28px 34px;max-width:1580px;width:100%;margin:auto}.topbar{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:16px}.title-wrap{min-width:0}.eyebrow{display:block;font-size:10px;letter-spacing:.13em;color:#77889a;font-weight:900;margin-bottom:5px}.topbar h1{font-size:25px;margin:0;letter-spacing:-.03em}.topbar p{margin:5px 0 0;color:#78889a;font-size:12px}.health{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.pill{border:1px solid #283545;border-radius:999px;padding:7px 10px;background:#0e151d;color:#9db0c2;font-size:11px;white-space:nowrap}.pill.primary{color:#9bf1bd;border-color:#275640;background:#0d2018}.hero{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(250px,.75fr);gap:12px;margin-bottom:14px}.hero-main,.hero-side,.panel,.task,.login,.work,.kpi{background:linear-gradient(180deg,#131b25,#0e151d);border:1px solid var(--line);border-radius:16px;box-shadow:0 14px 36px #0004}.hero-main{padding:17px 18px;display:flex;gap:14px;align-items:center}.hero-icon{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:var(--orange-soft);border:1px solid #51391f;color:var(--orange);font-size:21px}.hero-copy{min-width:0;flex:1}.hero-copy small{color:#77889a;font-size:11px}.hero-copy b{display:block;margin-top:3px;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hero-side{display:flex;align-items:center;justify-content:space-between;padding:14px 16px}.hero-side small{display:block;color:#748495;font-size:10px}.hero-side b{display:block;margin-top:4px;font-size:13px}.truth{font-size:10px;padding:6px 8px;border-radius:8px;background:#102219;color:#7cebae;border:1px solid #275640}.task,.login{padding:17px 18px;margin-bottom:14px}.task-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.task h2{font-size:17px;margin:0 0 3px}.task-head small{color:#77889a;font-size:11px}.command-badge{font-size:9px;font-weight:900;letter-spacing:.08em;color:#8cf0b4;border:1px solid #2b5b43;background:#0e2119;border-radius:8px;padding:6px 8px}.task textarea{display:block;width:100%;min-height:104px;margin:12px 0 10px;background:#090f15;color:#fff;border:1px solid #293746;border-radius:12px;padding:13px 14px;font:inherit;resize:vertical;outline:none}.task textarea:focus,.task select:focus,.login input:focus{border-color:#7b562b;box-shadow:0 0 0 3px #ff941810}.task-actions{display:flex;gap:9px;justify-content:flex-end}.task select,.login input{background:#0a1118;color:#fff;border:1px solid #293746;border-radius:10px;padding:10px 12px}.task button,.login button{border:0;border-radius:10px;background:linear-gradient(135deg,#ff9f27,#ff7f00);color:#13100c;font-weight:950;padding:10px 18px;cursor:pointer}.task button span{padding-left:8px}.login{display:flex;gap:10px;align-items:center}.login>div{display:grid;min-width:210px}.login>div b{font-size:13px}.login input{flex:1}.notice{padding:11px 13px;margin-bottom:14px;border:1px solid #285d43;background:#10241b;border-radius:11px;color:#b9f6d0;font-size:12px}.notice.warn{border-color:#705122;background:#2b2111;color:#ffd28b}.notice a{color:#91ceff}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 14px}.kpi{padding:14px 15px;position:relative;overflow:hidden}.kpi:after{content:"";position:absolute;right:-15px;top:-20px;width:72px;height:72px;border-radius:50%;background:#ffffff05}.kpi-top{display:flex;justify-content:space-between;align-items:center}.kpi small{color:#8999aa;font-size:11px}.kpi-ico{font-size:17px;color:#6f8194}.kpi b{display:block;font-size:27px;margin-top:5px;letter-spacing:-.04em}.kpi span{display:block;color:#617183;font-size:10px;margin-top:2px}.panel{padding:15px;margin-bottom:14px}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:11px}.panel h2{font-size:12px;letter-spacing:.08em;margin:0;color:#bbc7d4}.panel-note{font-size:10px;color:#627386}.server-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.metric,.service{border:1px solid #25303d;border-radius:12px;padding:11px;background:#0d141c;min-width:0}.metric small,.service small{display:block;color:#748596;font-size:10px}.metric b{display:block;margin:3px 0 2px;font-size:19px}.metric span:not(.meter),.service span{display:block;color:#6f7f90;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meter{height:4px;background:#202b37;border-radius:999px;display:block;margin-top:9px;overflow:hidden}.meter i{display:block;height:100%;background:linear-gradient(90deg,#ff8a00,#ffc15c);border-radius:999px}.meter.unavailable i{width:0}.service{display:flex;align-items:center;gap:9px}.service-icon{width:30px;height:30px;flex:0 0 30px;border-radius:9px;display:grid;place-items:center;background:#17212c;border:1px solid #2b3948;color:#9aabba;font-size:9px;font-weight:900}.service b{font-size:11px}.layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(330px,.75fr);gap:12px}.works{display:grid;gap:8px}.work{padding:13px 14px;box-shadow:none;background:#0d141c}.work-top{display:flex;justify-content:space-between;gap:8px;align-items:center}.work-id{display:flex;align-items:center;gap:7px;font-size:11px}.work-dot{width:7px;height:7px;border-radius:50%;background:#667688}.status{font-size:9px;font-weight:900;letter-spacing:.04em;border:1px solid #304052;border-radius:999px;padding:4px 7px}.status.good{border-color:#2a6045;background:#10251b}.status.wait{border-color:#6c5429;background:#2b2211}.status.danger{border-color:#6c3640;background:#2a1418}.status.active{border-color:#31577d;background:#101e2c}.work h3{margin:8px 0 9px;font-size:13px;line-height:1.38}.meta-row{display:flex;gap:8px;flex-wrap:wrap;font-size:9px;color:#738395}.meta-row span{border:1px solid #222e3a;border-radius:7px;padding:4px 6px}.ai{display:grid;gap:7px}.ai-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:9px;align-items:center;border:1px solid #25303d;border-radius:11px;padding:10px;background:#0d141c}.ai-row.lead{border-color:#49361f;background:linear-gradient(90deg,#20180f,#0d141c)}.avatar{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:#17212c;color:#92a5b8;font-size:9px;font-weight:950;border:1px solid #293746}.avatar.tiger{background:#312113;color:#ffad4d;border-color:#51371c}.ai-copy{min-width:0}.ai-copy span{display:block;font-size:11px}.ai-copy small{display:block;color:#748596;font-size:9px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ai-row>b{font-size:9px}.good{color:var(--green)!important}.wait{color:var(--yellow)!important}.danger{color:var(--red)!important}.active{color:var(--blue)!important}.muted{color:#8b9aab!important}.footer{display:flex;justify-content:space-between;gap:12px;padding:8px 2px 2px;color:#566677;font-size:9px}.mobile-nav{display:none}
@media(max-width:1050px){.shell{grid-template-columns:210px minmax(0,1fr)}.main{padding:20px}.server-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.layout{grid-template-columns:minmax(0,1.35fr) minmax(290px,.8fr)}}
@media(max-width:820px){.shell{display:block}.side{display:none}.main{padding:14px 12px 78px}.topbar{align-items:flex-start}.topbar h1{font-size:21px}.health .pill:not(.primary){display:none}.hero{grid-template-columns:1fr}.hero-side{display:none}.kpis{grid-template-columns:repeat(2,1fr)}.server-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.layout{grid-template-columns:1fr}.task-actions{position:sticky;bottom:70px;z-index:3}.task button{flex:1}.task select{width:40%}.mobile-nav{display:grid;grid-template-columns:repeat(4,1fr);position:fixed;left:10px;right:10px;bottom:9px;z-index:20;background:#0d141ceb;border:1px solid #2a3542;backdrop-filter:blur(16px);border-radius:14px;padding:6px;box-shadow:0 14px 30px #0008}.mobile-nav a{text-decoration:none;color:#718294;font-size:9px;text-align:center;padding:5px 2px}.mobile-nav b{display:block;font-size:15px;color:#a3b2c2;margin-bottom:2px}.mobile-nav a:first-child,.mobile-nav a:first-child b{color:#ff9f2e}.panel{border-radius:14px}}
@media(max-width:520px){.main{padding-left:9px;padding-right:9px}.topbar p{display:none}.hero-main{padding:14px}.hero-icon{width:40px;height:40px}.task,.login{padding:14px}.task-head{align-items:center}.command-badge{display:none}.task textarea{min-height:126px}.login{display:grid}.login input{width:100%}.kpi{padding:12px}.kpi b{font-size:23px}.server-grid{grid-template-columns:1fr 1fr}.service{padding:9px}.service-icon{display:none}.ai-row{grid-template-columns:30px minmax(0,1fr) auto}.avatar{width:29px;height:29px}.footer{display:block}.footer span{display:block;margin-top:4px}}
</style></head><body><div class="shell"><aside class="side"><div class="brand"><span class="brand-mark">🐯</span><div>TIGERIQ <span>AI LAB</span></div></div><div class="side-label">COMMAND CENTER</div><nav class="nav"><a class="on" href="#overview"><span class="nav-ico">⌂</span>Tổng quan</a><a href="#work"><span class="nav-ico">▣</span>Work Order</a><a href="#workforce"><span class="nav-ico">✦</span>AI Workforce</a><a href="#work"><span class="nav-ico">▥</span>Evidence & Gate</a><a href="#server"><span class="nav-ico">◈</span>PC01 Runtime</a></nav><div class="side-status"><small>PRIMARY RUNTIME</small><b><span class="live-dot"></span>PC01 · PRIVATE</b></div></aside><main class="main" id="overview"><header class="topbar"><div class="title-wrap"><span class="eyebrow">TIGERIQ / OPERATIONS</span><h1>Command Center</h1><p>Vy — AI Chief of Staff · điều phối công việc thật trên PC01</p></div><div class="health"><span class="pill primary">● PC01 / PRIVATE</span><span class="pill">↻ 15s</span><span class="pill">Tailscale ${escapeHtml(telemetry.tailscale?.ip ?? '—')}</span></div></header><section class="hero"><div class="hero-main"><div class="hero-icon">▶</div><div class="hero-copy"><small>ĐANG XỬ LÝ</small><b>${escapeHtml(activityText(summary))}</b></div><span class="status active">LIVE STATE</span></div><div class="hero-side"><div><small>DỮ LIỆU CẬP NHẬT</small><b>${generatedAt}</b></div><span class="truth">EVIDENCE ONLY</span></div></section>${submittedNotice}${controllerWarning}${taskPanel}<section class="kpis"><div class="kpi"><div class="kpi-top"><small>ĐANG XỬ LÝ</small><span class="kpi-ico">▶</span></div><b>${summary.activeWorkOrders}</b><span>Work Order active</span></div><div class="kpi"><div class="kpi-top"><small>VƯỚNG / CHỜ</small><span class="kpi-ico">◷</span></div><b>${summary.blockedWorkOrders}</b><span>Cần xử lý hoặc dependency</span></div><div class="kpi"><div class="kpi-top"><small>GATE LỖI / CHẶN</small><span class="kpi-ico">◇</span></div><b>${summary.failingGates}</b><span>Không claim PASS khi còn lỗi</span></div><div class="kpi"><div class="kpi-top"><small>EVIDENCE</small><span class="kpi-ico">▥</span></div><b>${summary.evidenceCount}</b><span>Bằng chứng đã ghi nhận</span></div></section><section class="panel" id="server"><div class="panel-head"><h2>PC01 SERVER & SERVICES</h2><span class="panel-note">Telemetry thật · unavailable-safe</span></div>${serverPanel}</section><section class="layout"><div class="panel" id="work"><div class="panel-head"><h2>WORK ORDER · EVIDENCE / GATE</h2><span class="panel-note">${summary.workOrders.length} work orders</span></div><div class="works">${workCards || '<div class="notice">Chưa có Work Order trong datasource hiện tại.</div>'}</div></div><div class="panel" id="workforce"><div class="panel-head"><h2>AI WORKFORCE</h2><span class="panel-note">Role-bounded</span></div>${workforcePanel}</div></section><div class="footer"><span>TigerIQ AI Lab · PRIMARY PC01/private</span><span>Vercel SECONDARY/BACKUP · MAIN/Production không tự động thay đổi</span></div></main></div><nav class="mobile-nav"><a href="#overview"><b>⌂</b>Tổng quan</a><a href="#work"><b>▣</b>Work</a><a href="#workforce"><b>✦</b>AI</a><a href="#server"><b>◈</b>PC01</a></nav></body></html>`;
}

function renderMessage(title: string, message: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Quay lại</a></p></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
