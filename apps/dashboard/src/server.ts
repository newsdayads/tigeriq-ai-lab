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

export type WorkforceEmployeeTelemetry = {
  employeeId: string;
  displayName: string;
  department: string;
  role: string;
  nodeId: string;
  provider: string | null;
  model: string | null;
  availability: 'idle' | 'busy' | 'offline' | 'degraded';
  healthScore: number | null;
  concurrencyLimit: number;
  activeTaskCount: number;
  currentTaskIds: string[];
};

export type WorkforceTaskTelemetry = {
  taskId: string;
  objective: string;
  stage: string;
  priority: string;
  assignedEmployeeId: string | null;
};

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
  workforce: {
    employeesTotal: number;
    idle: number;
    busy: number;
    offline: number;
    degraded: number;
    activeTasks: number;
    tasksActive: number;
    tasksFailed: number;
    roster?: WorkforceEmployeeTelemetry[];
    taskList?: WorkforceTaskTelemetry[];
  } | null;
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

type AiFilter = 'all' | 'busy' | 'idle' | 'offline' | 'degraded';

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

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] ?? character));
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

function stringOrNull(value: unknown, max = 256): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeStringList(value: unknown, maxItems = 32, maxLength = 128): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, maxLength));
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

function normalizeEmployee(value: unknown): WorkforceEmployeeTelemetry | null {
  const row = objectOrNull(value);
  if (!row) return null;
  const employeeId = stringOrNull(row.employeeId, 128);
  const displayName = stringOrNull(row.displayName, 128);
  const department = stringOrNull(row.department, 128);
  const role = stringOrNull(row.role, 128);
  const nodeId = stringOrNull(row.nodeId, 128);
  const availability = stringOrNull(row.availability, 32);
  if (!employeeId || !displayName || !department || !role || !nodeId || !['idle', 'busy', 'offline', 'degraded'].includes(availability ?? '')) return null;
  return {
    employeeId,
    displayName,
    department,
    role,
    nodeId,
    provider: stringOrNull(row.provider, 128),
    model: stringOrNull(row.model, 128),
    availability: availability as WorkforceEmployeeTelemetry['availability'],
    healthScore: numberOrNull(row.healthScore),
    concurrencyLimit: Math.max(1, numberOrNull(row.concurrencyLimit) ?? 1),
    activeTaskCount: Math.max(0, numberOrNull(row.activeTaskCount) ?? 0),
    currentTaskIds: safeStringList(row.currentTaskIds, 32, 128),
  };
}

function normalizeTask(value: unknown): WorkforceTaskTelemetry | null {
  const row = objectOrNull(value);
  if (!row) return null;
  const taskId = stringOrNull(row.taskId, 128);
  const objective = stringOrNull(row.objective, 512);
  const stage = stringOrNull(row.stage, 32);
  const priority = stringOrNull(row.priority, 16);
  if (!taskId || !objective || !stage || !priority) return null;
  return {
    taskId,
    objective,
    stage,
    priority,
    assignedEmployeeId: stringOrNull(row.assignedEmployeeId, 128),
  };
}

function normalizeWorkforce(value: Record<string, unknown> | null): ServerTelemetry['workforce'] {
  if (!value) return null;
  const keys = ['employeesTotal', 'idle', 'busy', 'offline', 'degraded', 'activeTasks', 'tasksActive', 'tasksFailed'] as const;
  const numbers = Object.fromEntries(keys.map((key) => [key, numberOrNull(value[key])])) as Record<(typeof keys)[number], number | null>;
  if (keys.some((key) => numbers[key] === null || numbers[key]! < 0)) return null;
  const roster = Array.isArray(value.roster) ? value.roster.map(normalizeEmployee).filter((row): row is WorkforceEmployeeTelemetry => Boolean(row)).slice(0, 200) : [];
  const taskList = Array.isArray(value.taskList) ? value.taskList.map(normalizeTask).filter((row): row is WorkforceTaskTelemetry => Boolean(row)).slice(0, 500) : [];
  return {
    employeesTotal: numbers.employeesTotal!,
    idle: numbers.idle!,
    busy: numbers.busy!,
    offline: numbers.offline!,
    degraded: numbers.degraded!,
    activeTasks: numbers.activeTasks!,
    tasksActive: numbers.tasksActive!,
    tasksFailed: numbers.tasksFailed!,
    roster,
    taskList,
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
  const postgresql = objectOrNull(data.postgresql);
  const ollama = objectOrNull(data.ollama);
  const tailscale = objectOrNull(data.tailscale);
  const gpu = objectOrNull(data.gpu);
  const models = safeStringList(ollama?.models, 64, 128);
  return {
    available: true,
    server: stringOrNull(data.server) ?? 'PC01',
    generatedAt: stringOrNull(data.generatedAt) ?? new Date().toISOString(),
    cpu: cpu ? { utilizationPercent: numberOrNull(cpu.utilizationPercent) } : null,
    memory: memory && numberOrNull(memory.usedBytes) !== null && numberOrNull(memory.totalBytes) !== null ? {
      usedBytes: numberOrNull(memory.usedBytes)!,
      totalBytes: numberOrNull(memory.totalBytes)!,
      utilizationPercent: numberOrNull(memory.utilizationPercent),
    } : null,
    uptimeSeconds: numberOrNull(data.uptimeSeconds),
    disk: disk && stringOrNull(disk.drive) && numberOrNull(disk.freeBytes) !== null && numberOrNull(disk.totalBytes) !== null ? {
      drive: stringOrNull(disk.drive)!,
      freeBytes: numberOrNull(disk.freeBytes)!,
      totalBytes: numberOrNull(disk.totalBytes)!,
      utilizationPercent: numberOrNull(disk.utilizationPercent),
    } : null,
    worker: worker ? { online: worker.online === true, pid: numberOrNull(worker.pid), instances: numberOrNull(worker.instances) ?? 0 } : null,
    controller: controller ? { online: controller.online === true, ip: stringOrNull(controller.ip), port: numberOrNull(controller.port) } : null,
    workforce: normalizeWorkforce(objectOrNull(data.workforce)),
    postgresql: postgresql ? { online: postgresql.online === true, service: stringOrNull(postgresql.service), port: numberOrNull(postgresql.port) } : null,
    ollama: ollama ? { online: ollama.online === true, models } : null,
    tailscale: tailscale ? { online: tailscale.online === true, ip: stringOrNull(tailscale.ip) } : null,
    gpu: gpu && stringOrNull(gpu.name) ? {
      name: stringOrNull(gpu.name)!,
      utilizationPercent: numberOrNull(gpu.utilizationPercent),
      memoryUsedMiB: numberOrNull(gpu.memoryUsedMiB),
      memoryTotalMiB: numberOrNull(gpu.memoryTotalMiB),
    } : null,
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
      maxBuffer: 512 * 1024,
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
  if (octets[0] === 127 || octets[0] === 10) return true;
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
        const aiQuery = (url.searchParams.get('ai') ?? '').trim().slice(0, 100);
        const requestedState = (url.searchParams.get('state') ?? 'all') as AiFilter;
        const aiState: AiFilter = ['all', 'busy', 'idle', 'offline', 'degraded'].includes(requestedState) ? requestedState : 'all';
        return respond(response, 200, 'text/html; charset=utf-8', render(summary, telemetry, session, Boolean(commandSecret), submitted, aiQuery, aiState));
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
  return {
    url: `http://${address.address}:${address.port}`,
    close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Việc mới', approved: 'Đã duyệt', running: 'Đang làm', failed: 'Lỗi', blocked: 'Vướng / Chờ', verified: 'Hoàn thành',
  };
  return labels[status] ?? status;
}

function statusClass(status: string): string {
  if (status === 'verified' || status === 'idle') return 'good';
  if (status === 'failed' || status === 'offline') return 'danger';
  if (status === 'blocked' || status === 'degraded') return 'wait';
  if (status === 'running' || status === 'busy') return 'active';
  return 'muted';
}

function healthText(value: { online: boolean } | null | undefined): string {
  if (!value) return 'Chưa có dữ liệu';
  return value.online ? 'ONLINE' : 'OFFLINE';
}

function healthClass(value: { online: boolean } | null | undefined): string {
  return value?.online ? 'good' : 'danger';
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value)}%`;
}

function gb(bytes: number | null | undefined): string {
  return bytes === null || bytes === undefined ? '—' : `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function uptime(seconds: number | null): string {
  if (seconds === null) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${days} ngày ${hours} giờ ${mins} phút`;
}

function displayTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { hour12: false });
}

function ownerForWorkOrder(workOrderId: string, telemetry: ServerTelemetry): string {
  const task = telemetry.workforce?.taskList?.find((row) => row.taskId === workOrderId || row.taskId.includes(workOrderId));
  if (!task?.assignedEmployeeId) return 'Vy · điều phối';
  const employee = telemetry.workforce?.roster?.find((row) => row.employeeId === task.assignedEmployeeId);
  return employee ? employee.displayName : task.assignedEmployeeId;
}

function workOrderStage(workOrderId: string, telemetry: ServerTelemetry): string | null {
  return telemetry.workforce?.taskList?.find((row) => row.taskId === workOrderId || row.taskId.includes(workOrderId))?.stage ?? null;
}

function taskObjective(taskId: string, telemetry: ServerTelemetry): string {
  return telemetry.workforce?.taskList?.find((row) => row.taskId === taskId)?.objective ?? taskId;
}

function render(summary: ReturnType<typeof buildDashboard>, telemetry: ServerTelemetry, session: Session | null, writeConfigured: boolean, submitted: string | null, aiQuery: string, aiState: AiFilter): string {
  const activeWork = summary.workOrders.filter((item) => !['verified'].includes(item.status));
  const completed = summary.workOrders.filter((item) => item.status === 'verified').length;
  const needsOwner = summary.workOrders.filter((item) => item.status === 'blocked' || item.latestGateStatus === 'fail' || item.latestGateStatus === 'blocked');
  const blockers = summary.workOrders.filter((item) => item.status === 'failed' || item.latestGateStatus === 'fail').length;
  const roster = telemetry.workforce?.roster ?? [];
  const rosterWithVy: WorkforceEmployeeTelemetry[] = [{
    employeeId: 'vy-chief-of-staff', displayName: 'Vy', department: 'Điều hành', role: 'AI Chief of Staff', nodeId: 'web-control', provider: 'TigerIQ', model: null,
    availability: activeWork.length > 0 ? 'busy' : 'idle', healthScore: 100, concurrencyLimit: 99, activeTaskCount: activeWork.length, currentTaskIds: activeWork.map((item) => item.id),
  }, ...roster.filter((row) => row.employeeId !== 'vy-chief-of-staff')];
  const query = aiQuery.toLocaleLowerCase('vi-VN');
  const filteredRoster = rosterWithVy.filter((employee) => {
    const stateMatch = aiState === 'all' || employee.availability === aiState;
    const text = `${employee.displayName} ${employee.employeeId} ${employee.role} ${employee.department} ${employee.provider ?? ''} ${employee.model ?? ''}`.toLocaleLowerCase('vi-VN');
    return stateMatch && (!query || text.includes(query));
  });
  const modelList = telemetry.ollama?.models ?? [];
  const submittedNotice = submitted && /^https:\/\/github\.com\//.test(submitted)
    ? `<div class="notice good-note">✓ Vy đã nhận Work Order và đưa vào hàng đợi PC01. <a href="${escapeHtml(submitted)}">Xem evidence</a></div>` : '';

  const workRows = activeWork.length ? activeWork.map((item) => {
    const stage = workOrderStage(item.id, telemetry);
    return `<tr><td><b>${escapeHtml(item.id)}</b><small>${escapeHtml(item.project)}</small></td><td><strong>${escapeHtml(item.goal)}</strong><small>${item.evidenceCount} evidence · Gate ${escapeHtml(item.latestGateStatus ?? 'chưa có')}</small></td><td>${escapeHtml(ownerForWorkOrder(item.id, telemetry))}</td><td>${stage ? `<span class="chip ${statusClass(stage)}">${escapeHtml(stage)}</span>` : '<span class="muted">Chưa có % thực</span>'}</td><td><span class="chip ${statusClass(item.status)}">${escapeHtml(statusText(item.status))}</span></td></tr>`;
  }).join('') : `<tr><td colspan="5" class="empty">Chưa có Work Order đang chạy.</td></tr>`;

  const ownerRows = needsOwner.length ? needsOwner.slice(0, 8).map((item) => `<article class="decision"><div><span class="decision-id">${escapeHtml(item.id)}</span><h3>${escapeHtml(item.goal)}</h3><p>${item.status === 'blocked' ? 'Work Order đang bị chặn.' : 'Gate đang FAIL / BLOCKED.'} · ${item.evidenceCount} evidence</p></div><span class="chip wait">Cần xem</span></article>`).join('') : `<div class="empty-card">✓ Hiện không có việc bắt buộc anh Sơn xử lý.</div>`;

  const aiRows = filteredRoster.length ? filteredRoster.map((employee) => {
    const current = employee.currentTaskIds.length ? employee.currentTaskIds.slice(0, 2).map((id) => taskObjective(id, telemetry)).join(' · ') : 'Đang rảnh';
    const load = `${employee.activeTaskCount}/${employee.concurrencyLimit}`;
    return `<tr><td><div class="person"><span class="avatar">${escapeHtml(employee.displayName.slice(0, 2).toUpperCase())}</span><div><b>${escapeHtml(employee.displayName)}</b><small>${escapeHtml(employee.employeeId)}</small></div></div></td><td>${escapeHtml(employee.role)}<small>${escapeHtml(employee.department)}</small></td><td>${escapeHtml(employee.model ?? employee.provider ?? 'Chưa gán model')}</td><td><strong>${escapeHtml(current)}</strong><small>${employee.currentTaskIds.length ? employee.currentTaskIds.map(escapeHtml).join(', ') : 'Không có task active'}</small></td><td><span class="chip ${statusClass(employee.availability)}">${escapeHtml(employee.availability.toUpperCase())}</span></td><td>${escapeHtml(load)}</td></tr>`;
  }).join('') : `<tr><td colspan="6" class="empty">Không có AI phù hợp bộ lọc. Workforce Controller ${telemetry.controller?.online ? 'đang online' : 'đang offline'}.</td></tr>`;

  const modelRows = modelList.length ? modelList.map((model) => {
    const users = roster.filter((employee) => employee.model?.toLowerCase() === model.toLowerCase());
    return `<tr><td><b>${escapeHtml(model)}</b></td><td>Ollama Local</td><td><span class="chip ${telemetry.ollama?.online ? 'good' : 'danger'}">${telemetry.ollama?.online ? 'ONLINE' : 'OFFLINE'}</span></td><td>${users.length ? escapeHtml(users.map((employee) => employee.displayName).join(', ')) : '<span class="muted">Chưa gán</span>'}</td></tr>`;
  }).join('') : `<tr><td colspan="4" class="empty">Chưa đọc được danh sách model Ollama.</td></tr>`;

  const taskPanel = session ? `<form class="task-form" method="post" action="/jobs"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="idempotency" value="${randomBytes(24).toString('base64url')}"><div><span class="eyebrow">GIAO VIỆC CHO VY</span><h2>Anh Sơn chỉ cần nhập mục tiêu</h2><p>Vy tự tạo Work Order → chọn AI/model → theo dõi evidence → chỉ gọi anh khi cần quyết định.</p></div><textarea name="instruction" maxlength="8000" required placeholder="Ví dụ: Hoàn thiện WebControl, kiểm tra toàn bộ luồng và báo khi cần tôi phê duyệt."></textarea><div class="task-actions"><select name="priority" aria-label="Mức ưu tiên"><option>Bình thường</option><option>Cao</option><option>Khẩn cấp</option><option>Thấp</option></select><button type="submit">GIAO VIỆC CHO VY →</button></div></form>`
    : writeConfigured ? `<form class="login" method="post" action="/login"><div><span class="eyebrow">MỞ QUYỀN ĐIỀU KHIỂN</span><b>Đăng nhập để giao việc cho Vy</b></div><input type="password" name="secret" autocomplete="current-password" placeholder="Mã điều khiển local" required><button type="submit">ĐĂNG NHẬP</button></form>`
      : `<div class="notice warn">Web đang ở chế độ chỉ xem. Chưa cấu hình mã điều khiển local.</div>`;

  const healthItems = [
    ['PC01', telemetry.available], ['Worker', telemetry.worker?.online], ['Ollama', telemetry.ollama?.online], ['Tailscale', telemetry.tailscale?.online], ['Controller', telemetry.controller?.online],
  ] as Array<[string, boolean | undefined]>;
  const healthStrip = healthItems.map(([name, online]) => `<span class="health-chip ${online ? 'good' : 'danger'}"><i></i>${escapeHtml(name)} ${online ? 'ONLINE' : 'OFFLINE'}</span>`).join('');
  const generatedAt = telemetry.available ? displayTime(telemetry.generatedAt) : 'Chưa có telemetry';
  const refreshMeta = session ? '' : '<meta http-equiv="refresh" content="30">';

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${refreshMeta}<title>TigerIQ Command Center</title><style>
:root{font-family:"Segoe UI Variable","Segoe UI",Tahoma,Arial,sans-serif;color:#f4f7fb;background:#071019;--orange:#ff9418;--green:#39d98a;--blue:#5ca8ff;--yellow:#ffc35c;--red:#ff6574;--line:#263444;--panel:#101a25;--panel2:#0b141d;--muted:#8b9aab}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 76% -12%,#1a2b3d 0,#0b141e 37%,#061019 76%);font-size:14px;line-height:1.45}.shell{min-height:100vh;display:grid;grid-template-columns:230px minmax(0,1fr)}.side{position:sticky;top:0;height:100vh;background:#08111a;border-right:1px solid #202d3a;padding:22px 15px;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:900;color:var(--orange);padding:5px 8px 24px}.brand-mark{width:36px;height:36px;border-radius:11px;background:linear-gradient(145deg,#ffac3c,#ff7a00);display:grid;place-items:center;color:#111;font-size:20px}.brand em{font-style:normal;color:#fff}.nav-label{font-size:10px;letter-spacing:.12em;color:#617285;font-weight:800;padding:8px 10px}.nav{display:grid;gap:5px}.nav a{color:#9caabb;text-decoration:none;padding:11px 12px;border-radius:11px;border:1px solid transparent}.nav a.on{color:#ffad52;background:#251c13;border-color:#513820}.side-foot{margin-top:auto;border-top:1px solid #1e2a36;padding:15px 8px;color:#7d8da0;font-size:11px}.side-foot b{display:block;color:#fff;margin-top:6px}.main{width:100%;max-width:1600px;margin:auto;padding:22px 26px 36px}.topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:16px}.eyebrow{display:block;font-size:10px;font-weight:900;letter-spacing:.12em;color:#7890a6}.topbar h1{font-size:25px;line-height:1.15;margin:4px 0}.topbar p{margin:0;color:var(--muted)}.system-state{display:flex;align-items:center;gap:8px;border:1px solid #2a4839;background:#0b2118;color:#83e8b1;border-radius:999px;padding:8px 11px;font-size:12px}.system-state.warn{border-color:#664a23;background:#2a1e10;color:#ffd184}.panel,.kpi,.task-form,.login,.runtime{background:linear-gradient(180deg,#111d29,#0c1620);border:1px solid var(--line);border-radius:15px;box-shadow:0 14px 34px #0003}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;margin-bottom:14px}.kpi{padding:15px 16px}.kpi small{color:#8395a8}.kpi b{display:block;font-size:29px;margin-top:4px}.kpi .blue{color:var(--blue)}.kpi .yellow{color:var(--yellow)}.kpi .green{color:var(--green)}.kpi .red{color:var(--red)}.task-form{padding:17px;margin-bottom:14px;display:grid;grid-template-columns:minmax(250px,.75fr) minmax(360px,1.25fr);gap:14px;align-items:center}.task-form h2{margin:3px 0;font-size:19px}.task-form p{margin:0;color:var(--muted);font-size:12px}.task-form textarea{min-height:88px;width:100%;resize:vertical;background:#071019;color:#fff;border:1px solid #304155;border-radius:11px;padding:12px 13px;font:inherit}.task-actions{grid-column:2;display:flex;justify-content:flex-end;gap:8px}.task-actions select,.login input{background:#071019;color:#fff;border:1px solid #304155;border-radius:10px;padding:10px 12px}.task-actions button,.login button{border:0;border-radius:10px;background:linear-gradient(135deg,#ffa529,#ff7d00);font-weight:900;color:#171009;padding:10px 16px;cursor:pointer}.login{padding:14px 16px;margin-bottom:14px;display:flex;align-items:center;gap:10px}.login>div{min-width:230px}.login b{display:block}.login input{flex:1}.notice{padding:11px 13px;border-radius:11px;margin-bottom:14px;border:1px solid #285f45;background:#10261c;color:#bdf5d2}.notice.warn{border-color:#705123;background:#2a2012;color:#ffd494}.notice a{color:#8bcaff}.grid-main{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(330px,.72fr);gap:12px;margin-bottom:14px}.panel{padding:15px;min-width:0}.panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:11px}.panel-head h2{font-size:13px;margin:0;letter-spacing:.05em}.panel-head small{color:#73869a}.table-wrap{overflow:auto;border:1px solid #243240;border-radius:11px;max-height:440px}.data{width:100%;border-collapse:collapse;min-width:760px}.data th{position:sticky;top:0;background:#0c1620;color:#7e90a4;text-align:left;font-size:10px;letter-spacing:.05em;padding:10px 11px;border-bottom:1px solid #263545}.data td{padding:11px;border-bottom:1px solid #202d39;vertical-align:top}.data tr:last-child td{border-bottom:0}.data td small{display:block;color:#78899b;font-size:11px;margin-top:3px}.data td strong,.data td b{font-weight:700}.chip{display:inline-flex;align-items:center;border:1px solid #314153;border-radius:999px;padding:4px 7px;font-size:10px;font-weight:800;white-space:nowrap}.chip.good{color:#7feab1;border-color:#2c684c;background:#0d251a}.chip.active{color:#85c4ff;border-color:#305b83;background:#0d1e2e}.chip.wait{color:#ffd080;border-color:#6c5227;background:#2a2010}.chip.danger{color:#ff98a2;border-color:#6e3640;background:#2a1419}.chip.muted{color:#9ba9b7}.muted{color:#7e8d9e}.empty{padding:24px!important;text-align:center;color:#7c8c9d}.decisions{display:grid;gap:9px}.decision{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid #2b3947;background:#0b151f;border-radius:11px;padding:12px}.decision h3{font-size:13px;margin:3px 0}.decision p{font-size:11px;color:#8091a3;margin:0}.decision-id{font-size:10px;color:#ffb35e}.empty-card{border:1px solid #27543e;background:#0e2118;color:#a8f0c6;border-radius:11px;padding:18px}.section-stack{display:grid;gap:12px;margin-bottom:14px}.filters{display:flex;gap:8px;flex-wrap:wrap}.filters input,.filters select{background:#08121b;color:#fff;border:1px solid #2b3b4b;border-radius:9px;padding:8px 10px}.filters button{border:1px solid #59401f;background:#261b10;color:#ffb75e;border-radius:9px;padding:8px 11px;cursor:pointer}.person{display:flex;align-items:center;gap:9px}.avatar{width:34px;height:34px;border-radius:9px;background:#172536;border:1px solid #30445a;color:#9ec7ef;display:grid;place-items:center;font-size:10px;font-weight:900}.model-summary{display:flex;gap:8px;flex-wrap:wrap}.model-pill{border:1px solid #314153;border-radius:999px;padding:6px 9px;color:#aab8c6;background:#0b151f;font-size:11px}.runtime{overflow:hidden}.runtime summary{cursor:pointer;list-style:none;padding:14px 15px;display:flex;align-items:center;justify-content:space-between;gap:12px}.runtime summary::-webkit-details-marker{display:none}.runtime-title{display:flex;align-items:center;gap:10px}.runtime-title b{font-size:13px}.health-strip{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.health-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #314153;border-radius:999px;padding:5px 8px;font-size:10px}.health-chip i{width:6px;height:6px;border-radius:50%;background:currentColor}.health-chip.good{color:#72e7a7;border-color:#2c664b}.health-chip.danger{color:#ff8994;border-color:#65343c}.runtime-body{border-top:1px solid #263646;padding:13px}.server-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.metric{border:1px solid #273646;background:#0a141e;border-radius:10px;padding:10px}.metric small{display:block;color:#74879b}.metric b{display:block;font-size:18px;margin-top:3px}.metric span{display:block;color:#7d8ea0;font-size:10px;margin-top:2px}.footer{margin-top:14px;color:#66788b;font-size:10px;text-align:right}@media(max-width:1100px){.shell{grid-template-columns:1fr}.side{position:static;height:auto;border-right:0;border-bottom:1px solid #202d3a;padding:12px 16px}.brand{padding:2px 4px 10px}.nav-label,.side-foot{display:none}.nav{display:flex;overflow:auto}.nav a{white-space:nowrap}.main{padding:16px}.grid-main{grid-template-columns:1fr}.task-form{grid-template-columns:1fr}.task-actions{grid-column:1}.server-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){body{font-size:14px}.topbar{display:block}.system-state{margin-top:10px;width:max-content}.kpis{grid-template-columns:repeat(2,1fr)}.login{display:grid}.login>div{min-width:0}.task-form textarea{min-height:110px}.data{min-width:700px}.health-strip{justify-content:flex-start}.runtime summary{display:block}.runtime-title{margin-bottom:9px}}@media(max-width:520px){.main{padding:12px}.kpis{grid-template-columns:1fr 1fr}.kpi{padding:12px}.kpi b{font-size:24px}.task-actions{display:grid}.task-actions select,.task-actions button{width:100%}.server-grid{grid-template-columns:1fr}.panel{padding:11px}.side{padding:10px}.nav a{padding:9px}.topbar h1{font-size:22px}}
</style></head><body><div class="shell"><aside class="side"><div class="brand"><span class="brand-mark">🐯</span><span>TIGERIQ <em>AI LAB</em></span></div><div class="nav-label">WEB CONTROL</div><nav class="nav"><a class="on" href="#overview">⌂ Tổng quan</a><a href="#work">▣ Work Order</a><a href="#workforce">✦ AI Workforce</a><a href="#models">◈ Mô hình AI</a><a href="#runtime">◇ PC01 Runtime</a></nav><div class="side-foot">PRIMARY RUNTIME<b>● PC01 · PRIVATE</b></div></aside><main class="main"><header class="topbar" id="overview"><div><span class="eyebrow">OWNER COCKPIT V2</span><h1>Web Control / Command Center</h1><p>Vy — AI Chief of Staff · anh Sơn điều khiển mục tiêu, AI tự xử lý phần còn lại.</p></div><div class="system-state ${telemetry.controller?.online === false ? 'warn' : ''}">${telemetry.controller?.online === false ? '⚠ Hệ thống có cảnh báo' : '✓ Hệ thống hoạt động'} · ${escapeHtml(generatedAt)}</div></header>${submittedNotice}${taskPanel}<section class="kpis"><div class="kpi"><small>ĐANG CHẠY</small><b class="blue">${summary.activeWorkOrders}</b><span>Work Order đang xử lý</span></div><div class="kpi"><small>CẦN ANH SƠN</small><b class="yellow">${needsOwner.length}</b><span>Blocker / Gate cần xem</span></div><div class="kpi"><small>HOÀN THÀNH</small><b class="green">${completed}</b><span>Work Order đã verified</span></div><div class="kpi"><small>LỖI / BLOCKER</small><b class="red">${blockers}</b><span>Không claim PASS khi còn lỗi</span></div></section><section class="grid-main"><div class="panel" id="work"><div class="panel-head"><h2>CÔNG VIỆC ĐANG CHẠY</h2><small>${activeWork.length} Work Order</small></div><div class="table-wrap"><table class="data"><thead><tr><th>WORK ORDER</th><th>MỤC TIÊU</th><th>AI PHỤ TRÁCH</th><th>GIAI ĐOẠN</th><th>TRẠNG THÁI</th></tr></thead><tbody>${workRows}</tbody></table></div></div><div class="panel"><div class="panel-head"><h2>CẦN ANH SƠN</h2><small>Chỉ hiện việc cần quyết định / xử lý</small></div><div class="decisions">${ownerRows}</div></div></section><section class="section-stack"><div class="panel" id="workforce"><div class="panel-head"><div><h2>AI WORKFORCE — AI ĐANG LÀM GÌ</h2><small>${rosterWithVy.length} AI · ${telemetry.workforce?.busy ?? 0} bận · ${telemetry.workforce?.idle ?? 0} rảnh · ${telemetry.workforce?.offline ?? 0} offline</small></div><form class="filters" method="get" action="/"><input name="ai" value="${escapeHtml(aiQuery)}" placeholder="Tìm AI / role / model"><select name="state"><option value="all"${aiState === 'all' ? ' selected' : ''}>Tất cả trạng thái</option><option value="busy"${aiState === 'busy' ? ' selected' : ''}>Đang bận</option><option value="idle"${aiState === 'idle' ? ' selected' : ''}>Đang rảnh</option><option value="offline"${aiState === 'offline' ? ' selected' : ''}>Offline</option><option value="degraded"${aiState === 'degraded' ? ' selected' : ''}>Degraded</option></select><button type="submit">LỌC</button></form></div><div class="table-wrap"><table class="data"><thead><tr><th>AI</th><th>VAI TRÒ</th><th>MODEL / PROVIDER</th><th>ĐANG LÀM GÌ</th><th>TRẠNG THÁI</th><th>TẢI</th></tr></thead><tbody>${aiRows}</tbody></table></div></div><div class="panel" id="models"><div class="panel-head"><div><h2>MÔ HÌNH AI HIỆN CÓ</h2><small>${modelList.length} model Ollama local được phát hiện</small></div><div class="model-summary"><span class="model-pill">Ollama ${healthText(telemetry.ollama)}</span><span class="model-pill">${modelList.length} model</span></div></div><div class="table-wrap"><table class="data"><thead><tr><th>MODEL</th><th>LOẠI</th><th>TRẠNG THÁI</th><th>AI ĐANG DÙNG</th></tr></thead><tbody>${modelRows}</tbody></table></div></div></section><details class="runtime" id="runtime"><summary><div class="runtime-title"><span>▦</span><div><b>PC01 SERVER & SERVICES</b><div class="muted">Hạ tầng kỹ thuật — chỉ mở khi cần kiểm tra</div></div></div><div class="health-strip">${healthStrip}</div></summary><div class="runtime-body">${telemetry.available ? `<div class="server-grid"><div class="metric"><small>CPU</small><b>${pct(telemetry.cpu?.utilizationPercent)}</b></div><div class="metric"><small>RAM</small><b>${pct(telemetry.memory?.utilizationPercent)}</b><span>${gb(telemetry.memory?.usedBytes)} / ${gb(telemetry.memory?.totalBytes)}</span></div><div class="metric"><small>DISK ${escapeHtml(telemetry.disk?.drive ?? '')}</small><b>${pct(telemetry.disk?.utilizationPercent)}</b><span>${gb(telemetry.disk?.freeBytes)} trống</span></div><div class="metric"><small>UPTIME</small><b>${escapeHtml(uptime(telemetry.uptimeSeconds))}</b></div><div class="metric"><small>WORKER</small><b class="${healthClass(telemetry.worker)}">${healthText(telemetry.worker)}</b><span>PID ${telemetry.worker?.pid ?? '—'} · ${telemetry.worker?.instances ?? 0} instance</span></div><div class="metric"><small>WORKFORCE CONTROLLER</small><b class="${healthClass(telemetry.controller)}">${healthText(telemetry.controller)}</b><span>${escapeHtml(telemetry.controller?.ip ?? '—')}:${telemetry.controller?.port ?? '—'}</span></div><div class="metric"><small>PostgreSQL</small><b class="${healthClass(telemetry.postgresql)}">${healthText(telemetry.postgresql)}</b><span>${escapeHtml(telemetry.postgresql?.service ?? 'Unavailable')} · ${telemetry.postgresql?.port ?? '—'}</span></div><div class="metric"><small>Tailscale</small><b class="${healthClass(telemetry.tailscale)}">${healthText(telemetry.tailscale)}</b><span>${escapeHtml(telemetry.tailscale?.ip ?? 'Unavailable')}</span></div></div>` : '<div class="notice warn">PC01 Server: Chưa có telemetry. Web vẫn hoạt động ở chế độ an toàn.</div>'}</div></details><div class="footer">Evidence-first · Private PC01 · Không MAIN/Production nếu chưa được phép</div></main></div></body></html>`;
}

function renderMessage(title: string, message: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:"Segoe UI Variable","Segoe UI",Tahoma,Arial,sans-serif;background:#071019;color:#fff;padding:40px}main{max-width:560px;margin:auto;background:#101a25;border:1px solid #263444;border-radius:14px;padding:24px}p{color:#9aa9b8}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}
