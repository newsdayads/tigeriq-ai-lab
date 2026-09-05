import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const WEB_LOCAL_VERSION_V9 = 'WEB-LOCAL-396-V3.1';
const MAX_BODY_BYTES = 64 * 1024;

export interface OwnerCockpitV9Options {
  cockpitUrl: string;
  host?: string;
  port?: number;
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

function capture(html: string, pattern: RegExp, fallback = '—'): string {
  return html.match(pattern)?.[1]?.trim() || fallback;
}

function plain(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function icon(path: string): string {
  return `<svg class="tq31-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
}

function progressSegments(people: string): { active: number; waiting: number; paused: number; complete: number; total: number } {
  const cards = [...people.matchAll(/<article class="tq-person">([\s\S]*?)<\/article>/g)].map((match) => plain(match[1]));
  const active = cards.filter((text) => /ĐANG XỬ LÝ/.test(text)).length;
  const paused = cards.filter((text) => /TẠM NGƯNG/.test(text)).length;
  const complete = cards.filter((text) => /HOÀN TẤT/.test(text)).length;
  const waiting = cards.filter((text) => /CHỜ VIỆC|ĐANG CHỜ/.test(text)).length;
  return { active, waiting, paused, complete, total: Math.max(cards.length, 1) };
}

function workloadBars(people: string): string {
  const defs = [
    ['Minh', 'Minh (NV01 — Thực thi trực tiếp)'],
    ['Khoa', 'Khoa (NV02 — Vận hành tự động)'],
    ['Huy', 'Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)'],
    ['Khải', 'Khải (NV04 — Kỹ sư Tích hợp AI/API)'],
  ] as const;
  return defs.map(([short, canonical]) => {
    const card = [...people.matchAll(/<article class="tq-person">([\s\S]*?)<\/article>/g)].map((match) => plain(match[1])).find((text) => text.includes(canonical)) || '';
    const active = /ĐANG XỬ LÝ/.test(card) ? 1 : 0;
    const state = /TẠM NGƯNG/.test(card) ? 'Tạm ngưng' : active ? '1 việc đang xử lý' : '0 việc đang xử lý';
    return `<div class="tq31-bar-row"><div class="tq31-bar-label"><span>${short}</span><b>${state}</b></div><div class="tq31-bar-track"><i style="width:${active ? 100 : 0}%"></i></div></div>`;
  }).join('');
}

function systemVisual(systems: string): string {
  const cards = [...systems.matchAll(/<article class="tq-system">([\s\S]*?)<\/article>/g)].map((match) => plain(match[1]));
  const good = cards.filter((text) => /TRỰC TUYẾN|SẴN SÀNG/.test(text)).length;
  const warn = cards.filter((text) => /SUY GIẢM|BỊ LỖI/.test(text)).length;
  const neutral = Math.max(cards.length - good - warn, 0);
  return `<div class="tq31-system-visual"><span class="good"><b>${good}</b> ổn định</span><span class="warn"><b>${warn}</b> cảnh báo</span><span class="neutral"><b>${neutral}</b> chưa xác minh/tạm ngưng</span></div>`;
}

export function transformManagementUiV31(html: string): string {
  const panelMatch = html.match(/<section class="tq322" id="tigeriq-management-v4">([\s\S]*?)<\/section>/);
  if (!panelMatch) return html;
  const panel = panelMatch[0];

  const currentWork = capture(panel, /CÔNG VIỆC HIỆN HÀNH<\/span><b>([\s\S]*?)<\/b>/);
  const progress = capture(panel, /TIẾN ĐỘ<\/span><b>([\s\S]*?)<\/b>/);
  const status = capture(panel, /TRẠNG THÁI<\/span><b>([\s\S]*?)<\/b>/);
  const owner = capture(panel, /NGƯỜI PHỤ TRÁCH<\/span><b>([\s\S]*?)<\/b>/);
  const currentStep = capture(panel, /BƯỚC HIỆN TẠI<\/span><b>([\s\S]*?)<\/b>/);
  const next = capture(panel, /data-label="Mốc kế tiếp">([\s\S]*?)<\/td>/);
  const updated = capture(panel, /data-label="Cập nhật cuối">([\s\S]*?)<\/td>/);
  const ownership = capture(panel, /<h3>🔐 QUYỀN XỬ LÝ \/ CHUYỂN GIAO<\/h3><div class="tq-cell">([\s\S]*?)<\/div><\/div>/, 'Chưa có sự kiện quyền xử lý mới');
  const ownerAction = capture(panel, /<h3>🔴 CẦN ANH SƠN<\/h3>([\s\S]*?)<\/div><div class="tq-section"><h3>👥/, '<div class="tq-owner ok">Không có việc cần anh Sơn.</div>');
  const people = capture(panel, /<div class="tq-people">([\s\S]*?)<\/div><\/div><div class="tq-section"><h3>🖥️/, '');
  const systems = capture(panel, /<div class="tq-systems">([\s\S]*?)<\/div><\/div><div class="tq-section"><details/, '');
  const tech = capture(panel, /<details class="tq-tech">([\s\S]*?)<\/details>/, 'Không có chi tiết kỹ thuật');

  const stateText = `${plain(status)} ${plain(currentStep)}`;
  const blocker = /BỊ CHẶN|LỖI|ĐANG CHỜ|CHỜ/.test(stateText) ? currentStep : 'Không có vướng mắc mới được xác minh';
  const segments = progressSegments(people);
  const pct = (value: number) => Math.round((value / segments.total) * 100);

  const interLink = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
  const css = `<style id="tq31-style">
:root{--tq31-bg:#0a1017;--tq31-card:#101923;--tq31-card2:#0d151e;--tq31-line:#253342;--tq31-text:#f3f7fb;--tq31-muted:#91a0b1;--tq31-blue:#62a8ff;--tq31-green:#66d19e;--tq31-amber:#e7b963;--tq31-red:#ef7f8c;--tq31-gray:#687788}
#tigeriq-management-v31,#tigeriq-management-v31 *{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.35}
#tigeriq-management-v31{margin:14px 0;border:1px solid var(--tq31-line);border-radius:18px;background:var(--tq31-bg);color:var(--tq31-text);overflow:hidden;box-shadow:0 18px 45px rgba(0,0,0,.2)}
.tq31-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:18px 20px;border-bottom:1px solid var(--tq31-line)}.tq31-title h2{margin:0;font-size:17px;font-weight:800;letter-spacing:-.02em}.tq31-title p{margin:5px 0 0;color:var(--tq31-muted);font-size:11px}.tq31-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.tq31-button{appearance:none;border:1px solid #34475b;background:#152231;color:#dfeaf5;border-radius:9px;padding:8px 11px;font:600 11px/1 Inter,ui-sans-serif,sans-serif;cursor:pointer;transition:background-color 170ms ease,border-color 170ms ease,box-shadow 170ms ease,transform 170ms ease}.tq31-button:hover{background:#1a2b3d;border-color:#4b6886;box-shadow:0 6px 16px rgba(0,0,0,.18)}.tq31-button:active{transform:translateY(1px);box-shadow:none}.tq31-button:focus-visible{outline:2px solid var(--tq31-blue);outline-offset:2px}.tq31-button:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}
.tq31-kpis{display:grid;grid-template-columns:2fr 1.25fr 1fr 1.35fr 1.35fr;gap:10px;padding:14px 20px}.tq31-kpi{min-width:0;border:1px solid var(--tq31-line);border-radius:12px;background:linear-gradient(180deg,#111c28,#0e1720);padding:12px}.tq31-kpi-head{display:flex;align-items:center;gap:7px;color:var(--tq31-muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.045em}.tq31-icon{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}.tq31-kpi-value{display:block;margin-top:8px;font-size:12px;font-weight:700;overflow-wrap:anywhere}.tq31-kpi-value .tq-badge{vertical-align:middle}
.tq31-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(280px,.85fr);gap:12px;padding:0 20px 16px}.tq31-card{min-width:0;border:1px solid var(--tq31-line);border-radius:13px;background:var(--tq31-card2);padding:14px}.tq31-card h3{display:flex;align-items:center;gap:8px;margin:0 0 11px;font-size:12px;font-weight:800;color:#dce6f0}.tq31-table{width:100%;border-collapse:collapse;font-size:11px}.tq31-table th{text-align:left;color:var(--tq31-muted);font-size:9px;text-transform:uppercase;letter-spacing:.045em;font-weight:700;padding:7px 8px;border-bottom:1px solid var(--tq31-line)}.tq31-table td{padding:9px 8px;border-bottom:1px solid #1c2936;vertical-align:top}.tq31-table tr:last-child td{border-bottom:0}.tq31-step{margin-top:10px;padding:10px;border-radius:9px;background:#111e2a;color:#cbd7e3;font-size:11px}.tq31-step b{color:var(--tq31-text)}
.tq31-chart-stack{display:grid;gap:12px}.tq31-segments{display:flex;height:12px;border-radius:999px;overflow:hidden;background:#18232e}.tq31-segments span{display:block;height:100%}.tq31-segments .active{background:var(--tq31-blue)}.tq31-segments .waiting{background:var(--tq31-amber)}.tq31-segments .complete{background:var(--tq31-green)}.tq31-segments .paused{background:var(--tq31-gray)}.tq31-legend{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:10px;color:var(--tq31-muted);font-size:10px}.tq31-legend b{color:var(--tq31-text)}.tq31-bar-row{margin-top:9px}.tq31-bar-label{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--tq31-muted)}.tq31-bar-label b{color:#cbd7e3;font-weight:600}.tq31-bar-track{height:7px;border-radius:99px;background:#18232e;overflow:hidden;margin-top:5px}.tq31-bar-track i{display:block;height:100%;background:var(--tq31-blue);border-radius:99px;transition:width 180ms ease}.tq31-system-visual{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.tq31-system-visual span{display:block;border:1px solid var(--tq31-line);border-radius:9px;padding:9px;color:var(--tq31-muted);font-size:9px}.tq31-system-visual b{display:block;font-size:16px;color:var(--tq31-text);margin-bottom:2px}.tq31-system-visual .good{border-color:#285843}.tq31-system-visual .warn{border-color:#6b4d33}
.tq31-people,.tq31-systems{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.tq31-systems{grid-template-columns:repeat(3,minmax(0,1fr))}.tq31-people .tq-person,.tq31-systems .tq-system{min-width:0;border:1px solid var(--tq31-line);background:var(--tq31-card2);border-radius:10px;padding:10px}.tq31-people .tq-person{display:block}.tq31-people .tq-person b,.tq31-systems .tq-system b{display:block;font-size:10px;overflow-wrap:anywhere}.tq31-people .tq-person small,.tq31-systems .tq-system small{display:block;color:var(--tq31-muted);font-size:9px;margin-top:4px}.tq31-people .tq-person>small:last-child{display:none}.tq31-people .tq-badge,.tq31-systems .tq-badge{display:inline-flex;margin-top:7px;font-size:8px;padding:3px 6px}.tq31-section{padding:0 20px 16px}.tq31-section .tq31-card{padding:12px}.tq31-owner-event{color:var(--tq31-muted);font-size:10px}.tq31-owner-event b{color:var(--tq31-text)}.tq31-owner-action .tq-owner{padding:0;border:0;background:none!important;color:inherit!important;font-size:11px}.tq31-tech{margin-top:8px;border-top:1px solid var(--tq31-line);padding-top:10px;color:var(--tq31-muted);font-size:10px}.tq31-tech summary{cursor:pointer;color:#cbd7e3;font-weight:700}.tq31-build{color:var(--tq31-muted);font-size:10px;text-align:right}
@media(max-width:1100px){.tq31-kpis{grid-template-columns:1fr 1fr 1fr}.tq31-grid{grid-template-columns:1fr}.tq31-people{grid-template-columns:repeat(3,1fr)}}@media(max-width:760px){.tq31-top{display:block}.tq31-actions{justify-content:flex-start;margin-top:10px}.tq31-kpis{grid-template-columns:1fr 1fr}.tq31-people,.tq31-systems{grid-template-columns:1fr 1fr}.tq31-table thead{display:none}.tq31-table,.tq31-table tbody,.tq31-table tr,.tq31-table td{display:block;width:100%}.tq31-table tr{border:1px solid var(--tq31-line);border-radius:9px;padding:6px}.tq31-table td{border:0;padding:5px}.tq31-table td:before{content:attr(data-label);display:block;color:var(--tq31-muted);font-size:8px;text-transform:uppercase}}@media(max-width:500px){.tq31-kpis{grid-template-columns:1fr}.tq31-people,.tq31-systems,.tq31-system-visual{grid-template-columns:1fr}.tq31-grid,.tq31-kpis,.tq31-section{padding-left:12px;padding-right:12px}}
</style>`;

  const redesigned = `<section id="tigeriq-management-v31" data-version="${WEB_LOCAL_VERSION_V9}">${css}<div class="tq31-top"><div class="tq31-title"><h2>TigerIQ · Bảng điều hành</h2><p>Trạng thái thật từ CENTRAL #280 · Registry #335 · bằng chứng hiện hành</p></div><div><div class="tq31-actions"><button type="button" class="tq31-button" onclick="location.reload()">Làm mới</button><button type="button" class="tq31-button" onclick="document.getElementById('tq31-evidence').toggleAttribute('open')">Chi tiết</button></div><div class="tq31-build">${WEB_LOCAL_VERSION_V9}</div></div></div><div class="tq31-kpis"><article class="tq31-kpi"><div class="tq31-kpi-head">${icon('M4 6h16M4 12h10M4 18h7')}<span>Đang làm</span></div><b class="tq31-kpi-value">${currentWork}</b></article><article class="tq31-kpi"><div class="tq31-kpi-head">${icon('M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8')}<span>Ai phụ trách</span></div><b class="tq31-kpi-value">${owner}</b></article><article class="tq31-kpi"><div class="tq31-kpi-head">${icon('M4 12h16M4 7h10M4 17h13')}<span>Tiến độ</span></div><b class="tq31-kpi-value">${progress}</b></article><article class="tq31-kpi"><div class="tq31-kpi-head">${icon('M12 9v4M12 17h.01M10.3 3.6 2.2 18h19.6L13.7 3.6a2 2 0 0 0-3.4 0Z')}<span>Vướng mắc</span></div><b class="tq31-kpi-value">${blocker}</b></article><article class="tq31-kpi"><div class="tq31-kpi-head">${icon('M5 12h14M12 5v14')}<span>Cần anh Sơn</span></div><div class="tq31-kpi-value tq31-owner-action">${ownerAction}</div></article></div><div class="tq31-grid"><article class="tq31-card"><h3>${icon('M4 6h16M4 12h16M4 18h16')}Công việc đang chạy</h3><table class="tq31-table"><thead><tr><th>Công việc</th><th>Người phụ trách</th><th>Tiến độ</th><th>Trạng thái</th><th>Mốc kế tiếp</th><th>Cập nhật</th></tr></thead><tbody><tr><td data-label="Công việc">${currentWork}</td><td data-label="Người phụ trách">${owner}</td><td data-label="Tiến độ">${progress}</td><td data-label="Trạng thái">${status}</td><td data-label="Mốc kế tiếp">${next}</td><td data-label="Cập nhật">${updated}</td></tr></tbody></table><div class="tq31-step"><b>Bước hiện tại:</b> ${currentStep}</div></article><div class="tq31-chart-stack"><article class="tq31-card"><h3>${icon('M4 19V9M10 19V5M16 19v-7M22 19V3')}Phân bố công việc</h3><div class="tq31-segments"><span class="active" style="width:${pct(segments.active)}%"></span><span class="waiting" style="width:${pct(segments.waiting)}%"></span><span class="complete" style="width:${pct(segments.complete)}%"></span><span class="paused" style="width:${pct(segments.paused)}%"></span></div><div class="tq31-legend"><span><b>${segments.active}</b> đang xử lý</span><span><b>${segments.waiting}</b> đang chờ</span><span><b>${segments.complete}</b> hoàn tất</span><span><b>${segments.paused}</b> tạm ngưng</span></div></article><article class="tq31-card"><h3>${icon('M3 20h18M6 16v-4M12 16V7M18 16v-9')}Tải theo nhân sự</h3>${workloadBars(people)}</article><article class="tq31-card"><h3>${icon('M4 12a8 8 0 1 1 16 0 8 8 0 0 1-16 0Zm4 0h8')}Trạng thái hệ thống</h3>${systemVisual(systems)}</article></div></div><div class="tq31-section"><article class="tq31-card"><h3>${icon('M4 7h16M7 4v6M17 4v6M6 14h4M14 14h4M6 18h4M14 18h4')}Đội AI</h3><div class="tq31-people">${people}</div></article></div><div class="tq31-section"><article class="tq31-card"><h3>${icon('M4 5h16v12H4zM8 21h8M12 17v4')}Hệ thống</h3><div class="tq31-systems">${systems}</div></article></div><div class="tq31-section"><article class="tq31-card tq31-owner-event"><h3>${icon('M7 7h10v10H7zM3 12h4M17 12h4')}Quyền xử lý / chuyển giao</h3>${ownership}<details id="tq31-evidence" class="tq31-tech"><summary>Bằng chứng kỹ thuật</summary>${tech}</details></article></div></section>`;

  let out = html.replace(panel, redesigned);
  if (!out.includes('fonts.googleapis.com/css2?family=Inter')) out = out.replace('</head>', `${interLink}</head>`);
  return out;
}

async function proxy(options: OwnerCockpitV9Options, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers();
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers.set('content-type', contentType);
  const upstream = await fetch(`${options.cockpitUrl}${req.url ?? '/'}`, { method: req.method, headers, body: await readBody(req), redirect: 'manual' });
  const upstreamType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
  if (req.method === 'GET' && new URL(req.url ?? '/', 'http://local').pathname === '/' && upstream.ok && upstreamType.includes('text/html')) {
    const html = transformManagementUiV31(await upstream.text());
    copyHeaders(upstream, res, 'text/html; charset=utf-8');
    res.statusCode = upstream.status;
    res.end(html);
    return;
  }
  const payload = Buffer.from(await upstream.arrayBuffer());
  copyHeaders(upstream, res);
  res.statusCode = upstream.status;
  res.end(payload);
}

export async function startOwnerCockpitV9(options: OwnerCockpitV9Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public_bind_forbidden');
  const server = createServer(async (req, res) => {
    try { await proxy(options, req, res); }
    catch (error) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ error: 'owner_cockpit_v9_unavailable', detail: String(error instanceof Error ? error.message : error).slice(0, 160) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
