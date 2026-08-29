import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WorkOrderSnapshot } from '../../../packages/control-plane/src/index.js';
import { buildDashboard } from './index.js';

const execFileAsync = promisify(execFile);

export interface DashboardSource {
  list(): WorkOrderSnapshot[] | Promise<WorkOrderSnapshot[]>;
}

export interface CommandCenterOptions {
  host?: string;
  port?: number;
  commandSecret?: string;
  repo?: string;
  submitJob?: (instruction: string, priority: string) => Promise<string>;
}

type Session = { csrf: string; createdAt: number };
type IdempotentResult = { fingerprint: string; url: string };

const sessions = new Map<string, Session>();
const submissions = new Map<string, IdempotentResult>();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16_384;
const MAX_INSTRUCTION = 8_000;

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

function assertPrivateBind(host: string): void {
  if (host === '0.0.0.0' || host === '::') throw new Error('public wildcard bind is forbidden; use 127.0.0.1 or an explicit private/Tailscale address');
}

export async function startDashboard(source: DashboardSource, options: CommandCenterOptions = {}) {
  const host = options.host ?? '127.0.0.1';
  assertPrivateBind(host);
  const repo = options.repo ?? process.env.TIGERIQ_REPO ?? 'newsdayads/tigeriq-ai-lab';
  const commandSecret = options.commandSecret ?? process.env.TIGERIQ_COMMAND_SECRET ?? '';
  const createJob = options.submitJob ?? ((instruction: string, priority: string) => submitGithubJob(repo, instruction, priority));

  const server = createServer(async (request, response) => {
    cleanExpiredState();
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;

    try {
      if (request.method === 'GET' && path === '/api/status') {
        return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(buildDashboard(await source.list())));
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
        const session = getSession(request);
        const submitted = url.searchParams.get('submitted');
        return respond(response, 200, 'text/html; charset=utf-8', render(summary, session, Boolean(commandSecret), submitted));
      }

      return respond(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not_found' }));
    } catch {
      return respond(response, 503, 'application/json; charset=utf-8', JSON.stringify({ error: 'command_center_unavailable' }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://${address.address}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Việc mới', planned: 'Đã lên kế hoạch', active: 'Đang làm', review: 'Đang kiểm tra', blocked: 'Vướng / Chờ', verified: 'Hoàn thành',
  };
  return labels[status] ?? status;
}

function render(summary: ReturnType<typeof buildDashboard>, session: Session | null, writeConfigured: boolean, submitted: string | null): string {
  const workCards = summary.workOrders.map((item) => `<article class="work"><div class="work-top"><b>${escapeHtml(item.id)}</b><span class="status">${escapeHtml(statusText(item.status))}</span></div><h3>${escapeHtml(item.goal)}</h3><div class="meta">Gate: ${escapeHtml(item.latestGate ?? 'chưa có')} · ${escapeHtml(item.latestGateStatus ?? '-')} · Evidence: ${item.evidenceCount}</div></article>`).join('');
  const submittedNotice = submitted && /^https:\/\/github\.com\//.test(submitted) ? `<div class="notice">✅ Đã đưa việc vào hàng đợi PC01: <a href="${escapeHtml(submitted)}">xem evidence</a></div>` : '';
  const taskPanel = session ? `<form class="task" method="post" action="/jobs"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="idempotency" value="${randomBytes(24).toString('base64url')}"><label>GIAO VIỆC CHO AI</label><textarea name="instruction" maxlength="8000" required placeholder="Ví dụ: Kiểm tra Tiger IQ Driver và tối ưu phần quyết toán Tùng"></textarea><div class="task-actions"><select name="priority"><option>Bình thường</option><option>Cao</option><option>Khẩn cấp</option><option>Thấp</option></select><button type="submit">🚀 GIAO VIỆC</button></div></form>` : writeConfigured ? `<form class="login" method="post" action="/login"><b>Mở quyền giao việc</b><input type="password" name="secret" autocomplete="current-password" placeholder="Mã điều khiển local" required><button type="submit">ĐĂNG NHẬP</button></form>` : `<div class="notice warn">🔒 Chế độ chỉ xem. Cần cấu hình TIGERIQ_COMMAND_SECRET trên PC01 để bật giao việc.</div>`;

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="refresh" content="15"><title>TigerIQ Command Center</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#edf2f7;background:#090d12}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 90% 0,#18202c 0,#0b1017 36%,#070a0f 100%);color:#edf2f7}.shell{min-height:100vh;display:grid;grid-template-columns:230px 1fr}.side{border-right:1px solid #222b36;padding:24px 18px;background:#0b1016;position:sticky;top:0;height:100vh}.brand{font-weight:900;font-size:20px;color:#ff9418;margin-bottom:28px}.brand span{color:#fff}.nav{display:grid;gap:8px}.nav div{padding:11px 12px;border-radius:10px;color:#9ba9b9}.nav .on{background:#2a2118;color:#ff9f2e}.main{padding:24px;max-width:1500px;width:100%;margin:auto}header{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:18px}h1{font-size:22px;margin:0}.health{display:flex;gap:8px;flex-wrap:wrap}.pill{border:1px solid #273444;border-radius:10px;padding:8px 10px;background:#101720;color:#9de7ba}.panel,.task,.login,.work,.kpi{background:linear-gradient(180deg,#131a23,#0f151d);border:1px solid #25303d;border-radius:16px;box-shadow:0 14px 36px #0005}.task,.login{padding:18px;margin-bottom:14px}.task label{font-size:12px;color:#9aa9ba;font-weight:800}.task textarea{display:block;width:100%;min-height:96px;margin:10px 0;background:#0d131a;color:#fff;border:1px solid #2a3542;border-radius:12px;padding:14px;font:inherit;resize:vertical}.task-actions{display:flex;gap:10px;justify-content:flex-end}.task select,.login input{background:#0d131a;color:#fff;border:1px solid #2a3542;border-radius:10px;padding:11px 12px}.task button,.login button{border:0;border-radius:10px;background:#ff8a00;color:#fff;font-weight:900;padding:11px 22px}.login{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.login input{flex:1;min-width:220px}.notice{padding:12px 14px;margin-bottom:14px;border:1px solid #285d43;background:#10241b;border-radius:12px;color:#b9f6d0}.notice.warn{border-color:#705122;background:#2b2111;color:#ffd28b}.notice a{color:#8bc7ff}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}.kpi{padding:16px}.kpi small{color:#91a0b1}.kpi b{display:block;font-size:28px;margin-top:5px}.layout{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(300px,.8fr);gap:14px}.panel{padding:16px}.panel h2{font-size:14px;margin:0 0 12px;color:#bec9d6}.works{display:grid;gap:10px}.work{padding:14px;box-shadow:none}.work-top{display:flex;justify-content:space-between;gap:8px}.status{font-size:12px;color:#7fc8ff}.work h3{margin:9px 0 8px;font-size:15px}.meta{font-size:12px;color:#8d9baa}.ai{display:grid;gap:9px}.ai-row{display:flex;justify-content:space-between;gap:10px;border:1px solid #25303d;border-radius:12px;padding:12px;background:#101720}.ai-row small{color:#8493a5}.good{color:#65e6a0}.wait{color:#ffc15c}.footer{padding:18px 0 4px;color:#607082;font-size:12px}
@media(max-width:900px){.shell{display:block}.side{display:none}.main{padding:14px 12px 82px}.layout{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}header{align-items:flex-start}.health{justify-content:flex-end}.task-actions{position:sticky;bottom:10px}.task button{flex:1}.task select{width:40%}.work h3{font-size:14px}.panel{border-radius:14px}}
@media(max-width:520px){h1{font-size:18px}.health .pill:nth-child(n+2){display:none}.kpi{padding:13px}.kpi b{font-size:23px}.task textarea{min-height:120px}.login{display:grid}.login input{min-width:0;width:100%}.ai-row{font-size:13px}}
</style></head><body><div class="shell"><aside class="side"><div class="brand">🐯 TIGERIQ <span>AI LAB</span></div><div class="nav"><div class="on">⌂ Tổng quan</div><div>▣ Work Order</div><div>✦ AI System</div><div>▥ Evidence</div><div>▤ Báo cáo</div><div>⚙ Cài đặt</div></div></aside><main class="main"><header><div><h1>Tổng quan Command Center</h1><small>Local First · PC01 là trung tâm điều phối & thực thi</small></div><div class="health"><span class="pill">● PC01 / Private</span><span class="pill">Tự làm mới 15s</span></div></header>${submittedNotice}${taskPanel}<section class="kpis"><div class="kpi"><small>Đang xử lý</small><b>${summary.activeWorkOrders}</b></div><div class="kpi"><small>Vướng / Chờ</small><b>${summary.blockedWorkOrders}</b></div><div class="kpi"><small>Gate lỗi/chặn</small><b>${summary.failingGates}</b></div><div class="kpi"><small>Evidence</small><b>${summary.evidenceCount}</b></div></section><section class="layout"><div class="panel"><h2>WORK ORDER</h2><div class="works">${workCards || '<div class="notice">Chưa có Work Order trong datasource hiện tại.</div>'}</div></div><div class="panel"><h2>AI SYSTEM</h2><div class="ai"><div class="ai-row"><span>ChatGPT</span><small class="wait">Chưa kết nối account automation</small></div><div class="ai-row"><span>Gemini</span><small class="wait">Chưa kết nối account automation</small></div><div class="ai-row"><span>Claude</span><small class="wait">Chưa kết nối</small></div><div class="ai-row"><span>Ollama · qwen2.5-coder:14b</span><small class="good">Local worker</small></div><div class="ai-row"><span>Model Router</span><small>Cloud mesh đã chuẩn bị · live credential còn gate</small></div></div></div></section><div class="footer">TigerIQ AI Lab Command Center · private/local-first · MAIN/Production không tự động thay đổi</div></main></div></body></html>`;
}

function renderMessage(title: string, message: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Quay lại</a></p></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
