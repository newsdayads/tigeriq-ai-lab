import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServerTelemetry, WorkforceEmployeeTelemetry } from './server.js';

type DashboardWorkOrder = {
  id: string;
  project: string;
  goal: string;
  status: string;
  latestGateStatus: string | null;
  evidenceCount: number;
};

type DashboardSummary = {
  workOrders: DashboardWorkOrder[];
  evidenceCount: number;
};

type AiFilter = 'all' | 'busy' | 'idle' | 'offline' | 'degraded';

export interface OwnerCockpitV4Options {
  backendUrl: string;
  host?: string;
  port?: number;
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
  const upstream = await fetch(`${backendUrl}${req.url ?? '/'}`, { method: req.method, headers: h, body: await readBody(req), redirect: 'manual' });
  const extra: Record<string, string> = {};
  const location = upstream.headers.get('location');
  const cookie = upstream.headers.get('set-cookie');
  if (location) extra.location = location;
  if (cookie) extra['set-cookie'] = cookie;
  respond(res, upstream.status, upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8', await upstream.text(), extra);
}

function cls(value: string): string {
  if (['verified', 'completed', 'idle'].includes(value)) return 'good';
  if (['failed', 'offline'].includes(value)) return 'danger';
  if (['blocked', 'degraded'].includes(value)) return 'wait';
  if (['running', 'busy', 'assigned', 'queued', 'approved'].includes(value)) return 'active';
  return 'muted';
}

function label(value: string): string {
  const map: Record<string, string> = {
    draft: 'Việc mới', approved: 'Đã duyệt', running: 'Đang làm', failed: 'Lỗi', blocked: 'Vướng / Chờ', verified: 'Hoàn thành',
    queued: 'Xếp hàng', assigned: 'Đã giao', completed: 'Hoàn thành', busy: 'Đang bận', idle: 'Đang rảnh', offline: 'Offline', degraded: 'Suy giảm',
  };
  return map[value] ?? value;
}

function syntheticVy(summary: DashboardSummary): WorkforceEmployeeTelemetry {
  const active = summary.workOrders.filter((item) => item.status !== 'verified');
  return {
    employeeId: 'vy-chief-of-staff', displayName: 'Vy', department: 'Điều hành', role: 'AI Chief of Staff', nodeId: 'web-control', provider: 'TigerIQ', model: null,
    availability: active.length ? 'busy' : 'idle', healthScore: 100, concurrencyLimit: 99, activeTaskCount: active.length, currentTaskIds: active.map((item) => item.id),
  };
}

function taskFor(id: string, telemetry: ServerTelemetry) {
  return telemetry.workforce?.taskList?.find((task) => task.taskId === id || task.taskId.includes(id));
}

function taskName(id: string, telemetry: ServerTelemetry): string {
  return telemetry.workforce?.taskList?.find((task) => task.taskId === id)?.objective ?? id;
}

function ownerFor(id: string, telemetry: ServerTelemetry): string {
  const task = taskFor(id, telemetry);
  if (!task?.assignedEmployeeId) return 'Vy · điều phối';
  return telemetry.workforce?.roster?.find((employee) => employee.employeeId === task.assignedEmployeeId)?.displayName ?? task.assignedEmployeeId;
}

function metric(labelText: string, value: string, hint: string, tone: string): string {
  return `<article class="metric ${tone}"><span>${esc(labelText)}</span><b>${esc(value)}</b><small>${esc(hint)}</small></article>`;
}

function render(summary: DashboardSummary, telemetry: ServerTelemetry, backendHtml: string, url: URL): string {
  const csrf = backendHtml.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
  const loginNeeded = backendHtml.includes('name="secret"');
  const active = summary.workOrders.filter((item) => item.status !== 'verified');
  const done = summary.workOrders.filter((item) => item.status === 'verified').length;
  const ownerNeeds = summary.workOrders.filter((item) => item.status === 'blocked' || item.latestGateStatus === 'fail' || item.latestGateStatus === 'blocked');
  const errors = summary.workOrders.filter((item) => item.status === 'failed' || item.latestGateStatus === 'fail').length;
  const roster = telemetry.workforce?.roster ?? [];
  const allAi = [syntheticVy(summary), ...roster.filter((employee) => employee.employeeId !== 'vy-chief-of-staff')];
  const query = (url.searchParams.get('ai') ?? '').trim().toLocaleLowerCase('vi-VN');
  const requested = (url.searchParams.get('state') ?? 'all') as AiFilter;
  const state: AiFilter = ['all', 'busy', 'idle', 'offline', 'degraded'].includes(requested) ? requested : 'all';
  const filtered = allAi.filter((employee) => {
    const stateMatch = state === 'all' || employee.availability === state;
    const haystack = `${employee.displayName} ${employee.role} ${employee.department} ${employee.model ?? ''} ${employee.provider ?? ''}`.toLocaleLowerCase('vi-VN');
    return stateMatch && (!query || haystack.includes(query));
  });
  const models = telemetry.ollama?.models ?? [];
  const busy = allAi.filter((employee) => employee.availability === 'busy').length;
  const idle = allAi.filter((employee) => employee.availability === 'idle').length;
  const unavailable = allAi.filter((employee) => ['offline', 'degraded'].includes(employee.availability)).length;
  const systemOk = Boolean(telemetry.available && telemetry.worker?.online && telemetry.ollama?.online && telemetry.tailscale?.online);

  const command = csrf ? `<form class="goal-box" method="post" action="/jobs"><div class="goal-copy"><span class="kicker">GIAO VIỆC CHO VY</span><h2>Anh Sơn nói mục tiêu. Vy tự điều phối phần còn lại.</h2><p>Tự tạo Work Order → chọn AI/model → kiểm tra evidence → chỉ gọi anh khi có quyết định.</p></div><div class="goal-input"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="idempotency" value="v4-${Date.now()}-${Math.random().toString(36).slice(2, 18)}"><textarea name="instruction" maxlength="8000" required placeholder="Ví dụ: Hoàn thiện WebControl theo mockup và chỉ báo khi cần tôi quyết định."></textarea><div class="goal-actions"><select name="priority"><option>Bình thường</option><option>Cao</option><option>Khẩn cấp</option><option>Thấp</option></select><button type="submit">GIAO VIỆC <b>→</b></button></div></div></form>`
    : loginNeeded ? `<form class="login-box" method="post" action="/login"><div><span class="kicker">QUYỀN ĐIỀU KHIỂN</span><b>Đăng nhập để giao việc cho Vy</b></div><input type="password" name="secret" placeholder="Mã điều khiển local" required><button type="submit">ĐĂNG NHẬP</button></form>`
      : `<div class="readonly">Web đang ở chế độ chỉ xem.</div>`;

  const workCards = active.length ? active.slice(0, 12).map((item) => {
    const task = taskFor(item.id, telemetry);
    const stage = task?.stage ?? item.status;
    return `<article class="work-card"><div class="work-top"><span class="wo">${esc(item.id)}</span><span class="pill ${cls(stage)}">${esc(label(stage))}</span></div><h3>${esc(item.goal)}</h3><div class="work-meta"><span>👤 ${esc(ownerFor(item.id, telemetry))}</span><span>◫ ${item.evidenceCount} evidence</span><span>⌁ ${esc(item.project)}</span></div><div class="progress"><i class="${cls(stage)}"></i></div></article>`;
  }).join('') : `<div class="empty-big"><b>Chưa có công việc đang chạy</b><span>Giao một mục tiêu cho Vy để bắt đầu.</span></div>`;

  const ownerCards = ownerNeeds.length ? ownerNeeds.slice(0, 6).map((item) => `<article class="attention-item"><div><span>${esc(item.id)}</span><b>${esc(item.goal)}</b><small>${item.status === 'blocked' ? 'Work Order đang bị chặn' : 'Gate chưa đạt'} · ${item.evidenceCount} evidence</small></div><em>CẦN XEM</em></article>`).join('') : `<div class="all-clear"><div class="check">✓</div><div><b>Không có việc cần anh Sơn</b><span>Vy đang tự xử lý trong phạm vi được phép.</span></div></div>`;

  const aiRows = filtered.length ? filtered.map((employee) => {
    const tasks = employee.currentTaskIds.length ? employee.currentTaskIds.slice(0, 2).map((id) => taskName(id, telemetry)).join(' · ') : 'Đang rảnh';
    const initials = employee.displayName.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase();
    return `<div class="ai-row"><div class="identity"><span class="avatar">${esc(initials || 'AI')}</span><div><b>${esc(employee.displayName)}</b><small>${esc(employee.role)}</small></div></div><div class="model"><span>${esc(employee.model ?? employee.provider ?? 'Chưa gán model')}</span><small>${esc(employee.department)}</small></div><div class="current"><b>${esc(tasks)}</b><small>${employee.currentTaskIds.length ? esc(employee.currentTaskIds.join(', ')) : 'Không có task active'}</small></div><span class="pill ${cls(employee.availability)}">${esc(label(employee.availability))}</span><span class="load">${employee.activeTaskCount}/${employee.concurrencyLimit}</span></div>`;
  }).join('') : `<div class="empty-row">Không có AI phù hợp bộ lọc.</div>`;

  const modelCards = models.length ? models.slice(0, 12).map((model) => {
    const users = roster.filter((employee) => employee.model?.toLowerCase() === model.toLowerCase()).map((employee) => employee.displayName);
    return `<article class="model-card"><div class="model-icon">◈</div><div><b>${esc(model)}</b><span>Ollama Local</span><small>${users.length ? `Đang dùng: ${esc(users.join(', '))}` : 'Chưa gán AI'}</small></div><i class="${telemetry.ollama?.online ? 'on' : 'off'}"></i></article>`;
  }).join('') : `<div class="empty-row">Chưa đọc được danh sách model Ollama.</div>`;

  const service = (name: string, ok: boolean | undefined, note = '') => `<div class="service"><i class="${ok ? 'on' : 'off'}"></i><div><b>${esc(name)}</b><small>${esc(note || (ok ? 'Online' : 'Offline'))}</small></div></div>`;
  const services = [
    service('PC01', telemetry.available, telemetry.available ? 'Telemetry live' : 'Chưa có telemetry'),
    service('Native Worker', telemetry.worker?.online, telemetry.worker?.pid ? `PID ${telemetry.worker.pid}` : ''),
    service('Ollama', telemetry.ollama?.online, `${models.length} model`),
    service('Tailscale', telemetry.tailscale?.online, telemetry.tailscale?.ip ?? ''),
    service('Controller', telemetry.controller?.online, telemetry.controller?.port ? `Port ${telemetry.controller.port}` : ''),
    service('PostgreSQL', telemetry.postgresql?.online, telemetry.postgresql?.service ?? ''),
  ].join('');

  const statCards = [
    metric('ĐANG LÀM', String(active.length), 'Work Order đang xử lý', 'blue'),
    metric('CẦN ANH SƠN', String(ownerNeeds.length), 'Quyết định / phê duyệt', 'amber'),
    metric('HOÀN THÀNH', String(done), 'Work Order đã verified', 'green'),
    metric('LỖI / BLOCKER', String(errors), 'Không claim PASS khi còn lỗi', 'red'),
  ].join('');

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>TigerIQ Owner Cockpit V4</title><style>
:root{font-family:"Segoe UI Variable","Segoe UI",Arial,sans-serif;--bg:#071019;--panel:#0d1824;--panel2:#101e2c;--line:#203246;--text:#f5f8fb;--muted:#8295aa;--orange:#ff9b21;--orange2:#ff7d00;--green:#35d990;--blue:#55aaff;--yellow:#ffc45e;--red:#ff6375;color:var(--text);background:var(--bg)}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -10%,#203a55 0,#0b1622 28%,#071019 68%);font-size:14px;line-height:1.45;color:var(--text)}a{color:inherit}.wrap{max-width:1560px;margin:auto;padding:0 26px 42px}.topnav{height:76px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a2a3b;gap:18px}.brand{display:flex;align-items:center;gap:11px;font-size:18px;font-weight:900;white-space:nowrap}.brand-mark{width:39px;height:39px;border-radius:12px;background:linear-gradient(145deg,#ffb044,#ff7d00);display:grid;place-items:center;color:#111;font-size:20px;box-shadow:0 8px 24px #ff8a0028}.brand span{color:var(--orange)}.navlinks{display:flex;gap:4px;align-items:center}.navlinks a{text-decoration:none;color:#8498ad;padding:9px 12px;border-radius:10px;font-size:12px}.navlinks a.on{color:#fff;background:#132235}.status{display:flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid #28553f;background:#0b2218;border-radius:999px;color:#91edba;font-size:11px;white-space:nowrap}.status.warn{border-color:#614722;background:#281d0e;color:#ffd181}.status i{width:7px;height:7px;border-radius:50%;background:currentColor}.hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(430px,.9fr);gap:18px;padding:28px 0 18px}.hero-copy{padding:10px 4px}.kicker{font-size:10px;letter-spacing:.15em;color:#7d93aa;font-weight:900}.hero h1{font-size:36px;line-height:1.08;margin:8px 0 10px;max-width:760px}.hero p{margin:0;color:#8fa2b5;max-width:720px;font-size:15px}.goal-box,.login-box,.readonly{background:linear-gradient(145deg,#111f2d,#0b151f);border:1px solid #2a3a4c;border-radius:20px;box-shadow:0 18px 50px #0005}.goal-box{padding:18px}.goal-copy h2{font-size:16px;margin:4px 0}.goal-copy p{font-size:11px;color:#8194a8;margin:0 0 12px}.goal-input textarea{width:100%;min-height:84px;resize:vertical;border:1px solid #31465d;border-radius:12px;background:#07111b;color:#fff;padding:12px 13px;font:inherit;outline:none}.goal-input textarea:focus{border-color:#ff9b21;box-shadow:0 0 0 3px #ff9b2117}.goal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:9px}.goal-actions select,.login-box input{background:#07111b;color:#fff;border:1px solid #31465d;border-radius:10px;padding:10px 11px}.goal-actions button,.login-box button{border:0;border-radius:10px;background:linear-gradient(135deg,#ffad35,#ff7d00);color:#171008;font-weight:900;padding:10px 15px;cursor:pointer}.login-box{padding:18px;display:flex;align-items:center;gap:10px}.login-box>div{margin-right:auto}.login-box b{display:block;margin-top:3px}.readonly{padding:20px;color:#ffd184}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}.metric{position:relative;overflow:hidden;border:1px solid var(--line);background:linear-gradient(160deg,#101d2a,#0b151f);border-radius:16px;padding:17px 18px}.metric:after{content:"";position:absolute;right:-32px;top:-35px;width:100px;height:100px;border-radius:50%;background:currentColor;opacity:.055}.metric span{font-size:10px;font-weight:900;letter-spacing:.09em;color:#8295a8}.metric b{display:block;font-size:31px;line-height:1.05;margin:7px 0 3px}.metric small{color:#74879a}.metric.blue b{color:var(--blue)}.metric.amber b{color:var(--yellow)}.metric.green b{color:var(--green)}.metric.red b{color:var(--red)}.workspace{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(350px,.72fr);gap:14px;margin-bottom:16px}.card{background:linear-gradient(180deg,#0f1b27,#0a141e);border:1px solid var(--line);border-radius:18px;box-shadow:0 18px 40px #0003;min-width:0}.card-head{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #1d2d3d}.card-head h2{font-size:13px;letter-spacing:.04em;margin:0}.card-head span{font-size:11px;color:#778b9f}.work-list{padding:10px;display:grid;gap:8px;max-height:510px;overflow:auto}.work-card{border:1px solid #243649;background:#0b1621;border-radius:14px;padding:14px}.work-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.wo{font-size:10px;color:#ffad51;font-weight:900;letter-spacing:.05em}.work-card h3{font-size:15px;margin:8px 0 10px}.work-meta{display:flex;gap:16px;flex-wrap:wrap;color:#8396aa;font-size:11px}.progress{height:4px;background:#182637;border-radius:9px;margin-top:12px;overflow:hidden}.progress i{display:block;height:100%;width:62%;background:var(--blue)}.progress i.good{background:var(--green);width:100%}.progress i.wait{background:var(--yellow);width:45%}.progress i.danger{background:var(--red);width:30%}.attention{border-color:#4a3820;background:linear-gradient(180deg,#18180f,#0d151b)}.attention .card-head{border-bottom-color:#3a2e1d}.attention-list{padding:10px;display:grid;gap:8px}.attention-item{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #4d3b23;background:#20190f;border-radius:13px;padding:13px}.attention-item div{min-width:0}.attention-item span{display:block;color:#ffad51;font-size:10px}.attention-item b{display:block;margin:4px 0;font-size:13px}.attention-item small{display:block;color:#9d8d78}.attention-item em{font-style:normal;color:#ffd181;border:1px solid #6b512c;background:#302412;border-radius:999px;padding:5px 8px;font-size:9px;font-weight:900;white-space:nowrap}.all-clear{display:flex;gap:12px;align-items:center;border:1px solid #28533e;background:#0c2118;border-radius:13px;padding:16px}.all-clear .check{width:34px;height:34px;border-radius:10px;background:#123c29;color:#55e39b;display:grid;place-items:center;font-size:18px}.all-clear b,.all-clear span{display:block}.all-clear span{color:#82a992;font-size:11px;margin-top:2px}.empty-big{min-height:180px;display:grid;place-items:center;align-content:center;text-align:center;color:#75899d}.empty-big b,.empty-big span{display:block}.empty-big b{color:#aab9c8;font-size:15px}.workforce{margin-bottom:16px}.workforce-summary{display:flex;gap:8px;flex-wrap:wrap}.summary-chip{padding:6px 9px;border-radius:999px;background:#101e2b;border:1px solid #293b4d;color:#91a3b5;font-size:10px}.summary-chip b{color:#fff}.filters{display:flex;gap:8px;padding:12px 18px;border-bottom:1px solid #1d2d3d}.filters input,.filters select{background:#08131d;border:1px solid #2b3e52;color:#fff;border-radius:10px;padding:9px 10px}.filters input{min-width:260px;flex:1}.filters button{border:1px solid #684821;background:#261a0e;color:#ffb45b;border-radius:10px;padding:9px 13px;cursor:pointer}.ai-head,.ai-row{display:grid;grid-template-columns:minmax(190px,1.15fr) minmax(160px,.9fr) minmax(260px,1.7fr) 105px 58px;gap:14px;align-items:center}.ai-head{padding:9px 18px;color:#6f8498;font-size:9px;font-weight:900;letter-spacing:.06em}.ai-row{padding:12px 18px;border-top:1px solid #1c2b39}.identity{display:flex;align-items:center;gap:10px}.avatar{width:38px;height:38px;border-radius:12px;background:linear-gradient(145deg,#1c3145,#102131);border:1px solid #31506a;color:#a7d4ff;display:grid;place-items:center;font-size:10px;font-weight:900}.identity b,.identity small,.model span,.model small,.current b,.current small{display:block}.identity small,.model small,.current small{color:#74899e;font-size:10px;margin-top:2px}.current{min-width:0}.current b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pill{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:5px 8px;font-size:9px;font-weight:900;border:1px solid #33465a;white-space:nowrap}.pill.good{color:#78e9ad;border-color:#2b684b;background:#0d251a}.pill.active{color:#83c4ff;border-color:#2b5b86;background:#0d2032}.pill.wait{color:#ffd07c;border-color:#6a5229;background:#2b2110}.pill.danger{color:#ff9ba5;border-color:#6c3640;background:#2b1519}.pill.muted{color:#9ba9b8}.load{font-variant-numeric:tabular-nums;color:#899cad}.empty-row{padding:22px;text-align:center;color:#768b9f}.models{margin-bottom:16px}.model-grid{padding:12px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.model-card{display:flex;align-items:center;gap:10px;border:1px solid #243649;background:#0b1621;border-radius:13px;padding:12px}.model-icon{width:36px;height:36px;border-radius:10px;background:#17283a;color:#8fc7ff;display:grid;place-items:center}.model-card>div:nth-child(2){min-width:0;flex:1}.model-card b,.model-card span,.model-card small{display:block}.model-card b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.model-card span,.model-card small{color:#758a9e;font-size:10px;margin-top:2px}.model-card i,.service>i{width:8px;height:8px;border-radius:50%;background:#667}.model-card i.on,.service>i.on{background:var(--green);box-shadow:0 0 0 4px #35d99013}.model-card i.off,.service>i.off{background:var(--red)}.runtime{background:#09131d;border:1px solid #1f3041;border-radius:16px;overflow:hidden}.runtime summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;padding:14px 16px}.runtime summary::-webkit-details-marker{display:none}.runtime summary b{font-size:12px}.runtime summary span{color:#778a9d;font-size:10px}.services{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;padding:12px 16px;border-top:1px solid #1b2b3a}.service{display:flex;align-items:center;gap:8px;border:1px solid #223446;border-radius:11px;padding:10px;background:#0b1722}.service b,.service small{display:block}.service b{font-size:11px}.service small{color:#71879b;font-size:9px}.runtime-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 16px 14px}.runtime-metrics div{border:1px solid #203143;border-radius:11px;padding:11px;background:#0a1620}.runtime-metrics span,.runtime-metrics b{display:block}.runtime-metrics span{font-size:9px;color:#71869a}.runtime-metrics b{font-size:15px;margin-top:3px}@media(max-width:1100px){.hero{grid-template-columns:1fr}.workspace{grid-template-columns:1fr}.model-grid{grid-template-columns:repeat(2,1fr)}.services{grid-template-columns:repeat(3,1fr)}.navlinks{display:none}}@media(max-width:720px){.wrap{padding:0 14px 28px}.topnav{height:66px}.hero{padding-top:18px}.hero h1{font-size:28px}.stats{grid-template-columns:repeat(2,1fr)}.model-grid{grid-template-columns:1fr}.ai-head{display:none}.ai-row{grid-template-columns:1fr auto;gap:8px}.ai-row .model,.ai-row .current{grid-column:1/-1}.load{grid-column:2}.filters{flex-wrap:wrap}.filters input{min-width:100%}.services{grid-template-columns:repeat(2,1fr)}.runtime-metrics{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.stats{grid-template-columns:1fr 1fr}.services{grid-template-columns:1fr}.runtime-metrics{grid-template-columns:1fr}.brand{font-size:15px}.status{font-size:9px}.goal-actions{flex-wrap:wrap}.goal-actions select,.goal-actions button{flex:1}.work-meta{gap:8px}}
</style></head><body><div class="wrap"><header class="topnav"><div class="brand"><div class="brand-mark">🐯</div><div><span>TIGERIQ</span> AI LAB</div></div><nav class="navlinks"><a class="on" href="#today">Tổng quan</a><a href="#work">Công việc</a><a href="#workforce">Đội AI</a><a href="#models">Mô hình AI</a><a href="#runtime">Hệ thống</a></nav><div class="status ${systemOk ? '' : 'warn'}"><i></i>${systemOk ? 'Hệ thống sẵn sàng' : 'Có hạng mục cần kiểm tra'}</div></header><main><section class="hero" id="today"><div class="hero-copy"><span class="kicker">OWNER COCKPIT V4 · MOCKUP IMPLEMENTATION</span><h1>Hôm nay TigerIQ đang làm gì cho anh Sơn?</h1><p>Một màn hình để nhìn ngay công việc, AI phụ trách, quyết định cần anh và kết quả. PC01 chỉ là hạ tầng phía sau.</p></div>${command}</section><section class="stats">${statCards}</section><section class="workspace" id="work"><div class="card"><div class="card-head"><h2>CÔNG VIỆC ĐANG CHẠY</h2><span>${active.length} Work Order</span></div><div class="work-list">${workCards}</div></div><aside class="card attention"><div class="card-head"><h2>CẦN ANH SƠN</h2><span>Chỉ việc cần quyết định</span></div><div class="attention-list">${ownerCards}</div></aside></section><section class="card workforce" id="workforce"><div class="card-head"><div><h2>AI WORKFORCE — AI ĐANG LÀM GÌ</h2><span>Hiển thị ${filtered.length}/${allAi.length} AI</span></div><div class="workforce-summary"><span class="summary-chip">Tổng AI <b>${allAi.length}</b></span><span class="summary-chip">Đang bận <b>${busy}</b></span><span class="summary-chip">Đang rảnh <b>${idle}</b></span><span class="summary-chip">Không sẵn sàng <b>${unavailable}</b></span></div></div><form class="filters" method="get"><input name="ai" value="${esc(url.searchParams.get('ai') ?? '')}" placeholder="Tìm AI / vai trò / model"><select name="state"><option value="all"${state === 'all' ? ' selected' : ''}>Tất cả trạng thái</option><option value="busy"${state === 'busy' ? ' selected' : ''}>Đang bận</option><option value="idle"${state === 'idle' ? ' selected' : ''}>Đang rảnh</option><option value="offline"${state === 'offline' ? ' selected' : ''}>Offline</option><option value="degraded"${state === 'degraded' ? ' selected' : ''}>Suy giảm</option></select><button type="submit">LỌC</button></form><div class="ai-head"><span>AI / VAI TRÒ</span><span>MODEL</span><span>ĐANG LÀM GÌ</span><span>TRẠNG THÁI</span><span>TẢI</span></div>${aiRows}</section><section class="card models" id="models"><div class="card-head"><div><h2>MÔ HÌNH AI HIỆN CÓ</h2><span>${models.length} model Ollama local</span></div><span>${telemetry.ollama?.online ? 'OLLAMA ONLINE' : 'OLLAMA OFFLINE'}</span></div><div class="model-grid">${modelCards}</div></section><details class="runtime" id="runtime"><summary><b>PC01 SERVER & SERVICES — HẠ TẦNG KỸ THUẬT</b><span>Mặc định thu gọn · chỉ mở khi cần kiểm tra</span></summary><div class="services">${services}</div><div class="runtime-metrics"><div><span>CPU</span><b>${telemetry.cpu?.utilizationPercent == null ? '—' : `${Math.round(telemetry.cpu.utilizationPercent)}%`}</b></div><div><span>RAM</span><b>${telemetry.memory?.utilizationPercent == null ? '—' : `${Math.round(telemetry.memory.utilizationPercent)}%`}</b></div><div><span>DISK ${esc(telemetry.disk?.drive ?? '')}</span><b>${telemetry.disk?.utilizationPercent == null ? '—' : `${Math.round(telemetry.disk.utilizationPercent)}%`}</b></div><div><span>GPU</span><b>${esc(telemetry.gpu?.name ?? 'Chưa có dữ liệu')}</b></div></div></details></main></div></body></html>`;
}

export async function startOwnerCockpitV4(options: OwnerCockpitV4Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public bind is forbidden');
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && (url.pathname === '/api/status' || url.pathname === '/api/server')) return proxy(options.backendUrl, req, res);
      if (req.method === 'POST' && (url.pathname === '/login' || url.pathname === '/jobs')) return proxy(options.backendUrl, req, res);
      if (req.method === 'GET' && url.pathname === '/') {
        const cookieHeaders = req.headers.cookie ? { cookie: req.headers.cookie } : undefined;
        const [summaryResponse, telemetryResponse, backendResponse] = await Promise.all([
          fetch(`${options.backendUrl}/api/status`),
          fetch(`${options.backendUrl}/api/server`),
          fetch(`${options.backendUrl}/`, { headers: cookieHeaders }),
        ]);
        if (!summaryResponse.ok || !telemetryResponse.ok || !backendResponse.ok) throw new Error('backend_unavailable');
        const summary = await summaryResponse.json() as DashboardSummary;
        const telemetry = await telemetryResponse.json() as ServerTelemetry;
        const backendHtml = await backendResponse.text();
        return respond(res, 200, 'text/html; charset=utf-8', render(summary, telemetry, backendHtml, url));
      }
      return respond(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not_found' }));
    } catch {
      return respond(res, 503, 'application/json; charset=utf-8', JSON.stringify({ error: 'owner_cockpit_unavailable' }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
