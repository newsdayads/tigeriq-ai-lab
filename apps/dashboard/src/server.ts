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
  return { available: false, server: 'PC01', generatedAt: new Date().toISOString(), cpu: null, memory: null, uptimeSeconds: null, disk: null, worker: null, ollama: null, tailscale: null, gpu: null };
}

function normalizeTelemetry(raw: unknown): ServerTelemetry {
  const data = objectOrNull(raw);
  if (!data) return unavailableTelemetry();
  const cpu = objectOrNull(data.cpu);
  const memory = objectOrNull(data.memory);
  const disk = objectOrNull(data.disk);
  const worker = objectOrNull(data.worker);
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

function assertPrivateBind(host: string): void {
  if (host === '0.0.0.0' || host === '::') throw new Error('public wildcard bind is forbidden; use 127.0.0.1 or an explicit private/Tailscale address');
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

function render(summary: ReturnType<typeof buildDashboard>, telemetry: ServerTelemetry, session: Session | null, writeConfigured: boolean, submitted: string | null): string {
  const workCards = summary.workOrders.map((item) => `<article class="work"><div class="work-top"><b>${escapeHtml(item.id)}</b><span class="status">${escapeHtml(statusText(item.status))}</span></div><h3>${escapeHtml(item.goal)}</h3><div class="meta">Gate: ${escapeHtml(item.latestGate ?? 'chưa có')} · ${escapeHtml(item.latestGateStatus ?? '-')} · Evidence: ${item.evidenceCount}</div></article>`).join('');
  const submittedNotice = submitted && /^https:\/\/github\.com\//.test(submitted) ? `<div class="notice">✅ Đã đưa việc vào hàng đợi PC01: <a href="${escapeHtml(submitted)}">xem evidence</a></div>` : '';
  const taskPanel = session ? `<form class="task" method="post" action="/jobs"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="idempotency" value="${randomBytes(24).toString('base64url')}"><label>GIAO VIỆC CHO AI</label><textarea name="instruction" maxlength="8000" required placeholder="Ví dụ: Kiểm tra Tiger IQ Driver và tối ưu phần quyết toán Tùng"></textarea><div class="task-actions"><select name="priority"><option>Bình thường</option><option>Cao</option><option>Khẩn cấp</option><option>Thấp</option></select><button type="submit">🚀 GIAO VIỆC</button></div></form>` : writeConfigured ? `<form class="login" method="post" action="/login"><b>Mở quyền giao việc</b><input type="password" name="secret" autocomplete="current-password" placeholder="Mã điều khiển local" required><button type="submit">ĐĂNG NHẬP</button></form>` : `<div class="notice warn">🔒 Chế độ chỉ xem. Cần cấu hình TIGERIQ_COMMAND_SECRET trên PC01 để bật giao việc.</div>`;
  const serverPanel = telemetry.available ? `<div class="server-grid"><div><small>CPU</small><b>${pct(telemetry.cpu?.utilizationPercent)}</b></div><div><small>RAM</small><b>${pct(telemetry.memory?.utilizationPercent)}</b><span>${gb(telemetry.memory?.usedBytes)} / ${gb(telemetry.memory?.totalBytes)}</span></div><div><small>Disk ${escapeHtml(telemetry.disk?.drive ?? '')}</small><b>${pct(telemetry.disk?.utilizationPercent)}</b><span>${gb(telemetry.disk?.freeBytes)} trống</span></div><div><small>Uptime</small><b>${escapeHtml(uptime(telemetry.uptimeSeconds))}</b></div><div><small>Worker</small><b class="${telemetry.worker?.online ? 'good' : 'wait'}">${telemetry.worker?.online ? 'ONLINE' : 'OFFLINE'}</b><span>PID ${telemetry.worker?.pid ?? '—'} · ${telemetry.worker?.instances ?? 0} instance</span></div><div><small>Ollama</small><b class="${telemetry.ollama?.online ? 'good' : 'wait'}">${telemetry.ollama?.online ? 'ONLINE' : 'OFFLINE'}</b><span>${escapeHtml(telemetry.ollama?.models.join(', ') || '—')}</span></div><div><small>Tailscale</small><b class="${telemetry.tailscale?.online ? 'good' : 'wait'}">${telemetry.tailscale?.online ? 'ONLINE' : 'OFFLINE'}</b><span>${escapeHtml(telemetry.tailscale?.ip ?? '—')}</span></div><div><small>GPU</small><b>${telemetry.gpu ? pct(telemetry.gpu.utilizationPercent) : 'Chưa có telemetry'}</b><span>${escapeHtml(telemetry.gpu?.name ?? '')}</span></div><div class="activity"><small>Đang làm gì</small><b>${escapeHtml(activityText(summary))}</b><span>Chỉ hiển thị từ state/evidence hiện có</span></div></div>` : `<div class="notice warn">PC01 Server: Chưa có telemetry. Web vẫn hoạt động ở chế độ an toàn.</div>`;

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="refresh" content="15"><title>TigerIQ Command Center</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#edf2f7;background:#090d12}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 90% 0,#18202c 0,#0b1017 36%,#070a0f 100%);color:#edf2f7}.shell{min-height:100vh;display:grid;grid-template-columns:230px 1fr}.side{border-right:1px solid #222b36;padding:24px 18px;background:#0b1016;position:sticky;top:0;height:100vh}.brand{font-weight:900;font-size:20px;color:#ff9418;margin-bottom:28px}.brand span{color:#fff}.nav{display:grid;gap:8px}.nav div{padding:11px 12px;border-radius:10px;color:#9ba9b9}.nav .on{background:#2a2118;color:#ff9f2e}.main{padding:24px;max-width:1500px;width:100%;margin:auto}header{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:18px}h1{font-size:22px;margin:0}.health{display:flex;gap:8px;flex-wrap:wrap}.pill{border:1px solid #273444;border-radius:10px;padding:8px 10px;background:#101720;color:#9de7ba}.panel,.task,.login,.work,.kpi{background:linear-gradient(180deg,#131a23,#0f151d);border:1px solid #25303d;border-radius:16px;box-shadow:0 14px 36px #0005}.task,.login{padding:18px;margin-bottom:14px}.task label{font-size:12px;color:#9aa9ba;font-weight:800}.task textarea{display:block;width:100%;min-height:96px;margin:10px 0;background:#0d131a;color:#fff;border:1px solid #2a3542;border-radius:12px;padding:14px;font:inherit;resize:vertical}.task-actions{display:flex;gap:10px;justify-content:flex-end}.task select,.login input{background:#0d131a;color:#fff;border:1px solid #2a3542;border-radius:10px;padding:11px 12px}.task button,.login button{border:0;border-radius:10px;background:#ff8a00;color:#fff;font-weight:900;padding:11px 22px}.login{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.login input{flex:1;min-width:220px}.notice{padding:12px 14px;margin-bottom:14px;border:1px solid #285d43;background:#10241b;border-radius:12px;color:#b9f6d0}.notice.warn{border-color:#705122;background:#2b2111;color:#ffd28b}.notice a{color:#8bc7ff}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}.kpi{padding:16px}.kpi small{color:#91a0b1}.kpi b{display:block;font-size:28px;margin-top:5px}.layout{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(300px,.8fr);gap:14px}.panel{padding:16px;margin-bottom:14px}.panel h2{font-size:14px;margin:0 0 12px;color:#bec9d6}.works{display:grid;gap:10px}.work{padding:14px;box-shadow:none}.work-top{display:flex;justify-content:space-between;gap:8px}.status{font-size:12px;color:#7fc8ff}.work h3{margin:9px 0 8px;font-size:15px}.meta{font-size:12px;color:#8d9baa}.ai{display:grid;gap:9px}.ai-row{display:flex;justify-content:space-between;gap:10px;border:1px solid #25303d;border-radius:12px;padding:12px;background:#101720}.ai-row small{color:#8493a5}.good{color:#65e6a0}.wait{color:#ffc15c}.server-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.server-grid>div{border:1px solid #25303d;border-radius:12px;padding:12px;background:#101720;min-width:0}.server-grid small,.server-grid span{display:block;color:#8493a5;font-size:12px}.server-grid b{display:block;margin:5px 0;overflow-wrap:anywhere}.server-grid .activity{grid-column:span 4}.footer{padding:18px 0 4px;color:#607082;font-size:12px}
@media(max-width:900px){.shell{display:block}.side{display:none}.main{padding:14px 12px 82px}.layout{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}.server-grid{grid-template-columns:repeat(2,1fr)}.server-grid .activity{grid-column:span 2}header{align-items:flex-start}.health{justify-content:flex-end}.task-actions{position:sticky;bottom:10px}.task button{flex:1}.task select{width:40%}.work h3{font-size:14px}.panel{border-radius:14px}}
@media(max-width:520px){h1{font-size:18px}.health .pill:nth-child(n+2){display:none}.kpi{padding:13px}.kpi b{font-size:23px}.task textarea{min-height:120px}.login{display:grid}.login input{min-width:0;width:100%}.ai-row{font-size:13px}.server-grid{grid-template-columns:1fr}.server-grid .activity{grid-column:auto}}
</style></head><body><div class="shell"><aside class="side"><div class="brand">🐯 TIGERIQ <span>AI LAB</span></div><div class="nav"><div class="on">⌂ Tổng quan</div><div>▣ Work Order</div><div>✦ AI System</div><div>▥ Evidence</div><div>▤ Báo cáo</div><div>⚙ Cài đặt</div></div></aside><main class="main"><header><div><h1>Tổng quan Command Center</h1><small>Local First · PC01 là trung tâm điều phối & thực thi</small></div><div class="health"><span class="pill">● PC01 / Private</span><span class="pill">Tự làm mới 15s</span></div></header>${submittedNotice}${taskPanel}<section class="kpis"><div class="kpi"><small>Đang xử lý</small><b>${summary.activeWorkOrders}</b></div><div class="kpi"><small>Vướng / Chờ</small><b>${summary.blockedWorkOrders}</b></div><div class="kpi"><small>Gate lỗi/chặn</small><b>${summary.failingGates}</b></div><div class="kpi"><small>Evidence</small><b>${summary.evidenceCount}</b></div></section><section class="panel"><h2>PC01 SERVER</h2>${serverPanel}</section><section class="layout"><div class="panel"><h2>WORK ORDER</h2><div class="works">${workCards || '<div class="notice">Chưa có Work Order trong datasource hiện tại.</div>'}</div></div><div class="panel"><h2>AI SYSTEM</h2><div class="ai"><div class="ai-row"><span>ChatGPT</span><small class="wait">Chưa kết nối account automation</small></div><div class="ai-row"><span>Gemini</span><small class="wait">Chưa kết nối account automation</small></div><div class="ai-row"><span>Claude</span><small class="wait">Chưa kết nối</small></div><div class="ai-row"><span>Ollama · qwen2.5-coder:14b</span><small class="good">Local worker</small></div><div class="ai-row"><span>Model Router</span><small>Cloud mesh đã chuẩn bị · live credential còn gate</small></div></div></div></section><div class="footer">TigerIQ AI Lab Command Center · private/local-first · MAIN/Production không tự động thay đổi</div></main></div></body></html>`;
}

function renderMessage(title: string, message: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Quay lại</a></p></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
