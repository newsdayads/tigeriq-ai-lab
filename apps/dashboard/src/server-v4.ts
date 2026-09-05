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
    brain: '<path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 2.8A3.2 3.2 0 0 0 7 14v2a3 3 0 0 0 3 3"/><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 2.8A3.2 3.2 0 0 1 17 14v2a3 3 0 0 1-3 3"/><path d="M12 4v16"/><path d="M8 9h2M14 9h2M8 15h2M14 15h2"/>',
    shield: '<path d="M12 3 20 6v5c0 5-3.2 8.4-8 10-4.8-1.6-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 5 5"/>', plus: '<path d="M12 5v14M5 12h14"/>', chevron: '<path d="m9 6 6 6-6 6"/>', check: '<path d="m5 12 4 4L19 6"/>',
  };
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.home}</svg>`;
}

function translateRole(value: string): string {
  const key = value.trim().toLowerCase();
  const map: Record<string, string> = {
    'ai chief of staff': 'Trợ lý điều hành AI',
    'code & script': 'Lập trình & tự động hóa',
    'analysis': 'Phân tích',
    'review': 'Rà soát',
    'judge': 'Kiểm định',
    'builder': 'Xây dựng',
  };
  return map[key] ?? value;
}

function translateDepartment(value: string): string {
  const key = value.trim().toLowerCase();
  const map: Record<string, string> = {
    engineering: 'Kỹ thuật', research: 'Nghiên cứu', operations: 'Vận hành', operation: 'Vận hành', executive: 'Điều hành', governance: 'Quản trị', finance: 'Tài chính', sales: 'Kinh doanh', product: 'Sản phẩm', marketing: 'Tiếp thị',
  };
  return map[key] ?? value;
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
  if (/[À-ỹ]/.test(normalized)) return normalized.length > 105 ? `${normalized.slice(0, 102)}…` : normalized;
  return `Công việc kỹ thuật ${item.id}`;
}
function progressFor(status: string): number { if (status === 'verified' || status === 'completed') return 100; if (status === 'failed') return 30; if (status === 'blocked') return 45; if (status === 'running' || status === 'busy') return 68; if (status === 'approved' || status === 'assigned') return 38; if (status === 'queued') return 18; return 12; }
function needsOwnerDecision(item: DashboardWorkOrder): boolean {
  const needsAttention = item.status === 'blocked' || item.latestGateStatus === 'fail' || item.latestGateStatus === 'blocked';
  if (!needsAttention) return false;
  const text = `${item.id} ${item.goal}`.toLocaleLowerCase('vi-VN');
  return /(anh sơn|owner\b|chủ sở hữu|quyết định|phê duyệt|duyệt|authorize|authorization|approval|approve|permission)/i.test(text);
}
function isTechnicalProblem(item: DashboardWorkOrder): boolean {
  return item.status === 'failed' || item.status === 'blocked' || item.latestGateStatus === 'fail' || item.latestGateStatus === 'blocked';
}

function render(summary: DashboardSummary, telemetry: ServerTelemetry, backendHtml: string, url: URL): string {
  const csrf = backendHtml.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
  const loginNeeded = backendHtml.includes('name="secret"');
  const active = summary.workOrders.filter((item) => item.status !== 'verified');
  const done = summary.workOrders.filter((item) => item.status === 'verified').length;
  const ownerNeeds = summary.workOrders.filter(needsOwnerDecision);
  const problems = summary.workOrders.filter(isTechnicalProblem).length;
  const roster = telemetry.workforce?.roster ?? [];
  const allAi = [syntheticVy(summary), ...roster.filter((employee) => employee.employeeId !== 'vy-chief-of-staff')];
  const query = (url.searchParams.get('ai') ?? '').trim().toLocaleLowerCase('vi-VN');
  const requested = (url.searchParams.get('state') ?? 'all') as AiFilter;
  const state: AiFilter = ['all', 'busy', 'idle', 'offline', 'degraded'].includes(requested) ? requested : 'all';
  const filtered = allAi.filter((employee) => { const stateMatch = state === 'all' || employee.availability === state; const haystack = `${employee.displayName} ${employee.role} ${employee.department} ${employee.model ?? ''} ${employee.provider ?? ''}`.toLocaleLowerCase('vi-VN'); return stateMatch && (!query || haystack.includes(query)); });
  const models = telemetry.ollama?.models ?? [];
  const systemOk = Boolean(telemetry.available && telemetry.worker?.online && telemetry.ollama?.online && telemetry.tailscale?.online);

  const command = csrf ? `<form class="assign" method="post" action="/jobs"><div class="assign-copy"><b>Giao việc cho Vy</b><span>Anh chỉ cần nhập mục tiêu, Vy tự điều phối phần còn lại.</span></div><div class="assign-input"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="idempotency" value="v5-${Date.now()}-${Math.random().toString(36).slice(2, 18)}"><textarea name="instruction" maxlength="8000" required placeholder="Nhập mục tiêu cần TigerIQ thực hiện..."></textarea><select name="priority"><option>Bình thường</option><option>Cao</option><option>Khẩn cấp</option><option>Thấp</option></select><button type="submit">${icon('plus')}<span>Giao việc</span></button></div></form>` : loginNeeded ? `<form class="login" method="post" action="/login"><div><b>Quyền điều khiển</b><span>Đăng nhập để giao việc cho Vy.</span></div><input type="password" name="secret" placeholder="Mã điều khiển nội bộ" required><button type="submit">Đăng nhập</button></form>` : `<div class="readonly">Đang ở chế độ chỉ xem.</div>`;

  const workRows = active.length ? active.slice(0, 12).map((item) => { const stage = taskFor(item.id, telemetry)?.stage ?? item.status; const progress = progressFor(stage); const owner = ownerFor(item.id, telemetry); return `<div class="work-row"><div class="work-main"><div class="work-title">${esc(taskTitle(item))}</div><div class="work-sub"><span>${esc(item.id)}</span><span>${esc(item.project)}</span></div></div><div class="work-owner"><span class="avatar-mini">${esc(owner.slice(0, 2).toUpperCase())}</span><span>${esc(owner)}</span></div><div class="work-progress"><div><i style="width:${progress}%"></i></div><span>${progress}%</span></div><div><span class="badge ${stateClass(stage)}">${esc(stateLabel(stage))}</span></div><a class="row-open" href="#chi-tiet-${esc(item.id)}" aria-label="Xem chi tiết">${icon('chevron')}</a><details class="work-detail" id="chi-tiet-${esc(item.id)}"><summary>Chi tiết kỹ thuật</summary><p>${esc(item.goal)}</p><small>${item.evidenceCount} bằng chứng đã ghi nhận</small></details></div>`; }).join('') : `<div class="empty">Chưa có công việc đang chạy.</div>`;
  const ownerCards = ownerNeeds.length ? ownerNeeds.slice(0, 5).map((item) => `<div class="need-item"><div><b>${esc(taskTitle(item))}</b><span>Cần anh quyết định hoặc phê duyệt để tiếp tục</span></div><span class="badge wait">Cần xem</span></div>`).join('') : `<div class="all-good">${icon('check')}<div><b>Không có việc cần anh Sơn</b><span>Các lỗi kỹ thuật được TigerIQ tự xử lý và theo dõi riêng.</span></div></div>`;
  const aiRows = filtered.length ? filtered.map((employee) => { const current = employee.currentTaskIds.length ? employee.currentTaskIds.slice(0, 2).map((id) => summary.workOrders.find((item) => item.id === id)).filter(Boolean).map((item) => taskTitle(item as DashboardWorkOrder)).join(' · ') : 'Đang rảnh'; const initials = employee.displayName.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase(); return `<div class="ai-row"><div class="ai-person"><span class="avatar">${esc(initials || 'AI')}</span><div><b>${esc(employee.displayName)}</b><span>${esc(translateRole(employee.role))}</span></div></div><div><b>${esc(employee.model ?? 'Chưa gán mô hình')}</b><span>${esc(translateDepartment(employee.department))}</span></div><div class="ai-current"><b>${esc(current)}</b><span>${employee.activeTaskCount ? `${employee.activeTaskCount} việc đang xử lý` : 'Không có việc đang chạy'}</span></div><span class="badge ${stateClass(employee.availability)}">${esc(stateLabel(employee.availability))}</span><span class="ai-load">${employee.activeTaskCount}/${employee.concurrencyLimit}</span></div>`; }).join('') : `<div class="empty">Không có AI phù hợp bộ lọc.</div>`;
  const modelRows = models.length ? models.slice(0, 8).map((model) => { const users = roster.filter((employee) => employee.model?.toLowerCase() === model.toLowerCase()).map((employee) => employee.displayName); return `<div class="model-item">${icon('brain')}<div><b>${esc(model)}</b><span>${users.length ? `Đang dùng: ${esc(users.join(', '))}` : 'Chưa gán cho AI nào'}</span></div><i class="${telemetry.ollama?.online ? 'on' : 'off'}"></i></div>`; }).join('') : `<div class="empty">Chưa đọc được danh sách mô hình AI.</div>`;
  const services = [['PC01', telemetry.available, telemetry.available ? 'Đang hoạt động' : 'Chưa có dữ liệu'], ['Bộ thực thi PC01', telemetry.worker?.online, telemetry.worker?.pid ? `PID ${telemetry.worker.pid}` : ''], ['Mô hình AI cục bộ', telemetry.ollama?.online, `${models.length} mô hình`], ['Mạng riêng Tailscale', telemetry.tailscale?.online, telemetry.tailscale?.ip ?? ''], ['Bộ điều phối', telemetry.controller?.online, telemetry.controller?.port ? `Cổng ${telemetry.controller.port}` : ''], ['Cơ sở dữ liệu', telemetry.postgresql?.online, telemetry.postgresql?.service ?? '']].map(([name, ok, note]) => `<div class="service"><i class="${ok ? 'on' : 'off'}"></i><div><b>${esc(name)}</b><span>${esc(note || (ok ? 'Hoạt động' : 'Ngắt kết nối'))}</span></div></div>`).join('');

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>TigerIQ — Bảng điều hành</title><style>
:root{font-family:"Segoe UI Variable","Segoe UI",Arial,sans-serif;--bg:#071019;--sidebar:#08131e;--panel:#0d1824;--panel2:#101e2c;--line:#203246;--text:#f4f7fa;--muted:#8ea0b2;--orange:#ff9b21;--green:#35d990;--blue:#55aaff;--yellow:#ffc45e;--red:#ff6375}*{box-sizing:border-box}html{background:var(--bg);color:var(--text)}body{margin:0;background:var(--bg);font-size:14px;line-height:1.5;color:var(--text)}button,input,select,textarea{font:inherit}a{color:inherit;text-decoration:none}.ico{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}.shell{min-height:100vh;display:grid;grid-template-columns:236px minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;background:var(--sidebar);border-right:1px solid var(--line);padding:18px 14px;display:flex;flex-direction:column}.brand{height:54px;display:flex;align-items:center;gap:10px;padding:0 8px 16px;border-bottom:1px solid #17283a}.brand-mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(145deg,#ffb044,#ff7d00);display:grid;place-items:center;color:#111}.brand-mark .ico{width:24px;height:24px;stroke-width:2}.brand strong{font-size:16px}.brand strong span{color:var(--orange)}.brand small{display:block;color:var(--muted);font-size:12px}.nav{display:grid;gap:5px;margin-top:18px}.nav a{display:flex;align-items:center;gap:11px;padding:10px 11px;border-radius:10px;color:#94a6b8;font-weight:600}.nav a:hover,.nav a.on{background:#112235;color:#fff}.nav a.on{box-shadow:inset 3px 0 0 var(--orange)}.sidebar-foot{margin-top:auto;padding:12px 8px;border-top:1px solid #17283a}.system-mini{display:flex;align-items:center;gap:8px;color:#a7b7c6}.dot{width:8px;height:8px;border-radius:50%;background:var(--green)}.dot.warn{background:var(--yellow)}.system-mini span{font-size:12px}.content{min-width:0;padding:18px 22px 34px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:50px;margin-bottom:14px}.title h1{font-size:24px;line-height:1.25;margin:0}.title p{margin:4px 0 0;color:var(--muted);font-size:13px}.top-actions{display:flex;align-items:center;gap:9px}.search-box{display:flex;align-items:center;gap:8px;background:#0a1621;border:1px solid var(--line);border-radius:10px;padding:8px 10px;color:var(--muted)}.search-box input{width:190px;background:transparent;border:0;outline:0;color:#fff}.primary{display:inline-flex;align-items:center;gap:7px;background:var(--orange);border:0;border-radius:10px;color:#16100a;font-weight:800;padding:9px 12px;cursor:pointer}.assign,.login,.readonly{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:14px;margin-bottom:14px}.assign{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(0,1.5fr);gap:16px;align-items:center}.assign-copy b,.assign-copy span{display:block}.assign-copy b{font-size:15px}.assign-copy span{color:var(--muted);margin-top:3px}.assign-input{display:grid;grid-template-columns:minmax(0,1fr) 120px 108px;gap:8px}.assign-input textarea{min-height:46px;max-height:90px;resize:vertical;background:#07131e;border:1px solid #2c4054;border-radius:9px;color:#fff;padding:10px 11px;outline:none}.assign-input select,.login input{background:#07131e;border:1px solid #2c4054;border-radius:9px;color:#fff;padding:9px 10px}.assign-input button,.login button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:9px;background:var(--orange);color:#17100a;font-weight:800;padding:9px 11px;cursor:pointer}.login{display:flex;align-items:center;gap:10px}.login>div{margin-right:auto}.login b,.login span{display:block}.login span{color:var(--muted);font-size:13px}.readonly{color:var(--yellow)}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 15px}.kpi span{color:var(--muted);font-size:12px}.kpi strong{display:block;font-size:26px;margin-top:3px}.kpi.blue strong{color:var(--blue)}.kpi.yellow strong{color:var(--yellow)}.kpi.green strong{color:var(--green)}.kpi.red strong{color:var(--red)}.grid-main{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(310px,.72fr);gap:12px;margin-bottom:14px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border-bottom:1px solid var(--line)}.panel-head h2{font-size:15px;margin:0}.panel-head span{color:var(--muted);font-size:12px}.work-head,.work-row{display:grid;grid-template-columns:minmax(260px,1.8fr) 140px minmax(140px,.7fr) 110px 28px;gap:12px;align-items:center}.work-head{padding:9px 14px;background:#0a1520;color:#7f92a5;font-size:12px;font-weight:600}.work-row{position:relative;padding:12px 14px;border-top:1px solid #192b3b}.work-row:first-of-type{border-top:0}.work-title{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.work-sub{display:flex;gap:10px;color:var(--muted);font-size:12px;margin-top:3px}.work-owner{display:flex;align-items:center;gap:7px;min-width:0}.avatar-mini{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#17314a;color:#9fd0ff;font-size:10px;font-weight:800}.work-progress{display:flex;align-items:center;gap:8px}.work-progress>div{height:6px;flex:1;background:#17283a;border-radius:99px;overflow:hidden}.work-progress i{display:block;height:100%;background:var(--blue);border-radius:99px}.work-progress span{font-size:12px;color:var(--muted);width:30px}.row-open{display:grid;place-items:center;color:#7f94a8}.row-open .ico{width:16px;height:16px}.work-detail{grid-column:1/-1;margin-top:2px;background:#08131d;border:1px solid #1d3042;border-radius:9px;padding:8px 10px;color:var(--muted)}.work-detail summary{cursor:pointer;color:#9eb0c1;font-size:12px}.work-detail p{white-space:pre-wrap;color:#b7c4cf;margin:8px 0;font-size:13px}.work-detail small{font-size:12px}.badge{display:inline-flex;align-items:center;justify-content:center;border:1px solid #33485c;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:700;white-space:nowrap}.badge.ok{color:#7ce8ae;border-color:#2b6a4b;background:#0d251a}.badge.run{color:#91c9ff;border-color:#2b5f8d;background:#0d2032}.badge.wait{color:#ffd17d;border-color:#6a5229;background:#2b2110}.badge.bad{color:#ff9aa6;border-color:#6c3640;background:#2b1519}.badge.muted{color:#a0adba}.need-list{padding:10px}.need-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px;border:1px solid #4e3d25;background:#1a160f;border-radius:10px;margin-bottom:8px}.need-item:last-child{margin-bottom:0}.need-item b,.need-item span{display:block}.need-item b{font-size:13px}.need-item div span{color:#a99579;font-size:12px;margin-top:3px}.all-good{display:flex;gap:10px;align-items:center;padding:14px;border:1px solid #28563f;background:#0c2118;border-radius:10px;color:#85e9b2}.all-good .ico{width:24px;height:24px}.all-good b,.all-good span{display:block}.all-good span{font-size:12px;color:#82a992;margin-top:2px}.ai-tools{display:flex;gap:8px;align-items:center}.ai-tools input,.ai-tools select{background:#07131e;border:1px solid #2c4054;border-radius:8px;color:#fff;padding:7px 9px}.ai-head,.ai-row{display:grid;grid-template-columns:minmax(180px,1.1fr) minmax(170px,.9fr) minmax(250px,1.5fr) 108px 54px;gap:12px;align-items:center}.ai-head{padding:9px 14px;background:#0a1520;color:#7f92a5;font-size:12px;font-weight:600}.ai-row{padding:11px 14px;border-top:1px solid #192b3b}.ai-person{display:flex;align-items:center;gap:9px}.avatar{width:34px;height:34px;border-radius:9px;background:#17314a;border:1px solid #31506a;color:#a8d3ff;display:grid;place-items:center;font-size:10px;font-weight:800}.ai-person b,.ai-person span,.ai-row>div>b,.ai-row>div>span{display:block}.ai-person span,.ai-row>div>span{color:var(--muted);font-size:12px;margin-top:2px}.ai-current{min-width:0}.ai-current b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ai-load{font-variant-numeric:tabular-nums;color:var(--muted)}.lower{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-top:14px}.model-list,.service-list{padding:10px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.model-item,.service{display:flex;align-items:center;gap:9px;border:1px solid #203447;background:#091621;border-radius:9px;padding:10px}.model-item .ico{color:#8fc8ff}.model-item>div,.service>div{min-width:0;flex:1}.model-item b,.model-item span,.service b,.service span{display:block}.model-item span,.service span{font-size:12px;color:var(--muted);margin-top:2px}.model-item>i,.service>i{width:8px;height:8px;border-radius:50%;background:#6b7782}.model-item>i.on,.service>i.on{background:var(--green)}.model-item>i.off,.service>i.off{background:var(--red)}.system-wrap{margin-top:14px}.system-wrap summary{cursor:pointer;padding:13px 15px;font-weight:700}.system-wrap[open] summary{border-bottom:1px solid var(--line)}.empty{padding:22px;text-align:center;color:var(--muted)}@media(max-width:1100px){.shell{grid-template-columns:82px minmax(0,1fr)}.brand strong,.brand small,.nav span,.sidebar-foot span{display:none}.brand{justify-content:center;padding-left:0;padding-right:0}.nav a{justify-content:center}.content{padding:16px}.grid-main{grid-template-columns:1fr}.assign{grid-template-columns:1fr}.lower{grid-template-columns:1fr}.work-head,.work-row{grid-template-columns:minmax(220px,1.5fr) 120px 140px 105px 26px}}@media(max-width:760px){.shell{display:block}.sidebar{position:sticky;top:0;z-index:20;width:100%;height:auto;display:flex;flex-direction:row;align-items:center;padding:8px 10px;border-right:0;border-bottom:1px solid var(--line)}.brand{height:auto;border:0;padding:0;margin-right:8px}.brand-mark{width:32px;height:32px}.nav{display:flex;gap:2px;margin:0;overflow:auto}.nav a{padding:8px}.nav a.on{box-shadow:inset 0 -2px 0 var(--orange)}.sidebar-foot{display:none}.content{padding:12px}.topbar{align-items:flex-start}.title h1{font-size:20px}.title p{font-size:12px}.search-box{display:none}.assign-input{grid-template-columns:1fr 110px}.assign-input textarea{grid-column:1/-1}.kpis{grid-template-columns:repeat(2,1fr)}.work-head{display:none}.work-row{grid-template-columns:1fr auto}.work-owner,.work-progress{grid-column:1/-1}.row-open{display:none}.ai-head{display:none}.ai-row{grid-template-columns:1fr auto}.ai-row>div:nth-child(2),.ai-current{grid-column:1/-1}.ai-load{grid-column:2}.lower{grid-template-columns:1fr}.model-list,.service-list{grid-template-columns:1fr}.login{flex-wrap:wrap}.login>div{width:100%}}
</style></head><body><div class="shell"><aside class="sidebar"><a class="brand" href="#tong-quan"><div class="brand-mark">${icon('tiger')}</div><div><strong><span>TigerIQ</span> AI Lab</strong><small>Bảng điều hành</small></div></a><nav class="nav"><a class="on" href="#tong-quan">${icon('home')}<span>Tổng quan</span></a><a href="#cong-viec">${icon('tasks')}<span>Công việc</span></a><a href="#doi-ai">${icon('users')}<span>Đội AI</span></a><a href="#mo-hinh">${icon('brain')}<span>Mô hình AI</span></a><a href="#bang-chung">${icon('shield')}<span>Bằng chứng</span></a><a href="#bao-cao">${icon('chart')}<span>Báo cáo</span></a><a href="#he-thong">${icon('server')}<span>Hệ thống</span></a><a href="#cai-dat">${icon('settings')}<span>Cài đặt</span></a></nav><div class="sidebar-foot"><div class="system-mini"><i class="dot ${systemOk ? '' : 'warn'}"></i><span>${systemOk ? 'PC01 đang hoạt động' : 'Có hạng mục cần kiểm tra'}</span></div></div></aside><main class="content" id="tong-quan"><header class="topbar"><div class="title"><h1>Xin chào anh Sơn</h1><p>Đây là tình hình TigerIQ hiện tại.</p></div><div class="top-actions"><label class="search-box">${icon('search')}<input type="search" placeholder="Tìm công việc, AI..."></label><a class="primary" href="#giao-viec">${icon('plus')}<span>Giao việc</span></a></div></header><section id="giao-viec">${command}</section><section class="kpis"><article class="kpi blue"><span>Đang xử lý</span><strong>${active.length}</strong></article><article class="kpi yellow"><span>Chờ anh quyết định</span><strong>${ownerNeeds.length}</strong></article><article class="kpi green"><span>Đã hoàn thành</span><strong>${done}</strong></article><article class="kpi red"><span>Lỗi / đang vướng</span><strong>${problems}</strong></article></section><section class="grid-main" id="cong-viec"><div class="panel"><div class="panel-head"><h2>Công việc đang xử lý</h2><span>${active.length} việc</span></div><div class="work-head"><span>Công việc</span><span>Phụ trách</span><span>Tiến độ</span><span>Trạng thái</span><span></span></div>${workRows}</div><aside class="panel"><div class="panel-head"><h2>Cần anh Sơn</h2><span>Chỉ việc cần quyết định</span></div><div class="need-list">${ownerCards}</div></aside></section><section class="panel" id="doi-ai"><div class="panel-head"><h2>Đội AI đang làm gì</h2><form class="ai-tools" method="get"><input name="ai" value="${esc(url.searchParams.get('ai') ?? '')}" placeholder="Tìm AI / vai trò / mô hình"><select name="state"><option value="all"${state === 'all' ? ' selected' : ''}>Tất cả trạng thái</option><option value="busy"${state === 'busy' ? ' selected' : ''}>Đang bận</option><option value="idle"${state === 'idle' ? ' selected' : ''}>Đang rảnh</option><option value="offline"${state === 'offline' ? ' selected' : ''}>Mất kết nối</option><option value="degraded"${state === 'degraded' ? ' selected' : ''}>Cần kiểm tra</option></select></form></div><div class="ai-head"><span>AI / vai trò</span><span>Mô hình / nhóm</span><span>Đang làm</span><span>Trạng thái</span><span>Tải</span></div>${aiRows}</section><section class="lower"><div class="panel" id="mo-hinh"><div class="panel-head"><h2>Mô hình AI</h2><span>${models.length} mô hình</span></div><div class="model-list">${modelRows}</div></div><div class="panel" id="bang-chung"><div class="panel-head"><h2>Bằng chứng & kiểm tra</h2><span>${summary.evidenceCount} bằng chứng</span></div><div class="empty">${summary.evidenceCount ? `Đã ghi nhận ${summary.evidenceCount} bằng chứng từ các công việc.` : 'Chưa có bằng chứng mới.'}</div></div></section><section class="panel system-wrap" id="he-thong"><details><summary>Trạng thái hệ thống PC01</summary><div class="service-list">${services}</div></details></section><section id="bao-cao" hidden></section><section id="cai-dat" hidden></section></main></div></body></html>`;
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
        const [summaryResponse, telemetryResponse, backendResponse] = await Promise.all([fetch(`${options.backendUrl}/api/status`), fetch(`${options.backendUrl}/api/server`), fetch(`${options.backendUrl}/`, { headers: cookieHeaders })]);
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
