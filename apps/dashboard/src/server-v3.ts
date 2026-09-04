import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServerTelemetry, WorkforceEmployeeTelemetry } from './server.js';

type DashboardWorkOrder = {
  id: string;
  project: string;
  goal: string;
  status: string;
  latestGateStatus: 'pass' | 'fail' | 'blocked' | null;
  evidenceCount: number;
};

type DashboardSummary = {
  workOrders: DashboardWorkOrder[];
  evidenceCount: number;
};

type AiFilter = 'all' | 'busy' | 'idle' | 'offline' | 'degraded';

export interface OwnerCockpitV3Options {
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

function html(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function respond(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { ...headers, ...extra, 'content-type': type });
  res.end(body);
}

function privateIp(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true;
  const p = host.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  return p[0] === 127 || p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

async function bodyText(req: IncomingMessage): Promise<string | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += b.length;
    if (bytes > 64 * 1024) throw new Error('payload_too_large');
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function proxy(backendUrl: string, req: IncomingMessage, res: ServerResponse) {
  const h = new Headers();
  if (req.headers.cookie) h.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') h.set('content-type', contentType);
  const upstream = await fetch(`${backendUrl}${req.url ?? '/'}`, {
    method: req.method,
    headers: h,
    body: await bodyText(req),
    redirect: 'manual',
  });
  const extra: Record<string, string> = {};
  const location = upstream.headers.get('location');
  const cookie = upstream.headers.get('set-cookie');
  if (location) extra.location = location;
  if (cookie) extra['set-cookie'] = cookie;
  respond(res, upstream.status, upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8', await upstream.text(), extra);
}

function stateClass(value: string) {
  if (['verified', 'completed', 'idle'].includes(value)) return 'good';
  if (['failed', 'offline'].includes(value)) return 'danger';
  if (['blocked', 'degraded'].includes(value)) return 'wait';
  if (['running', 'busy', 'assigned', 'queued'].includes(value)) return 'active';
  return 'muted';
}

function label(value: string) {
  const labels: Record<string, string> = { draft: 'Việc mới', approved: 'Đã duyệt', running: 'Đang làm', failed: 'Lỗi', blocked: 'Vướng / Chờ', verified: 'Hoàn thành', queued: 'Xếp hàng', assigned: 'Đã giao', completed: 'Hoàn thành', busy: 'Đang bận', idle: 'Đang rảnh', offline: 'Offline', degraded: 'Suy giảm' };
  return labels[value] ?? value;
}

function syntheticVy(summary: DashboardSummary): WorkforceEmployeeTelemetry {
  const active = summary.workOrders.filter((x) => x.status !== 'verified');
  return { employeeId: 'vy-chief-of-staff', displayName: 'Vy', department: 'Điều hành', role: 'AI Chief of Staff', nodeId: 'web-control', provider: 'TigerIQ', model: null, availability: active.length ? 'busy' : 'idle', healthScore: 100, concurrencyLimit: 99, activeTaskCount: active.length, currentTaskIds: active.map((x) => x.id) };
}

function taskFor(id: string, telemetry: ServerTelemetry) {
  return telemetry.workforce?.taskList?.find((x) => x.taskId === id || x.taskId.includes(id));
}

function taskName(id: string, telemetry: ServerTelemetry) {
  return telemetry.workforce?.taskList?.find((x) => x.taskId === id)?.objective ?? id;
}

function ownerFor(id: string, telemetry: ServerTelemetry) {
  const task = taskFor(id, telemetry);
  if (!task?.assignedEmployeeId) return 'Vy · điều phối';
  return telemetry.workforce?.roster?.find((x) => x.employeeId === task.assignedEmployeeId)?.displayName ?? task.assignedEmployeeId;
}

function render(summary: DashboardSummary, telemetry: ServerTelemetry, backendHtml: string, url: URL): string {
  const csrf = backendHtml.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
  const loginNeeded = backendHtml.includes('name="secret"');
  const active = summary.workOrders.filter((x) => x.status !== 'verified');
  const done = summary.workOrders.filter((x) => x.status === 'verified').length;
  const owner = summary.workOrders.filter((x) => x.status === 'blocked' || x.latestGateStatus === 'fail' || x.latestGateStatus === 'blocked');
  const errors = summary.workOrders.filter((x) => x.status === 'failed' || x.latestGateStatus === 'fail').length;
  const roster = telemetry.workforce?.roster ?? [];
  const allAi = [syntheticVy(summary), ...roster.filter((x) => x.employeeId !== 'vy-chief-of-staff')];
  const query = (url.searchParams.get('ai') ?? '').trim().toLocaleLowerCase('vi-VN');
  const requested = (url.searchParams.get('state') ?? 'all') as AiFilter;
  const state: AiFilter = ['all', 'busy', 'idle', 'offline', 'degraded'].includes(requested) ? requested : 'all';
  const filtered = allAi.filter((x) => (state === 'all' || x.availability === state) && (!query || `${x.displayName} ${x.role} ${x.model ?? ''} ${x.provider ?? ''}`.toLocaleLowerCase('vi-VN').includes(query)));
  const models = telemetry.ollama?.models ?? [];
  const busy = allAi.filter((x) => x.availability === 'busy').length;
  const idle = allAi.filter((x) => x.availability === 'idle').length;
  const off = allAi.filter((x) => x.availability === 'offline' || x.availability === 'degraded').length;
  const systemOk = Boolean(telemetry.available && telemetry.worker?.online && telemetry.ollama?.online && telemetry.tailscale?.online);

  const command = csrf ? `<form class="command" method="post" action="/jobs"><div><span>GIAO VIỆC CHO VY</span><h2>Anh Sơn chỉ cần nói mục tiêu.</h2><p>Vy tự chia việc, chọn AI/model, theo dõi evidence và chỉ gọi anh khi cần quyết định.</p></div><div><input type="hidden" name="csrf" value="${html(csrf)}"><input type="hidden" name="idempotency" value="${Date.now()}-${Math.random().toString(36).slice(2)}"><textarea name="instruction" maxlength="8000" required placeholder="Nhập mục tiêu cần TigerIQ xử lý…"></textarea><div class="actions"><select name="priority"><option>Bình thường</option><option>Cao</option><option>Khẩn cấp</option><option>Thấp</option></select><button>GIAO VIỆC →</button></div></div></form>` : loginNeeded ? `<form class="login" method="post" action="/login"><b>Mở quyền giao việc cho Vy</b><input type="password" name="secret" placeholder="Mã điều khiển local" required><button>ĐĂNG NHẬP</button></form>` : `<div class="notice warn">Web đang ở chế độ chỉ xem.</div>`;

  const workRows = active.length ? active.map((x) => { const task = taskFor(x.id, telemetry); return `<tr><td><b>${html(x.id)}</b><small>${html(x.project)}</small></td><td><strong>${html(x.goal)}</strong><small>${x.evidenceCount} evidence</small></td><td>${html(ownerFor(x.id, telemetry))}</td><td>${task ? `<span class="chip ${stateClass(task.stage)}">${html(label(task.stage))}</span>` : '<span class="muted">Chưa gán runtime</span>'}</td><td><span class="chip ${stateClass(x.status)}">${html(label(x.status))}</span></td></tr>`; }).join('') : `<tr><td colspan="5" class="empty">Chưa có Work Order đang chạy. Giao mục tiêu cho Vy để bắt đầu.</td></tr>`;
  const ownerRows = owner.length ? owner.slice(0, 6).map((x) => `<article class="owner"><div><small>${html(x.id)}</small><b>${html(x.goal)}</b><span>${x.evidenceCount} evidence</span></div><em>CẦN XEM</em></article>`).join('') : `<div class="clear"><b>✓ Không có việc cần anh Sơn</b><span>Vy đang tự xử lý trong phạm vi được phép.</span></div>`;
  const aiRows = filtered.length ? filtered.map((x) => { const current = x.currentTaskIds.length ? x.currentTaskIds.slice(0, 2).map((id) => taskName(id, telemetry)).join(' · ') : 'Đang rảnh'; return `<tr><td><b>${html(x.displayName)}</b><small>${html(x.employeeId)}</small></td><td>${html(x.role)}<small>${html(x.department)}</small></td><td>${html(x.model ?? x.provider ?? 'Chưa gán model')}</td><td><strong>${html(current)}</strong><small>${x.currentTaskIds.length ? html(x.currentTaskIds.join(', ')) : 'Không có task active'}</small></td><td><span class="chip ${stateClass(x.availability)}">${html(label(x.availability))}</span></td><td>${x.activeTaskCount}/${x.concurrencyLimit}</td></tr>`; }).join('') : `<tr><td colspan="6" class="empty">Không có AI phù hợp bộ lọc.</td></tr>`;
  const modelRows = models.length ? models.map((m) => { const users = roster.filter((x) => x.model?.toLowerCase() === m.toLowerCase()).map((x) => x.displayName); return `<tr><td><b>${html(m)}</b></td><td>Ollama Local</td><td><span class="chip ${telemetry.ollama?.online ? 'good' : 'danger'}">${telemetry.ollama?.online ? 'Online' : 'Offline'}</span></td><td>${users.length ? html(users.join(', ')) : '<span class="muted">Chưa gán AI</span>'}</td></tr>`; }).join('') : `<tr><td colspan="4" class="empty">Chưa đọc được model Ollama.</td></tr>`;
  const health = [['PC01', telemetry.available], ['Worker', telemetry.worker?.online], ['Ollama', telemetry.ollama?.online], ['Tailscale', telemetry.tailscale?.online], ['Controller', telemetry.controller?.online]] as Array<[string, boolean | undefined]>;
  const healthHtml = health.map(([n, ok]) => `<span class="health ${ok ? 'good' : 'danger'}"><i></i>${html(n)}</span>`).join('');

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>TigerIQ Owner Cockpit V3</title><style>
:root{font-family:"Segoe UI Variable","Segoe UI",Tahoma,Arial,sans-serif;--bg:#060b11;--panel:#0d1721;--line:#223243;--muted:#8394a7;--orange:#ff9418;--green:#3dde91;--blue:#59adff;--yellow:#ffc45f;--red:#ff6d7d;color:#f5f7fb;background:var(--bg)}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -15%,#22384f 0,#0b151f 31%,#060b11 72%);font-size:14px;line-height:1.45}.app{display:grid;grid-template-columns:238px 1fr;min-height:100vh}.side{position:sticky;top:0;height:100vh;background:#071018eF;border-right:1px solid #1c2a38;padding:20px 15px;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:10px;font-weight:950;font-size:18px;padding:4px 8px 22px}.logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(145deg,#ffb54a,#ff7900);color:#181009}.brand strong{color:var(--orange)}.nav{display:grid;gap:5px}.nav a{text-decoration:none;color:#98aabb;padding:11px 12px;border-radius:11px}.nav a.on{background:linear-gradient(90deg,#2d2115,#131921);color:#ffb45d;border:1px solid #4d361f}.foot{margin-top:auto;color:#728396;font-size:11px;border-top:1px solid #1d2a37;padding:15px 8px}.foot b{display:block;color:#fff;margin-top:6px}.main{max-width:1580px;width:100%;margin:auto;padding:20px 24px 36px}.top{display:flex;justify-content:space-between;gap:20px;margin-bottom:14px}.top h1{font-size:27px;margin:3px 0}.top p{margin:0;color:var(--muted);font-size:12px}.eyebrow{font-size:9px;letter-spacing:.15em;color:#71879d;font-weight:900}.system{height:max-content;border:1px solid #2b4b3c;background:#0c2118;color:#83ebb2;border-radius:999px;padding:8px 11px;font-size:11px}.system.warn{border-color:#694a21;background:#2b1e0e;color:#ffd17d}.command,.login,.panel,.kpi,.runtime{background:linear-gradient(180deg,#111e2a,#0b141d);border:1px solid var(--line);box-shadow:0 18px 45px #0004}.command{display:grid;grid-template-columns:.8fr 1.2fr;gap:18px;align-items:center;padding:17px;border-radius:17px;margin-bottom:14px;border-color:#403728}.command span{font-size:9px;letter-spacing:.15em;color:#ffb55b;font-weight:900}.command h2{margin:4px 0;font-size:20px}.command p{margin:0;color:var(--muted);font-size:12px}.command textarea{width:100%;min-height:86px;background:#071019;color:#fff;border:1px solid #324354;border-radius:11px;padding:12px;font:inherit;resize:vertical}.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}.actions select,.login input,.filters input,.filters select{background:#08121b;color:#fff;border:1px solid #2b3c4d;border-radius:9px;padding:9px 11px}.actions button,.login button,.filters button{border:0;border-radius:9px;background:linear-gradient(135deg,#ffa62c,#ff7d00);color:#15100a;font-weight:950;padding:10px 15px}.login{border-radius:15px;padding:14px 16px;display:flex;gap:10px;align-items:center;margin-bottom:14px}.login input{flex:1}.notice{padding:11px 13px;border-radius:11px;margin-bottom:14px}.notice.warn{border:1px solid #705024;background:#2b2011;color:#ffd38b}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}.kpi{border-radius:15px;padding:15px 16px}.kpi small{color:#8495a6;font-size:10px}.kpi b{display:block;font-size:30px;margin:4px 0}.kpi.blue b{color:var(--blue)}.kpi.yellow b{color:var(--yellow)}.kpi.green b{color:var(--green)}.kpi.red b{color:var(--red)}.grid{display:grid;grid-template-columns:1.55fr .7fr;gap:12px;margin-bottom:12px}.panel{border-radius:15px;padding:14px;min-width:0}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}.head h2{font-size:12px;letter-spacing:.07em;margin:0}.head small{color:#718396}.table{overflow:auto;border:1px solid #223140;border-radius:11px;max-height:420px}.data{width:100%;border-collapse:collapse;min-width:760px}.data th{position:sticky;top:0;background:#09131d;color:#75889d;text-align:left;font-size:9px;padding:9px 10px}.data td{padding:10px;border-top:1px solid #1e2d3a;vertical-align:top}.data td small{display:block;color:#748699;font-size:10px;margin-top:3px}.chip{display:inline-flex;border:1px solid #314253;border-radius:999px;padding:4px 7px;font-size:9px;font-weight:900}.chip.good{color:#79ebb0;border-color:#29664a;background:#0d241a}.chip.active{color:#85c6ff;border-color:#315e85;background:#0d1e2e}.chip.wait{color:#ffd17e;border-color:#6c5228;background:#2a2010}.chip.danger{color:#ff929e;border-color:#6f3841;background:#2a1419}.chip.muted,.muted{color:#95a4b3}.empty{text-align:center;padding:28px!important;color:#74879a}.owner{display:flex;justify-content:space-between;gap:10px;border:1px solid #4a3821;background:#17130e;border-radius:11px;padding:11px;margin-bottom:8px}.owner small,.owner b,.owner span{display:block}.owner small{color:#f2a94d}.owner span{color:#788a9c;font-size:10px}.owner em{font-style:normal;color:#ffd17c;font-size:9px}.clear{border:1px solid #285640;background:#0d2118;color:#b7f0cc;border-radius:11px;padding:15px}.clear b,.clear span{display:block}.clear span{font-size:10px;color:#79a68d;margin-top:3px}.stack{display:grid;gap:12px;margin-bottom:12px}.stats{display:flex;gap:7px;flex-wrap:wrap}.mini{border:1px solid #2a3948;border-radius:999px;padding:5px 8px;color:#9eb0c0;font-size:10px}.filters{display:flex;gap:7px;flex-wrap:wrap}.filters button{padding:8px 11px}.runtime{border-radius:15px;overflow:hidden}.runtime summary{cursor:pointer;list-style:none;padding:13px 14px;display:flex;justify-content:space-between;gap:12px}.runtime summary::-webkit-details-marker{display:none}.healths{display:flex;gap:6px;flex-wrap:wrap}.health{display:inline-flex;align-items:center;gap:5px;border:1px solid #314253;border-radius:999px;padding:4px 7px;font-size:9px}.health i{width:6px;height:6px;border-radius:50%;background:currentColor}.health.good{color:#72e8a8}.health.danger{color:#ff8894}.runtime-body{border-top:1px solid #243444;padding:12px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.metric{border:1px solid #273646;border-radius:10px;background:#09131c;padding:10px}.metric small{color:#74879a;font-size:9px}.metric b{display:block;margin-top:3px}.footer{text-align:right;color:#5f7285;font-size:9px;margin-top:10px}@media(max-width:1100px){.app{grid-template-columns:1fr}.side{position:static;height:auto;border-right:0;border-bottom:1px solid #1c2a38;padding:11px}.brand{padding:0 4px 8px}.nav{display:flex;overflow:auto}.nav a{white-space:nowrap}.foot{display:none}.main{padding:15px}.grid,.command{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.top{display:block}.system{width:max-content;margin-top:9px}.kpis{grid-template-columns:repeat(2,1fr)}.login{display:grid}.data{min-width:700px}.runtime summary{display:block}.healths{margin-top:8px}}@media(max-width:520px){.main{padding:11px}.top h1{font-size:23px}.kpi b{font-size:25px}.actions{display:grid}.actions select,.actions button{width:100%}.metrics{grid-template-columns:1fr}.panel{padding:11px}}
</style></head><body><div class="app"><aside class="side"><div class="brand"><span class="logo">🐯</span><div><strong>TIGERIQ</strong> AI LAB</div></div><nav class="nav"><a class="on" href="#overview">⌂ Tổng quan</a><a href="#work">▣ Công việc</a><a href="#workforce">✦ AI Workforce</a><a href="#models">◈ Mô hình AI</a><a href="#runtime">◇ PC01</a></nav><div class="foot">PRIMARY RUNTIME<b>● PC01 · PRIVATE</b></div></aside><main class="main" id="overview"><header class="top"><div><span class="eyebrow">OWNER COCKPIT V3 · VISUAL REBUILD</span><h1>Web Control / Command Center</h1><p>Việc đang chạy · AI đang làm gì · việc cần anh Sơn · model đang có.</p></div><div class="system ${systemOk ? '' : 'warn'}">${systemOk ? '✓ Hệ thống sẵn sàng' : '⚠ Hạ tầng cần chú ý'}</div></header>${command}<section class="kpis"><article class="kpi blue"><small>ĐANG CHẠY</small><b>${active.length}</b><span>Work Order đang xử lý</span></article><article class="kpi yellow"><small>CẦN ANH SƠN</small><b>${owner.length}</b><span>Quyết định / blocker</span></article><article class="kpi green"><small>HOÀN THÀNH</small><b>${done}</b><span>Work Order verified</span></article><article class="kpi red"><small>LỖI / BLOCKER</small><b>${errors}</b><span>Không claim PASS khi còn lỗi</span></article></section><section class="grid"><div class="panel" id="work"><div class="head"><div><h2>CÔNG VIỆC ĐANG CHẠY</h2><small>${active.length} Work Order · ${summary.evidenceCount} evidence</small></div></div><div class="table"><table class="data"><thead><tr><th>WORK ORDER</th><th>MỤC TIÊU</th><th>AI PHỤ TRÁCH</th><th>GIAI ĐOẠN</th><th>TRẠNG THÁI</th></tr></thead><tbody>${workRows}</tbody></table></div></div><div class="panel"><div class="head"><div><h2>CẦN ANH SƠN</h2><small>Chỉ việc thật sự cần Owner</small></div></div>${ownerRows}</div></section><section class="stack"><div class="panel" id="workforce"><div class="head"><div><h2>AI WORKFORCE — AI ĐANG LÀM GÌ</h2><div class="stats"><span class="mini">Tổng AI <b>${allAi.length}</b></span><span class="mini">Bận <b>${busy}</b></span><span class="mini">Rảnh <b>${idle}</b></span><span class="mini">Offline/lỗi <b>${off}</b></span></div></div><form class="filters"><input name="ai" value="${html(url.searchParams.get('ai') ?? '')}" placeholder="Tìm AI / role / model"><select name="state"><option value="all"${state === 'all' ? ' selected' : ''}>Tất cả</option><option value="busy"${state === 'busy' ? ' selected' : ''}>Đang bận</option><option value="idle"${state === 'idle' ? ' selected' : ''}>Đang rảnh</option><option value="offline"${state === 'offline' ? ' selected' : ''}>Offline</option><option value="degraded"${state === 'degraded' ? ' selected' : ''}>Suy giảm</option></select><button>LỌC</button></form></div><div class="table"><table class="data"><thead><tr><th>AI</th><th>VAI TRÒ</th><th>MODEL / PROVIDER</th><th>ĐANG LÀM GÌ</th><th>TRẠNG THÁI</th><th>TẢI</th></tr></thead><tbody>${aiRows}</tbody></table></div><div class="footer">Hiển thị ${filtered.length}/${allAi.length} AI · bảng tự cuộn khi số AI tăng</div></div><div class="panel" id="models"><div class="head"><div><h2>MÔ HÌNH AI HIỆN CÓ</h2><small>${models.length} model Ollama local được phát hiện</small></div><div class="stats"><span class="mini">Ollama ${telemetry.ollama?.online ? 'ONLINE' : 'OFFLINE'}</span><span class="mini">${models.length} model</span></div></div><div class="table"><table class="data"><thead><tr><th>MODEL</th><th>LOẠI</th><th>TRẠNG THÁI</th><th>AI ĐANG DÙNG</th></tr></thead><tbody>${modelRows}</tbody></table></div></div></section><details class="runtime" id="runtime"><summary><div><b>PC01 SERVER & SERVICES</b><div class="muted">Hạ tầng kỹ thuật · mặc định thu gọn</div></div><div class="healths">${healthHtml}</div></summary><div class="runtime-body"><div class="metrics"><div class="metric"><small>CPU</small><b>${telemetry.cpu?.utilizationPercent == null ? '—' : `${Math.round(telemetry.cpu.utilizationPercent)}%`}</b></div><div class="metric"><small>RAM</small><b>${telemetry.memory?.utilizationPercent == null ? '—' : `${Math.round(telemetry.memory.utilizationPercent)}%`}</b></div><div class="metric"><small>DISK ${html(telemetry.disk?.drive ?? '')}</small><b>${telemetry.disk?.utilizationPercent == null ? '—' : `${Math.round(telemetry.disk.utilizationPercent)}%`}</b></div><div class="metric"><small>Workforce Controller</small><b>${telemetry.controller?.online ? 'ONLINE' : 'OFFLINE'}</b></div></div></div></details><div class="footer">Owner Cockpit V3 · Evidence-first · PC01 private</div></main></div></body></html>`;
}

export async function startOwnerCockpitV3(options: OwnerCockpitV3Options) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  if (!privateIp(host)) throw new Error('public bind is forbidden');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid port');
  const backendUrl = options.backendUrl.replace(/\/$/, '');
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') {
        const cookieHeaders = req.headers.cookie ? { cookie: req.headers.cookie } : undefined;
        const [page, status, serverData] = await Promise.all([
          fetch(`${backendUrl}${req.url ?? '/'}`, { headers: cookieHeaders, redirect: 'manual' }),
          fetch(`${backendUrl}/api/status`),
          fetch(`${backendUrl}/api/server`),
        ]);
        if (!page.ok || !status.ok || !serverData.ok) throw new Error('backend_unavailable');
        const [backendHtml, summary, telemetry] = await Promise.all([page.text(), status.json() as Promise<DashboardSummary>, serverData.json() as Promise<ServerTelemetry>]);
        return respond(res, 200, 'text/html; charset=utf-8', render(summary, telemetry, backendHtml, url));
      }
      if (['/api/status', '/api/server', '/login', '/jobs'].includes(url.pathname)) return proxy(backendUrl, req, res);
      return respond(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not_found' }));
    } catch {
      return respond(res, 503, 'application/json; charset=utf-8', JSON.stringify({ error: 'owner_cockpit_unavailable' }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
