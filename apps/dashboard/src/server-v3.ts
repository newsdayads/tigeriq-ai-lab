import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServerTelemetry, WorkforceEmployeeTelemetry, WorkforceTaskTelemetry } from './server.js';

type DashboardWorkOrder = {
  id: string;
  project: string;
  goal: string;
  status: string;
  latestGate: string | null;
  latestGateStatus: 'pass' | 'fail' | 'blocked' | null;
  evidenceCount: number;
  failingEvidence: number;
};

type DashboardSummary = {
  generatedAt: string;
  activeWorkOrders: number;
  blockedWorkOrders: number;
  failingGates: number;
  evidenceCount: number;
  releaseEligible: boolean;
  workOrders: DashboardWorkOrder[];
};

type AiFilter = 'all' | 'busy' | 'idle' | 'offline' | 'degraded';

export interface OwnerCockpitV3Options {
  backendUrl: string;
  host?: string;
  port?: number;
}

const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function respond(response: ServerResponse, status: number, contentType: string, body: string, extra: Record<string, string> = {}): void {
  response.writeHead(status, { ...securityHeaders, ...extra, 'content-type': contentType });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 64 * 1024) throw new Error('payload_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function backendFetch(backendUrl: string, path: string, request?: IncomingMessage, body?: Buffer): Promise<Response> {
  const headers = new Headers();
  const cookie = request?.headers.cookie;
  const contentType = request?.headers['content-type'];
  if (cookie) headers.set('cookie', cookie);
  if (typeof contentType === 'string') headers.set('content-type', contentType);
  return fetch(`${backendUrl}${path}`, {
    method: request?.method ?? 'GET',
    headers,
    body: body && body.length ? body : undefined,
    redirect: 'manual',
  });
}

async function proxy(backendUrl: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readBody(request);
  const upstream = await backendFetch(backendUrl, request.url ?? '/', request, body);
  const bytes = Buffer.from(await upstream.arrayBuffer());
  const extra: Record<string, string> = {};
  const location = upstream.headers.get('location');
  const setCookie = upstream.headers.get('set-cookie');
  if (location) extra.location = location;
  if (setCookie) extra['set-cookie'] = setCookie;
  respond(response, upstream.status, upstream.headers.get('content-type') ?? 'application/octet-stream', bytes.toString('utf8'), extra);
}

function statusClass(status: string): string {
  if (status === 'verified' || status === 'idle' || status === 'completed') return 'good';
  if (status === 'failed' || status === 'offline') return 'danger';
  if (status === 'blocked' || status === 'degraded') return 'wait';
  if (status === 'running' || status === 'busy' || status === 'assigned' || status === 'queued') return 'active';
  return 'muted';
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Việc mới', approved: 'Đã duyệt', running: 'Đang làm', failed: 'Lỗi', blocked: 'Vướng / Chờ', verified: 'Hoàn thành',
    queued: 'Đang xếp hàng', assigned: 'Đã giao AI', completed: 'Hoàn thành', cancelled: 'Đã hủy', busy: 'Đang bận', idle: 'Đang rảnh', offline: 'Offline', degraded: 'Suy giảm',
  };
  return labels[status] ?? status;
}

function displayTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('vi-VN', { hour12: false }) : value;
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
  return `${days}d ${hours}h ${mins}m`;
}

function taskForWorkOrder(workOrderId: string, telemetry: ServerTelemetry): WorkforceTaskTelemetry | undefined {
  return telemetry.workforce?.taskList?.find((row) => row.taskId === workOrderId || row.taskId.includes(workOrderId));
}

function ownerForWorkOrder(workOrderId: string, telemetry: ServerTelemetry): string {
  const task = taskForWorkOrder(workOrderId, telemetry);
  if (!task?.assignedEmployeeId) return 'Vy · điều phối';
  const employee = telemetry.workforce?.roster?.find((row) => row.employeeId === task.assignedEmployeeId);
  return employee?.displayName ?? task.assignedEmployeeId;
}

function taskObjective(taskId: string, telemetry: ServerTelemetry): string {
  return telemetry.workforce?.taskList?.find((row) => row.taskId === taskId)?.objective ?? taskId;
}

function avatar(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase().slice(0, 2) || 'AI';
}

function syntheticVy(summary: DashboardSummary): WorkforceEmployeeTelemetry {
  const active = summary.workOrders.filter((item) => item.status !== 'verified');
  return {
    employeeId: 'vy-chief-of-staff',
    displayName: 'Vy',
    department: 'Điều hành',
    role: 'AI Chief of Staff',
    nodeId: 'web-control',
    provider: 'TigerIQ',
    model: null,
    availability: active.length ? 'busy' : 'idle',
    healthScore: 100,
    concurrencyLimit: 99,
    activeTaskCount: active.length,
    currentTaskIds: active.map((item) => item.id),
  };
}

function render(summary: DashboardSummary, telemetry: ServerTelemetry, backendHtml: string, url: URL): string {
  const csrf = backendHtml.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
  const hasLogin = backendHtml.includes('name="secret"');
  const activeWork = summary.workOrders.filter((item) => item.status !== 'verified');
  const completed = summary.workOrders.filter((item) => item.status === 'verified').length;
  const needsOwner = summary.workOrders.filter((item) => item.status === 'blocked' || item.latestGateStatus === 'fail' || item.latestGateStatus === 'blocked');
  const blockers = summary.workOrders.filter((item) => item.status === 'failed' || item.latestGateStatus === 'fail').length;
  const roster = telemetry.workforce?.roster ?? [];
  const allAi = [syntheticVy(summary), ...roster.filter((row) => row.employeeId !== 'vy-chief-of-staff')];
  const aiQuery = (url.searchParams.get('ai') ?? '').trim().slice(0, 100);
  const requestedState = (url.searchParams.get('state') ?? 'all') as AiFilter;
  const aiState: AiFilter = ['all', 'busy', 'idle', 'offline', 'degraded'].includes(requestedState) ? requestedState : 'all';
  const query = aiQuery.toLocaleLowerCase('vi-VN');
  const filteredAi = allAi.filter((employee) => {
    const stateMatch = aiState === 'all' || employee.availability === aiState;
    const text = `${employee.displayName} ${employee.employeeId} ${employee.role} ${employee.department} ${employee.provider ?? ''} ${employee.model ?? ''}`.toLocaleLowerCase('vi-VN');
    return stateMatch && (!query || text.includes(query));
  });
  const modelList = telemetry.ollama?.models ?? [];
  const submitted = url.searchParams.get('submitted') ?? '';
  const submittedNotice = /^https:\/\/github\.com\//.test(submitted)
    ? `<div class="flash">✓ Vy đã nhận việc. <a href="${escapeHtml(submitted)}">Mở evidence</a></div>` : '';

  const taskPanel = csrf
    ? `<form class="command" method="post" action="/jobs"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="idempotency" value="${escapeHtml(`${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`)}"><div class="command-copy"><span class="eyebrow">GIAO VIỆC CHO VY</span><h2>Anh Sơn chỉ cần nói mục tiêu.</h2><p>Vy tự chia việc, chọn AI/model, theo dõi evidence và chỉ gọi anh khi cần quyết định.</p></div><div class="command-input"><textarea name="instruction" maxlength="8000" required placeholder="Nhập mục tiêu cần TigerIQ xử lý…"></textarea><div class="command-actions"><select name="priority"><option>Bình thường</option><option>Cao</option><option>Khẩn cấp</option><option>Thấp</option></select><button type="submit">GIAO VIỆC →</button></div></div></form>`
    : hasLogin
      ? `<form class="login" method="post" action="/login"><div><span class="eyebrow">MỞ QUYỀN ĐIỀU KHIỂN</span><b>Đăng nhập để giao việc cho Vy</b></div><input type="password" name="secret" autocomplete="current-password" placeholder="Mã điều khiển local" required><button type="submit">ĐĂNG NHẬP</button></form>`
      : `<div class="flash warn">Web đang ở chế độ chỉ xem. Chưa cấu hình mã điều khiển local.</div>`;

  const workRows = activeWork.length ? activeWork.map((item) => {
    const task = taskForWorkOrder(item.id, telemetry);
    return `<tr><td><b>${escapeHtml(item.id)}</b><small>${escapeHtml(item.project)}</small></td><td><strong>${escapeHtml(item.goal)}</strong><small>${item.evidenceCount} evidence · Gate ${escapeHtml(item.latestGateStatus ?? 'chưa có')}</small></td><td><span class="owner">${escapeHtml(ownerForWorkOrder(item.id, telemetry))}</span></td><td>${task ? `<span class="chip ${statusClass(task.stage)}">${escapeHtml(statusText(task.stage))}</span>` : '<span class="muted">Chưa gán runtime</span>'}</td><td><span class="chip ${statusClass(item.status)}">${escapeHtml(statusText(item.status))}</span></td></tr>`;
  }).join('') : `<tr><td colspan="5" class="empty"><b>Chưa có Work Order đang chạy.</b><span>Giao mục tiêu cho Vy để bắt đầu.</span></td></tr>`;

  const ownerRows = needsOwner.length ? needsOwner.slice(0, 6).map((item) => `<article class="owner-action"><div><span>${escapeHtml(item.id)}</span><h3>${escapeHtml(item.goal)}</h3><p>${item.status === 'blocked' ? 'Work Order đang bị chặn.' : 'Gate cần xem lại.'} · ${item.evidenceCount} evidence</p></div><b>CẦN XEM</b></article>`).join('') : `<div class="owner-clear"><span>✓</span><div><b>Không có việc cần anh Sơn</b><small>Vy đang tự xử lý trong phạm vi được phép.</small></div></div>`;

  const aiRows = filteredAi.length ? filteredAi.map((employee) => {
    const current = employee.currentTaskIds.length ? employee.currentTaskIds.slice(0, 2).map((id) => taskObjective(id, telemetry)).join(' · ') : 'Đang rảnh';
    return `<tr><td><div class="person"><span class="avatar">${escapeHtml(avatar(employee.displayName))}</span><div><b>${escapeHtml(employee.displayName)}</b><small>${escapeHtml(employee.employeeId)}</small></div></div></td><td>${escapeHtml(employee.role)}<small>${escapeHtml(employee.department)}</small></td><td>${escapeHtml(employee.model ?? employee.provider ?? 'Chưa gán model')}</td><td><strong>${escapeHtml(current)}</strong><small>${employee.currentTaskIds.length ? escapeHtml(employee.currentTaskIds.join(', ')) : 'Không có task active'}</small></td><td><span class="chip ${statusClass(employee.availability)}">${escapeHtml(statusText(employee.availability))}</span></td><td>${employee.activeTaskCount}/${employee.concurrencyLimit}</td></tr>`;
  }).join('') : `<tr><td colspan="6" class="empty"><b>Không có AI phù hợp bộ lọc.</b><span>Workforce Controller ${telemetry.controller?.online ? 'đang online' : 'đang offline'}.</span></td></tr>`;

  const modelRows = modelList.length ? modelList.map((model) => {
    const users = roster.filter((employee) => employee.model?.toLowerCase() === model.toLowerCase());
    return `<tr><td><b>${escapeHtml(model)}</b></td><td>Ollama Local</td><td><span class="chip ${telemetry.ollama?.online ? 'good' : 'danger'}">${telemetry.ollama?.online ? 'Online' : 'Offline'}</span></td><td>${users.length ? escapeHtml(users.map((employee) => employee.displayName).join(', ')) : '<span class="muted">Chưa gán AI</span>'}</td></tr>`;
  }).join('') : `<tr><td colspan="4" class="empty"><b>Chưa đọc được model Ollama.</b></td></tr>`;

  const health = [
    ['PC01', telemetry.available], ['Worker', telemetry.worker?.online], ['Ollama', telemetry.ollama?.online], ['Tailscale', telemetry.tailscale?.online], ['Controller', telemetry.controller?.online],
  ] as Array<[string, boolean | undefined]>;
  const healthStrip = health.map(([name, online]) => `<span class="health ${online ? 'good' : 'danger'}"><i></i>${escapeHtml(name)}</span>`).join('');
  const aiBusy = allAi.filter((employee) => employee.availability === 'busy').length;
  const aiIdle = allAi.filter((employee) => employee.availability === 'idle').length;
  const aiOffline = allAi.filter((employee) => employee.availability === 'offline' || employee.availability === 'degraded').length;
  const systemOk = Boolean(telemetry.available && telemetry.worker?.online && telemetry.ollama?.online && telemetry.tailscale?.online);

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>TigerIQ Owner Cockpit V3</title><style>
:root{font-family:"Segoe UI Variable","Segoe UI",Tahoma,Arial,sans-serif;color:#f5f7fb;background:#060b11;--bg:#060b11;--panel:#0d1620;--panel2:#111d29;--line:#223243;--muted:#8293a6;--orange:#ff9418;--green:#3dde91;--blue:#55aaff;--yellow:#ffc15a;--red:#ff6878}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 80% -15%,#21364c 0,#0a131d 30%,#060b11 70%);font-size:14px;line-height:1.45}.app{min-height:100vh;display:grid;grid-template-columns:238px minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;padding:20px 15px;background:#071018eF;border-right:1px solid #1c2a38;display:flex;flex-direction:column;backdrop-filter:blur(18px)}.brand{display:flex;align-items:center;gap:10px;padding:3px 7px 22px;font-size:18px;font-weight:950}.brand-logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(145deg,#ffb64a,#ff7900);color:#15100b;font-size:20px;box-shadow:0 10px 28px #ff8c0038}.brand strong{color:var(--orange)}.brand span{color:#fff}.nav-label{font-size:9px;letter-spacing:.16em;color:#576a7d;font-weight:900;padding:7px 10px}.nav{display:grid;gap:5px}.nav a{display:flex;gap:10px;align-items:center;text-decoration:none;color:#9aabba;padding:11px 12px;border-radius:11px;border:1px solid transparent}.nav a.on{background:linear-gradient(90deg,#2d2115,#131921);color:#ffb45c;border-color:#4c351e}.nav a i{font-style:normal;width:20px;text-align:center}.sidebar-foot{margin-top:auto;border-top:1px solid #1d2a37;padding:15px 8px;color:#718397;font-size:11px}.sidebar-foot b{display:flex;align-items:center;gap:7px;color:#fff;margin-top:7px}.dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px #3dde9117}.main{width:100%;max-width:1580px;margin:auto;padding:20px 24px 36px}.topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:15px}.eyebrow{display:block;color:#71879d;font-size:9px;font-weight:900;letter-spacing:.15em}.topbar h1{font-size:27px;letter-spacing:-.03em;margin:4px 0 2px}.topbar p{margin:0;color:#7f91a4;font-size:12px}.system-pill{display:flex;align-items:center;gap:8px;border:1px solid #2c493c;background:#0c2118;color:#86ecb4;border-radius:999px;padding:8px 11px;font-size:11px;white-space:nowrap}.system-pill.warn{border-color:#684a20;background:#2b1e0e;color:#ffd17a}.command,.login,.panel,.kpi,.runtime{background:linear-gradient(180deg,#111d29,#0b141d);border:1px solid var(--line);box-shadow:0 18px 45px #0004}.command{border-radius:17px;padding:17px;display:grid;grid-template-columns:minmax(280px,.78fr) minmax(420px,1.22fr);gap:18px;align-items:center;margin-bottom:14px;border-color:#3a342a}.command h2{font-size:20px;margin:4px 0}.command p{color:#8293a6;margin:0;font-size:12px}.command-input{display:grid;gap:8px}.command textarea{min-height:88px;width:100%;resize:vertical;background:#071019;color:#fff;border:1px solid #324354;border-radius:11px;padding:12px 13px;font:inherit;outline:none}.command textarea:focus{border-color:#8b5f29;box-shadow:0 0 0 3px #ff941814}.command-actions{display:flex;justify-content:flex-end;gap:8px}.command select,.login input,.filters input,.filters select{background:#08121b;color:#fff;border:1px solid #2b3c4d;border-radius:9px;padding:9px 11px;font:inherit}.command button,.login button,.filters button{border:0;border-radius:9px;background:linear-gradient(135deg,#ffa62c,#ff7d00);color:#15100a;font-weight:950;padding:10px 15px;cursor:pointer}.login{border-radius:15px;padding:14px 16px;display:flex;align-items:center;gap:10px;margin-bottom:14px}.login>div{min-width:230px}.login input{flex:1}.flash{border:1px solid #2b6046;background:#0e241a;color:#baf3d0;border-radius:11px;padding:11px 13px;margin-bottom:14px}.flash.warn{border-color:#705024;background:#2b2011;color:#ffd38b}.flash a{color:#8fcfff}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}.kpi{border-radius:15px;padding:15px 16px;position:relative;overflow:hidden}.kpi:after{content:"";position:absolute;right:-12px;top:-18px;width:82px;height:82px;border-radius:50%;background:#ffffff05}.kpi small{color:#8495a6;font-size:10px;font-weight:800}.kpi b{display:block;font-size:30px;line-height:1.1;margin:5px 0 2px}.kpi span{color:#708196;font-size:10px}.kpi.blue b{color:var(--blue)}.kpi.yellow b{color:var(--yellow)}.kpi.green b{color:var(--green)}.kpi.red b{color:var(--red)}.primary-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,.7fr);gap:12px;margin-bottom:12px}.panel{border-radius:15px;padding:14px;min-width:0}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.panel-head h2{font-size:12px;letter-spacing:.07em;margin:0}.panel-head small{color:#718396}.table-wrap{overflow:auto;border:1px solid #223140;border-radius:11px;max-height:420px}.data{width:100%;border-collapse:collapse;min-width:760px}.data th{position:sticky;top:0;background:#0a141e;color:#75889d;text-align:left;font-size:9px;letter-spacing:.07em;padding:9px 10px;border-bottom:1px solid #263545}.data td{padding:10px;border-bottom:1px solid #1e2d3a;vertical-align:top}.data tr:hover td{background:#ffffff018}.data tr:last-child td{border-bottom:0}.data td small{display:block;color:#748699;font-size:10px;margin-top:3px}.data strong,.data b{font-weight:700}.owner{color:#f6bb6e}.chip{display:inline-flex;align-items:center;border:1px solid #314253;border-radius:999px;padding:4px 7px;font-size:9px;font-weight:900;white-space:nowrap}.chip.good{color:#79ebb0;border-color:#29664a;background:#0d241a}.chip.active{color:#85c6ff;border-color:#315e85;background:#0d1e2e}.chip.wait{color:#ffd17e;border-color:#6c5228;background:#2a2010}.chip.danger{color:#ff929e;border-color:#6f3841;background:#2a1419}.chip.muted{color:#9ba8b6}.muted{color:#76879a}.empty{text-align:center;padding:28px!important;color:#75879a}.empty b,.empty span{display:block}.empty span{font-size:11px;margin-top:4px}.owner-actions{display:grid;gap:8px}.owner-action{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #4a3821;background:linear-gradient(90deg,#23190f,#0b151f);border-radius:11px;padding:11px}.owner-action span{font-size:9px;color:#f5aa4b}.owner-action h3{font-size:12px;margin:3px 0}.owner-action p{font-size:10px;color:#7f90a2;margin:0}.owner-action>b{font-size:9px;color:#ffd17c;border:1px solid #614a27;border-radius:999px;padding:5px 7px}.owner-clear{display:flex;gap:10px;align-items:center;border:1px solid #285640;background:#0d2118;border-radius:11px;padding:15px;color:#b7f0cc}.owner-clear>span{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:#153425;color:#60e79d}.owner-clear b,.owner-clear small{display:block}.owner-clear small{color:#79a68d;margin-top:2px}.section-stack{display:grid;gap:12px;margin-bottom:12px}.workforce-stats{display:flex;gap:7px;flex-wrap:wrap}.mini{border:1px solid #2a3948;border-radius:999px;padding:5px 8px;color:#9eb0c0;font-size:10px}.mini b{color:#fff}.filters{display:flex;gap:7px;flex-wrap:wrap}.filters button{padding:8px 11px}.person{display:flex;align-items:center;gap:8px}.avatar{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:#172636;border:1px solid #30465c;color:#9fcbef;font-size:9px;font-weight:900}.model-strip{display:flex;gap:7px;flex-wrap:wrap}.model-pill{border:1px solid #2b3a49;background:#0a151f;border-radius:999px;padding:6px 9px;color:#a7b6c5;font-size:10px}.runtime{border-radius:15px;overflow:hidden}.runtime summary{cursor:pointer;list-style:none;padding:13px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px}.runtime summary::-webkit-details-marker{display:none}.runtime-title b,.runtime-title small{display:block}.runtime-title small{color:#74879a;font-size:10px;margin-top:2px}.health-strip{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.health{display:inline-flex;align-items:center;gap:5px;border:1px solid #314253;border-radius:999px;padding:4px 7px;font-size:9px}.health i{width:6px;height:6px;border-radius:50%;background:currentColor}.health.good{color:#72e8a8;border-color:#2d664c}.health.danger{color:#ff8894;border-color:#65353d}.runtime-body{border-top:1px solid #243444;padding:12px}.server-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.metric{border:1px solid #273646;border-radius:10px;background:#09131c;padding:10px}.metric small{display:block;color:#74879a;font-size:9px}.metric b{display:block;margin-top:3px;font-size:17px}.metric span{display:block;color:#74879a;font-size:9px;margin-top:2px}.footer{text-align:right;color:#5f7285;font-size:9px;margin-top:11px}@media(max-width:1120px){.app{grid-template-columns:1fr}.sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid #1c2a38;padding:11px 14px}.brand{padding:0 4px 8px}.nav-label,.sidebar-foot{display:none}.nav{display:flex;overflow:auto}.nav a{white-space:nowrap}.main{padding:15px}.primary-grid{grid-template-columns:1fr}.command{grid-template-columns:1fr}.server-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.topbar{display:block}.system-pill{width:max-content;margin-top:9px}.kpis{grid-template-columns:repeat(2,1fr)}.login{display:grid}.login>div{min-width:0}.command textarea{min-height:110px}.data{min-width:700px}.panel-head{align-items:flex-start}.health-strip{justify-content:flex-start}.runtime summary{display:block}.runtime-title{margin-bottom:8px}}@media(max-width:520px){.main{padding:11px}.topbar h1{font-size:23px}.kpi{padding:12px}.kpi b{font-size:25px}.command-actions{display:grid}.command-actions select,.command-actions button{width:100%}.server-grid{grid-template-columns:1fr}.panel{padding:11px}.data{min-width:660px}}
</style></head><body><div class="app"><aside class="sidebar"><div class="brand"><span class="brand-logo">🐯</span><div><strong>TIGERIQ</strong> <span>AI LAB</span></div></div><div class="nav-label">WEB CONTROL</div><nav class="nav"><a class="on" href="#overview"><i>⌂</i>Tổng quan</a><a href="#work"><i>▣</i>Công việc</a><a href="#workforce"><i>✦</i>AI Workforce</a><a href="#models"><i>◈</i>Mô hình AI</a><a href="#runtime"><i>◇</i>PC01</a></nav><div class="sidebar-foot">PRIMARY RUNTIME<b><i class="dot"></i>PC01 · PRIVATE</b></div></aside><main class="main" id="overview"><header class="topbar"><div><span class="eyebrow">OWNER COCKPIT V3 · VISUAL REBUILD</span><h1>Web Control / Command Center</h1><p>Nhìn vào là biết việc nào đang chạy, AI nào đang làm gì và khi nào cần anh Sơn.</p></div><div class="system-pill ${systemOk ? '' : 'warn'}">${systemOk ? '✓ Hệ thống sẵn sàng' : '⚠ Hạ tầng cần chú ý'} · ${escapeHtml(displayTime(telemetry.generatedAt))}</div></header>${submittedNotice}${taskPanel}<section class="kpis"><article class="kpi blue"><small>ĐANG CHẠY</small><b>${activeWork.length}</b><span>Work Order đang xử lý</span></article><article class="kpi yellow"><small>CẦN ANH SƠN</small><b>${needsOwner.length}</b><span>Quyết định / blocker cần xem</span></article><article class="kpi green"><small>HOÀN THÀNH</small><b>${completed}</b><span>Work Order verified</span></article><article class="kpi red"><small>LỖI / BLOCKER</small><b>${blockers}</b><span>Không claim PASS khi còn lỗi</span></article></section><section class="primary-grid"><div class="panel" id="work"><div class="panel-head"><div><h2>CÔNG VIỆC ĐANG CHẠY</h2><small>${activeWork.length} Work Order · ${summary.evidenceCount} evidence tổng</small></div></div><div class="table-wrap"><table class="data"><thead><tr><th>WORK ORDER</th><th>MỤC TIÊU</th><th>AI PHỤ TRÁCH</th><th>GIAI ĐOẠN</th><th>TRẠNG THÁI</th></tr></thead><tbody>${workRows}</tbody></table></div></div><div class="panel"><div class="panel-head"><div><h2>CẦN ANH SƠN</h2><small>Chỉ hiện việc thật sự cần Owner</small></div></div><div class="owner-actions">${ownerRows}</div></div></section><section class="section-stack"><div class="panel" id="workforce"><div class="panel-head"><div><h2>AI WORKFORCE — AI ĐANG LÀM GÌ</h2><div class="workforce-stats"><span class="mini">Tổng AI <b>${allAi.length}</b></span><span class="mini">Đang bận <b>${aiBusy}</b></span><span class="mini">Đang rảnh <b>${aiIdle}</b></span><span class="mini">Offline / lỗi <b>${aiOffline}</b></span></div></div><form class="filters" method="get" action="/"><input name="ai" value="${escapeHtml(aiQuery)}" placeholder="Tìm AI / role / model"><select name="state"><option value="all"${aiState === 'all' ? ' selected' : ''}>Tất cả trạng thái</option><option value="busy"${aiState === 'busy' ? ' selected' : ''}>Đang bận</option><option value="idle"${aiState === 'idle' ? ' selected' : ''}>Đang rảnh</option><option value="offline"${aiState === 'offline' ? ' selected' : ''}>Offline</option><option value="degraded"${aiState === 'degraded' ? ' selected' : ''}>Suy giảm</option></select><button type="submit">LỌC</button></form></div><div class="table-wrap"><table class="data"><thead><tr><th>AI</th><th>VAI TRÒ</th><th>MODEL / PROVIDER</th><th>ĐANG LÀM GÌ</th><th>TRẠNG THÁI</th><th>TẢI</th></tr></thead><tbody>${aiRows}</tbody></table></div><div class="footer">Hiển thị ${filteredAi.length}/${allAi.length} AI · bảng tự cuộn khi workforce tăng lớn</div></div><div class="panel" id="models"><div class="panel-head"><div><h2>MÔ HÌNH AI HIỆN CÓ</h2><small>${modelList.length} model Ollama local được phát hiện</small></div><div class="model-strip"><span class="model-pill">Ollama ${telemetry.ollama?.online ? 'ONLINE' : 'OFFLINE'}</span><span class="model-pill">${modelList.length} model</span></div></div><div class="table-wrap"><table class="data"><thead><tr><th>MODEL</th><th>LOẠI</th><th>TRẠNG THÁI</th><th>AI ĐANG DÙNG</th></tr></thead><tbody>${modelRows}</tbody></table></div></div></section><details class="runtime" id="runtime"><summary><div class="runtime-title"><b>PC01 SERVER & SERVICES</b><small>Hạ tầng kỹ thuật · mặc định thu gọn, chỉ mở khi cần kiểm tra</small></div><div class="health-strip">${healthStrip}</div></summary><div class="runtime-body"><div class="server-grid"><div class="metric"><small>CPU</small><b>${pct(telemetry.cpu?.utilizationPercent)}</b></div><div class="metric"><small>RAM</small><b>${pct(telemetry.memory?.utilizationPercent)}</b><span>${gb(telemetry.memory?.usedBytes)} / ${gb(telemetry.memory?.totalBytes)}</span></div><div class="metric"><small>DISK ${escapeHtml(telemetry.disk?.drive ?? '')}</small><b>${pct(telemetry.disk?.utilizationPercent)}</b><span>${gb(telemetry.disk?.freeBytes)} trống</span></div><div class="metric"><small>UPTIME</small><b>${escapeHtml(uptime(telemetry.uptimeSeconds))}</b></div><div class="metric"><small>WORKER</small><b class="${telemetry.worker?.online ? 'good' : 'danger'}">${telemetry.worker?.online ? 'ONLINE' : 'OFFLINE'}</b><span>PID ${telemetry.worker?.pid ?? '—'} · ${telemetry.worker?.instances ?? 0} instance</span></div><div class="metric"><small>Workforce Controller</small><b class="${telemetry.controller?.online ? 'good' : 'danger'}">${telemetry.controller?.online ? 'ONLINE' : 'OFFLINE'}</b><span>${escapeHtml(telemetry.controller?.ip ?? '—')}:${telemetry.controller?.port ?? '—'}</span></div><div class="metric"><small>PostgreSQL</small><b class="${telemetry.postgresql?.online ? 'good' : 'danger'}">${telemetry.postgresql?.online ? 'ONLINE' : 'OFFLINE'}</b><span>${escapeHtml(telemetry.postgresql?.service ?? '—')} · ${telemetry.postgresql?.port ?? '—'}</span></div><div class="metric"><small>Tailscale</small><b class="${telemetry.tailscale?.online ? 'good' : 'danger'}">${telemetry.tailscale?.online ? 'ONLINE' : 'OFFLINE'}</b><span>${escapeHtml(telemetry.tailscale?.ip ?? '—')}</span></div></div></div></details><div class="footer">Owner Cockpit V3 · Evidence-first · PC01 private · không MAIN/Production nếu chưa được phép</div></main></div></body></html>`;
}

export async function startOwnerCockpitV3(options: OwnerCockpitV3Options) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  assertPrivateBind(host);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid port');
  const backendUrl = options.backendUrl.replace(/\/$/, '');
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/') {
        const cookieHeaders = request.headers.cookie ? { headers: { cookie: request.headers.cookie } } : {};
        const [backendPage, statusResponse, serverResponse] = await Promise.all([
          fetch(`${backendUrl}${request.url ?? '/'}`, { ...cookieHeaders, redirect: 'manual' }),
          fetch(`${backendUrl}/api/status`, { redirect: 'manual' }),
          fetch(`${backendUrl}/api/server`, { redirect: 'manual' }),
        ]);
        if (backendPage.status >= 300 && backendPage.status < 400) return proxy(backendUrl, request, response);
        if (!backendPage.ok || !statusResponse.ok || !serverResponse.ok) throw new Error('backend_unavailable');
        const [backendHtml, summary, telemetry] = await Promise.all([
          backendPage.text(),
          statusResponse.json() as Promise<DashboardSummary>,
          serverResponse.json() as Promise<ServerTelemetry>,
        ]);
        return respond(response, 200, 'text/html; charset=utf-8', render(summary, telemetry, backendHtml, url));
      }
      if (url.pathname === '/api/status' || url.pathname === '/api/server' || url.pathname === '/login' || url.pathname === '/jobs') {
        return proxy(backendUrl, request, response);
      }
      return respond(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not_found' }));
    } catch {
      return respond(response, 503, 'application/json; charset=utf-8', JSON.stringify({ error: 'owner_cockpit_unavailable' }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://${address.address}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
