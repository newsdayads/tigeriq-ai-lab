import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServerTelemetry } from './server.js';
import { loadExecutiveDashboardV4, type ExecutiveDashboardV4, type ExecutiveSystemV4, type ExecutiveWorkV4 } from './executive-data-v4.js';

export const WEB_LOCAL_VERSION_V17 = 'WEB-LOCAL-396-V4.0';
const MAX_BODY_BYTES = 64 * 1024;

type View = 'overview' | 'work' | 'workforce' | 'models' | 'evidence' | 'reports' | 'system' | 'settings';

export interface OwnerCockpitV17Options {
  stableUrl: string;
  backendUrl: string;
  repo: string;
  host?: string;
  port?: number;
  loadData?: (telemetry: ServerTelemetry) => Promise<ExecutiveDashboardV4>;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
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

function viewFrom(urlValue: string | undefined): View {
  const value = new URL(urlValue ?? '/', 'http://local').searchParams.get('view') ?? 'overview';
  return ['overview', 'work', 'workforce', 'models', 'evidence', 'reports', 'system', 'settings'].includes(value) ? value as View : 'overview';
}

function svg(path: string, cls = 'x-icon'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
}

const icons = {
  tiger: 'M5 8 4 4l4 2.2A8 8 0 0 1 12 5a8 8 0 0 1 4 1.2L20 4l-1 4v4c0 5-3 8-7 9-4-1-7-4-7-9V8ZM8 10h2M14 10h2M9 14c1.8 1.5 4.2 1.5 6 0M12 8v4M9 7l1.5 2M15 7l-1.5 2',
  home: 'M3 11.5 12 4l9 7.5M5.5 10.5V20h13v-9.5M9.5 20v-6h5v6',
  tasks: 'M7 5h13M7 12h13M7 19h13M3.5 5h.01M3.5 12h.01M3.5 19h.01',
  folder: 'M3 6.5h7l2 2h9v10.5H3z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  server: 'M4 5h16v6H4zM4 14h16v5H4zM8 8h.01M8 16.5h.01M12 8h5M12 16.5h5',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.1v4H21a1.7 1.7 0 0 0-1.6 1Z',
  search: 'M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  refresh: 'M20 7v5h-5M4 17v-5h5M18 12a6 6 0 0 0-10-4L5 11M6 12a6 6 0 0 0 10 4l3-3',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  person: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  bars: 'M5 20V10h3v10H5Zm6 0V4h3v16h-3Zm6 0v-7h3v7h-3Z',
  warning: 'M12 3 22 20H2L12 3Zm0 6v5m0 3h.01',
  chat: 'M4 5h16v12H9l-5 4V5Zm4 5h8m-8 4h5',
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  pulse: 'M3 12h4l2-5 4 10 2-5h6',
  check: 'm5 12 4 4L19 6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-18c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3ZM3.5 12h17',
  network: 'M12 5a3 3 0 1 0 0 .01M5 19a3 3 0 1 0 0 .01M19 19a3 3 0 1 0 0 .01M10 7 6.5 16M14 7l3.5 9M8 19h8',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19 13v-2l-2-.7-.6-1.4.9-1.9-1.4-1.4-1.9.9-1.4-.6L12 4h-2l-.7 1.9-1.4.6-1.9-.9L4.6 7l.9 1.9-.6 1.4L3 11v2l1.9.7.6 1.4-.9 1.9L6 18.4l1.9-.9 1.4.6L10 20h2l.7-1.9 1.4-.6 1.9.9 1.4-1.4-.9-1.9.6-1.4L19 13Z',
} as const;

function toneClass(tone: string): string {
  return ['active', 'waiting', 'blocked', 'done', 'paused', 'unknown'].includes(tone) ? tone : 'unknown';
}

function primaryNav(active: View): string {
  const rows: Array<[View, string, string]> = [
    ['overview', 'Tổng quan', icons.home],
    ['work', 'Công việc', icons.tasks],
    ['models', 'Dự án', icons.folder],
    ['workforce', 'Nhân sự', icons.users],
    ['system', 'Hệ thống', icons.server],
    ['reports', 'Báo cáo', icons.chart],
    ['settings', 'Cài đặt', icons.settings],
  ];
  return rows.map(([view, label, path]) => `<a class="${active === view || (active === 'evidence' && view === 'system') ? 'on' : ''}" href="/?view=${view}">${svg(path)}<span>${label}</span></a>`).join('');
}

function brand(): string {
  return `<div class="x-brand"><div class="x-brandmark">${svg(icons.tiger, 'x-tiger')}</div><div><strong>TigerIQ AI Lab</strong><span>Bảng điều hành</span></div></div>`;
}

function sidebar(active: View): string {
  return `<aside class="x-sidebar">${brand()}<nav class="x-nav">${primaryNav(active)}</nav><div class="x-side-bottom"><em>Smarter People<br>Bigger Impact</em><span>TigerIQ AI Lab<br>v4.0.0</span></div></aside>`;
}

function header(title = 'TigerIQ AI Lab', subtitle = 'Bảng điều hành', live = false): string {
  return `<header class="x-header"><div class="x-title"><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="x-header-tools"><form class="x-search" method="get" action="/"><input type="hidden" name="view" value="work"><span>${svg(icons.search)}</span><input name="q" placeholder="Tìm kiếm công việc, người phụ trách…" aria-label="Tìm kiếm"></form>${live ? `<div class="x-live" id="x-live"><i></i><span>Live · 10s</span><small id="x-live-age">vừa cập nhật</small></div><button class="x-iconbtn" id="x-refresh" type="button" title="Cập nhật ngay">${svg(icons.refresh)}</button>` : ''}<div class="x-owner"><b>AS</b><span><strong>Anh Sơn</strong><small>Owner</small></span></div></div></header>`;
}

function progressBar(work: ExecutiveWorkV4): string {
  if (work.progressPercent === null) return `<div class="x-progress"><strong>${esc(work.progressLabel)}</strong><span class="x-bar"><i style="width:0"></i></span></div>`;
  return `<div class="x-progress"><strong>${work.progressPercent}%</strong><span class="x-bar"><i style="width:${work.progressPercent}%"></i></span></div>`;
}

function kpis(data: ExecutiveDashboardV4): string {
  const progress = data.progressAverage === null ? '—' : `${data.progressAverage}%`;
  const rows = [
    ['blue', icons.list, 'Đang làm', String(data.activeCount), `${data.works.length} việc được xác minh`],
    ['purple', icons.person, 'Ai phụ trách', '5', 'thành viên trong đội'],
    ['green', icons.bars, 'Tiến độ', progress, data.progressAverage === null ? 'chưa có % xác minh' : 'trung bình dữ liệu có %'],
    ['orange', icons.warning, 'Vướng mắc', String(data.blockedCount), data.blockedCount ? 'cần xử lý' : 'không có blocker'],
    ['emerald', icons.chat, 'Cần anh Sơn', data.ownerActionRequired ? '1' : '0', data.ownerActionRequired ? 'việc đang chờ' : 'mọi thứ ổn'],
  ];
  return `<section class="x-kpis" data-live-section="kpis">${rows.map(([tone, path, label, value, note]) => `<article class="x-kpi ${tone}"><div class="x-kpi-head"><span>${svg(path)}</span><b>${esc(label)}</b></div><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('')}</section>`;
}

function workTable(data: ExecutiveDashboardV4): string {
  const rows = data.works.slice(0, 5).map((work, index) => `<tr><td class="x-index">${index + 1}</td><td><div class="x-work-title"><i class="x-dot ${toneClass(work.tone)}"></i><a href="/?view=work&work=${work.number ?? ''}">${work.number ? `#${work.number} · ` : ''}${esc(work.title)}</a></div></td><td><b>${esc(work.owner)}</b></td><td>${progressBar(work)}</td><td><span class="x-status ${toneClass(work.tone)}"><i></i>${esc(work.status)}</span></td><td>${esc(work.next)}<small>${esc(work.updated)}</small></td></tr>`).join('');
  return `<section class="x-card x-work-card" data-live-section="work"><div class="x-card-head"><h2>${svg(icons.list)} Công việc đang chạy</h2><div><a class="x-add" href="/?view=work#cong-viec">${svg(icons.plus)} Thêm công việc</a><button class="x-more" type="button" aria-label="Thêm tùy chọn">${svg(icons.more)}</button></div></div><div class="x-table-wrap"><table class="x-table"><thead><tr><th>#</th><th>Việc</th><th>Người phụ trách</th><th>Tiến độ</th><th>Trạng thái</th><th>Mốc kế tiếp</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="x-empty">Chưa có công việc được xác minh.</td></tr>'}</tbody></table></div></section>`;
}

function distribution(data: ExecutiveDashboardV4): string {
  const total = data.works.length;
  const pct = (value: number) => total ? Math.round(value / total * 100) : 0;
  const a = pct(data.activeCount), w = pct(data.waitingCount), b = pct(data.blockedCount), p = pct(data.pausedCount);
  const e1 = a, e2 = a + w, e3 = a + w + b, e4 = a + w + b + p;
  const background = total ? `conic-gradient(#33c975 0 ${e1}%,#ff9f43 ${e1}% ${e2}%,#ff5e78 ${e2}% ${e3}%,#8ea2c0 ${e3}% ${e4}%,#36a8ff ${e4}% 100%)` : '#1a3556';
  const items: Array<[string, number, string]> = [['Đang làm', data.activeCount, 'active'], ['Chờ xử lý', data.waitingCount, 'waiting'], ['Vướng mắc', data.blockedCount, 'blocked'], ['Tạm ngưng', data.pausedCount, 'paused']];
  return `<section class="x-card x-analytics" data-live-section="distribution"><div class="x-card-head"><h2>${svg(icons.globe)} Phân bổ công việc</h2>${svg(icons.more)}</div><div class="x-donut-row"><div class="x-donut" style="background:${background}"><span><b>${total}</b><small>công việc</small></span></div><div class="x-legend">${items.map(([label, value, tone]) => `<div><i class="x-dot ${tone}"></i><span>${label}</span><b>${value}</b><small>${pct(value)}%</small></div>`).join('')}</div></div></section>`;
}

function workload(data: ExecutiveDashboardV4): string {
  const max = Math.max(1, ...data.people.map((p) => p.activeCount));
  return `<section class="x-card x-load" data-live-section="load"><div class="x-card-head"><h2>${svg(icons.chart)} Tải theo nhân sự</h2>${svg(icons.more)}</div><div class="x-load-list">${data.people.map((person) => `<div><span>${esc(person.name.replace(/\s*\([^)]*\)/, ''))}</span><div class="x-loadbar"><i class="${toneClass(person.tone)}" style="width:${Math.round(person.activeCount / max * 100)}%"></i></div><small>${person.activeCount} việc đang xử lý</small></div>`).join('')}</div></section>`;
}

function systemSummary(data: ExecutiveDashboardV4): string {
  const active = data.systems.filter((row) => row.tone === 'active' || row.tone === 'done').length;
  const warning = data.systems.filter((row) => row.tone === 'waiting' || row.tone === 'blocked').length;
  const unknown = data.systems.length - active - warning;
  return `<section class="x-card x-state" data-live-section="system-summary"><div class="x-card-head"><h2>${svg(icons.pulse)} Trạng thái hệ thống</h2>${svg(icons.more)}</div><div class="x-state-grid"><article class="ok"><b>${active}</b><small>Hoạt động</small></article><article class="warn"><b>${warning}</b><small>Cảnh báo</small></article><article class="unknown"><b>${unknown}</b><small>Chưa xác minh</small></article></div></section>`;
}

function team(data: ExecutiveDashboardV4): string {
  const tones = ['blue', 'purple', 'green', 'orange', 'violet'];
  return `<section class="x-card x-team" data-live-section="team"><div class="x-card-head"><h2>${svg(icons.users)} Đội AI</h2><a href="/?view=workforce">Xem chi tiết →</a></div><div class="x-team-grid">${data.people.map((person, index) => `<article><div class="x-avatar ${tones[index]}">${esc(person.initials)}</div><h3>${esc(person.name)}</h3><span class="x-status ${toneClass(person.tone)}"><i></i>${esc(person.status)}</span><p>${esc(person.current)}</p></article>`).join('')}</div></section>`;
}

function systemIcon(row: ExecutiveSystemV4): string {
  if (row.key === 'pc01') return svg(icons.server);
  if (row.key === 'control') return svg(icons.network);
  if (row.key === 'web') return svg(icons.globe);
  return svg(icons.gear);
}

function systems(data: ExecutiveDashboardV4): string {
  return `<section class="x-card x-systems" data-live-section="systems"><div class="x-card-head"><h2>${svg(icons.settings)} Hệ thống</h2><a href="/?view=system">Xem chi tiết →</a></div><div class="x-system-grid">${data.systems.slice(0, 4).map((row) => `<article><span class="x-system-icon ${toneClass(row.tone)}">${systemIcon(row)}</span><div><h3>${esc(row.name)}</h3><span class="x-status ${toneClass(row.tone)}"><i></i>${esc(row.status)}</span><p>${esc(row.note)}</p></div></article>`).join('')}</div></section>`;
}

function ownerCard(data: ExecutiveDashboardV4): string {
  const attention = data.ownerActionRequired;
  return `<section class="x-card x-owner-card ${attention ? 'attention' : 'good'}" data-live-section="owner"><div class="x-card-head"><h2>${svg(icons.chat)} Cần anh Sơn</h2><a href="/?view=evidence">Xem lịch sử →</a></div><div class="x-owner-body"><span>${svg(attention ? icons.warning : icons.check)}</span><div><b>${esc(data.ownerActionText)}</b><small>${attention ? 'Có hạng mục cần anh Sơn xem xét.' : 'Mọi thứ đang trong tầm kiểm soát!'}</small></div></div></section>`;
}

const BASE_CSS = `
:root{font-family:"Segoe UI",Arial,sans-serif;color-scheme:dark;--bg:#041229;--bg2:#071b37;--sidebar:#07172d;--panel:#0a213f;--panel2:#0d294d;--line:#1f4773;--text:#f6f9ff;--muted:#9fb2ca;--blue:#2aa8ff;--green:#2fd17a;--orange:#ff9f43;--red:#ff5e78;--purple:#7b48ff}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:radial-gradient(circle at 52% -15%,#123a75 0,#071b37 34%,#041229 70%,#031022 100%);color:var(--text);font:400 15px/1.45 "Segoe UI",Arial,sans-serif}a{color:inherit;text-decoration:none}.x-app{min-height:100vh;display:grid;grid-template-columns:138px minmax(0,1fr);grid-template-rows:68px auto}.x-sidebar{grid-row:1/3;background:linear-gradient(180deg,#071a33 0,#06152a 64%,#071a33 100%);border-right:1px solid #1c3d65;padding:14px 7px 17px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;z-index:5}.x-brand{height:55px;display:flex;align-items:center;gap:9px;padding:0 10px 12px;border-bottom:1px solid rgba(78,125,177,.2)}.x-brandmark{width:34px;height:38px;display:grid;place-items:center;color:#ffad2f}.x-tiger{width:31px;height:31px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.x-brand strong{display:block;font-size:0}.x-brand strong::after{content:"TigerIQ";font-size:12px;font-weight:700;white-space:nowrap}.x-brand span{font-size:11px;color:#97acc4;display:none}.x-nav{display:flex;flex-direction:column;gap:7px;margin-top:15px}.x-nav a{height:47px;padding:0 11px;display:flex;align-items:center;gap:10px;color:#95abc5;border-radius:6px;font-size:13px;transition:.16s}.x-nav a:hover{background:rgba(21,89,159,.28);color:#fff}.x-nav a.on{color:#fff;background:linear-gradient(90deg,#0c6bbd,#135a9d);box-shadow:inset 3px 0 0 #36bcff}.x-nav .x-icon{width:19px;height:19px}.x-side-bottom{margin-top:auto;padding:12px 13px;color:#8fa5bf;font-size:11px;display:flex;flex-direction:column;gap:34px}.x-side-bottom em{font-style:italic}.x-header{grid-column:2;height:68px;border-bottom:1px solid rgba(53,98,149,.32);background:linear-gradient(90deg,rgba(6,25,52,.92),rgba(9,37,77,.83),rgba(5,22,47,.93));display:flex;align-items:center;justify-content:space-between;padding:0 20px;position:sticky;top:0;z-index:4;backdrop-filter:blur(14px)}.x-title h1{margin:0;font-size:21px;line-height:1.15;font-weight:650;letter-spacing:-.02em}.x-title p{margin:3px 0 0;color:#a9bdd4;font-size:13px}.x-header-tools{display:flex;align-items:center;gap:10px}.x-search{width:310px;height:39px;border:1px solid #2a5181;background:#0d2a50;border-radius:8px;display:flex;align-items:center;padding:0 11px;color:#9cb7d5}.x-search .x-icon{width:17px;height:17px;flex:none}.x-search input{width:100%;border:0;outline:0;background:transparent;color:#eaf4ff;padding:0 8px;font:inherit;font-size:13px}.x-live{height:36px;border:1px solid #244a74;border-radius:8px;padding:0 9px;display:flex;align-items:center;gap:6px;color:#9fb6d0;font-size:11px}.x-live i{width:7px;height:7px;background:#23d493;border-radius:50%;box-shadow:0 0 0 4px rgba(35,212,147,.08)}.x-live small{color:#748eaa}.x-iconbtn{width:36px;height:36px;border:1px solid #274f7c;border-radius:8px;background:#0b294e;color:#c9dcef;display:grid;place-items:center;cursor:pointer}.x-iconbtn .x-icon{width:17px;height:17px}.x-owner{display:flex;align-items:center;gap:9px;padding-left:8px}.x-owner>b{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#166fe0;color:#fff}.x-owner span{display:flex;flex-direction:column;min-width:74px}.x-owner strong{font-size:12px}.x-owner small{font-size:11px;color:#9db2ca}.x-main{grid-column:2;padding:13px 17px 9px;min-width:0}.x-icon{fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}.x-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:13px}.x-kpi{height:151px;border-radius:11px;padding:15px 18px;position:relative;overflow:hidden;border:1px solid rgba(86,160,229,.5);box-shadow:0 8px 24px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.09)}.x-kpi::after{content:"";position:absolute;width:180px;height:90px;border:1px solid rgba(255,255,255,.08);border-radius:50%;right:-45px;bottom:-50px;transform:rotate(-18deg)}.x-kpi.blue{background:linear-gradient(135deg,#064b9f,#096ecc 66%,#0a5ca8)}.x-kpi.purple{background:linear-gradient(135deg,#3e1b94,#5925cb 63%,#4320a0)}.x-kpi.green{background:linear-gradient(135deg,#087a64,#079070 64%,#086b58)}.x-kpi.orange{background:linear-gradient(135deg,#7a351a,#974d1c 64%,#71341e);border-color:#be7626}.x-kpi.emerald{background:linear-gradient(135deg,#08744b,#078151 64%,#08633f)}.x-kpi-head{display:flex;align-items:center;gap:11px}.x-kpi-head>span{width:44px;height:44px;border-radius:9px;display:grid;place-items:center;background:rgba(20,162,255,.86);box-shadow:0 6px 16px rgba(0,0,0,.17)}.x-kpi.purple .x-kpi-head>span{background:#7537ff}.x-kpi.green .x-kpi-head>span{background:#35bf67}.x-kpi.orange .x-kpi-head>span{background:#ef702e}.x-kpi.emerald .x-kpi-head>span{background:#27b967}.x-kpi-head .x-icon{width:25px;height:25px}.x-kpi-head b{font-size:16px;font-weight:650}.x-kpi>strong{display:block;font-size:36px;line-height:1;margin:17px 0 6px;font-weight:700;letter-spacing:-.03em}.x-kpi>small{font-size:13px;color:#e1ecfa}.x-overview-grid{display:grid;grid-template-columns:minmax(0,2.55fr) minmax(340px,1fr);gap:13px;align-items:start}.x-card{background:linear-gradient(180deg,rgba(11,34,65,.96),rgba(8,28,54,.97));border:1px solid #214a78;border-radius:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 9px 24px rgba(0,0,0,.13);min-width:0}.x-card-head{height:54px;display:flex;align-items:center;justify-content:space-between;padding:0 15px;border-bottom:1px solid rgba(59,104,153,.2)}.x-card-head h2{margin:0;display:flex;align-items:center;gap:10px;font-size:17px;font-weight:650}.x-card-head h2 .x-icon{width:21px;height:21px;color:#24baff}.x-card-head>a{font-size:12px;color:#b7cae0}.x-card-head>div{display:flex;gap:7px}.x-add{height:34px;padding:0 11px;border-radius:7px;background:#0875dc;display:flex;align-items:center;gap:6px;font-size:12px}.x-add .x-icon{width:15px;height:15px}.x-more{width:34px;height:34px;border:0;border-radius:7px;background:#0e2b51;color:#a8bfd9;display:grid;place-items:center}.x-more .x-icon,.x-card-head>.x-icon{width:19px;height:19px}.x-table-wrap{overflow:auto;padding:0 11px 14px}.x-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}.x-table thead th{height:39px;text-align:left;background:#123960;color:#a9c0db;font-size:12px;font-weight:600;border-bottom:1px solid #25517f}.x-table thead th:first-child{padding-left:13px;border-radius:6px 0 0 0}.x-table thead th:last-child{border-radius:0 6px 0 0}.x-table td{height:52px;border-bottom:1px solid rgba(43,77,118,.58);vertical-align:middle;padding:7px 8px}.x-index{width:36px;color:#b6cae0}.x-work-title{display:flex;align-items:center;gap:12px;min-width:230px}.x-work-title a{font-weight:550}.x-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex:none;background:#8296b2}.x-dot.active{background:#31cb72}.x-dot.waiting{background:#ff9d4a}.x-dot.blocked{background:#ff5d77}.x-dot.paused{background:#8ea2c0}.x-dot.done{background:#38a9ff}.x-progress{display:flex;align-items:center;gap:10px;min-width:150px}.x-progress strong{width:35px;color:#56b9ff;font-weight:500}.x-bar{height:9px;width:110px;background:#17395e;border-radius:999px;overflow:hidden}.x-bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#269ee7,#38b9ff)}.x-status{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:650;background:#173252;color:#a9bdd4;white-space:nowrap}.x-status i{width:7px;height:7px;border-radius:50%;background:currentColor}.x-status.active{background:#0c3d35;color:#36dd8c}.x-status.waiting{background:#50351c;color:#ffae58}.x-status.blocked{background:#4b2331;color:#ff7489}.x-status.done{background:#123b58;color:#52baff}.x-status.paused,.x-status.unknown{background:#23364f;color:#a8bbd1}.x-table td:last-child{max-width:210px}.x-table td:last-child small{display:block;color:#8da5c0;font-size:11px;margin-top:2px}.x-empty{text-align:center;color:#8da5c0;height:140px!important}.x-right{display:flex;flex-direction:column;gap:11px}.x-analytics{min-height:176px}.x-donut-row{display:flex;align-items:center;gap:18px;padding:13px 16px}.x-donut{width:108px;height:108px;border-radius:50%;display:grid;place-items:center;position:relative;flex:none}.x-donut::after{content:"";position:absolute;inset:20px;background:#0a2548;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.03)}.x-donut span{position:relative;z-index:1;text-align:center}.x-donut b{display:block;font-size:27px;line-height:1}.x-donut small{font-size:10px;color:#a9bdd4}.x-legend{flex:1;display:grid;gap:7px}.x-legend>div{display:grid;grid-template-columns:12px 1fr 26px 35px;align-items:center;gap:7px;font-size:11px}.x-legend small{color:#9fb4cc;text-align:right}.x-load{min-height:163px}.x-load-list{padding:11px 15px;display:grid;gap:7px}.x-load-list>div{display:grid;grid-template-columns:64px 1fr 112px;gap:8px;align-items:center;font-size:11px}.x-loadbar{height:9px;background:#16375c;border-radius:999px;overflow:hidden}.x-loadbar i{display:block;height:100%;background:#2aa8ed;border-radius:inherit;min-width:0}.x-loadbar i.paused{background:#ff9d4a}.x-load-list small{text-align:right;color:#a7bad1}.x-state{min-height:111px}.x-state-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:10px 12px}.x-state-grid article{height:58px;border:1px solid #28527e;border-radius:8px;padding:8px 10px;background:#0a294d}.x-state-grid article.ok{border-color:#167656;background:linear-gradient(135deg,#0b4c3c,#0b3b33)}.x-state-grid article.warn{border-color:#8c6029;background:linear-gradient(135deg,#4b351e,#30281f)}.x-state-grid article.unknown{border-color:#314f74}.x-state-grid b{display:block;font-size:19px}.x-state-grid small{font-size:10px;color:#a9bdd4}.x-bottom-grid{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1.55fr) minmax(350px,1fr) minmax(340px,1.02fr);gap:13px;align-items:stretch}.x-team,.x-systems{min-height:232px}.x-team-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:11px}.x-team-grid article{border:1px solid #1d4774;background:#0b274a;border-radius:8px;padding:9px 9px 10px;min-width:0;text-align:left}.x-avatar{width:43px;height:43px;border-radius:50%;display:grid;place-items:center;margin:0 auto 7px;font-size:14px;font-weight:750;color:#fff;box-shadow:0 6px 16px rgba(0,0,0,.2)}.x-avatar.blue{background:#259fe8}.x-avatar.purple{background:#7d42ed}.x-avatar.green{background:#31c47c}.x-avatar.orange{background:#ff9946}.x-avatar.violet{background:#ac48e8}.x-team h3{font-size:12px;text-align:center;margin:0 0 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.x-team .x-status{display:flex;width:max-content;margin:0 auto 8px}.x-team p{font-size:10px;line-height:1.35;color:#b1c3d7;text-align:center;margin:0;height:28px;overflow:hidden}.x-system-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:11px}.x-system-grid article{height:78px;border:1px solid #1e4772;background:#0c294d;border-radius:8px;padding:9px;display:grid;grid-template-columns:46px 1fr;gap:9px;align-items:center}.x-system-icon{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:#165aa1;color:#fff}.x-system-icon.active{background:#0e6e54}.x-system-icon.unknown,.x-system-icon.paused{background:#334b67}.x-system-icon .x-icon{width:23px;height:23px}.x-system-grid h3{font-size:11px;margin:0 0 3px}.x-system-grid .x-status{font-size:9px;padding:2px 5px}.x-system-grid p{font-size:9px;color:#a8bdd4;margin:4px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.x-owner-card{min-height:145px;border-color:#11815b;background:linear-gradient(135deg,#07583f,#08714d 62%,#075b41);position:relative;overflow:hidden}.x-owner-card.attention{border-color:#b36e26;background:linear-gradient(135deg,#61361d,#7d431e)}.x-owner-card::after{content:"";position:absolute;width:170px;height:90px;border:1px solid rgba(51,209,164,.25);border-radius:50%;right:-35px;bottom:-55px;transform:rotate(-12deg)}.x-owner-card .x-card-head{border-bottom:0}.x-owner-card .x-card-head h2 .x-icon{color:#44e2a5}.x-owner-body{display:flex;align-items:center;justify-content:center;gap:18px;padding:3px 17px 17px;text-align:left}.x-owner-body>span{width:44px;height:44px;border-radius:50%;background:#20d18c;display:grid;place-items:center;box-shadow:0 0 24px rgba(32,209,140,.25)}.x-owner-body>span .x-icon{width:24px;height:24px}.x-owner-body b{display:block;font-size:13px}.x-owner-body small{display:block;margin-top:4px;font-size:10px;color:#d4f6e8}.x-footer{grid-column:1/-1;min-height:36px;border-top:1px solid rgba(48,90,137,.24);display:flex;align-items:center;justify-content:space-between;color:#88a1bd;font-size:11px;font-style:italic;padding:8px 7px 0}.x-flash{animation:xflash .72s ease}@keyframes xflash{0%{filter:brightness(1)}35%{filter:brightness(1.16)}100%{filter:brightness(1)}}@media(max-width:1250px){.x-kpis{grid-template-columns:repeat(3,1fr)}.x-overview-grid{grid-template-columns:1fr}.x-right{display:grid;grid-template-columns:repeat(3,1fr)}.x-bottom-grid{grid-template-columns:1fr 1fr}.x-owner-card{grid-column:1/-1}.x-team-grid{grid-template-columns:repeat(5,1fr)}}@media(max-width:900px){.x-app{grid-template-columns:76px 1fr}.x-brand>div:last-child,.x-nav span,.x-side-bottom{display:none}.x-brand{justify-content:center;padding:0 0 12px}.x-nav a{justify-content:center;padding:0}.x-header,.x-main{grid-column:2}.x-search{width:220px}.x-owner span,.x-live small{display:none}.x-kpis{grid-template-columns:1fr 1fr}.x-right{grid-template-columns:1fr}.x-bottom-grid{grid-template-columns:1fr}.x-team-grid{grid-template-columns:repeat(5,1fr)}}@media(max-width:650px){.x-app{display:block}.x-sidebar{position:static;height:auto;display:block}.x-brand{display:none}.x-nav{margin:0;display:grid;grid-template-columns:repeat(4,1fr)}.x-nav a{height:40px}.x-header{position:static;height:auto;padding:10px;display:block}.x-header-tools{margin-top:9px}.x-search{width:100%}.x-owner,.x-live{display:none}.x-main{padding:10px}.x-kpis{grid-template-columns:1fr}.x-overview-grid{display:block}.x-right,.x-bottom-grid{display:block}.x-card{margin-bottom:10px}.x-team-grid{grid-template-columns:1fr 1fr}.x-table{min-width:820px}}
`;

function liveScript(): string {
  return `<script id="x-live-script">(()=>{const names=['kpis','work','distribution','load','system-summary','team','systems','owner'];let busy=false,last=Date.now();const age=document.getElementById('x-live-age');function tick(){if(!age)return;const s=Math.floor((Date.now()-last)/1000);age.textContent=s<5?'vừa cập nhật':s+'s trước'}async function update(){if(busy||document.hidden)return;busy=true;try{const r=await fetch(location.href,{cache:'no-store',headers:{'X-TigerIQ-Refresh':'1'}});if(!r.ok)throw new Error(String(r.status));const doc=new DOMParser().parseFromString(await r.text(),'text/html');for(const name of names){const a=document.querySelector('[data-live-section="'+name+'"]');const b=doc.querySelector('[data-live-section="'+name+'"]');if(a&&b&&a.innerHTML!==b.innerHTML){a.innerHTML=b.innerHTML;a.classList.remove('x-flash');void a.offsetWidth;a.classList.add('x-flash')}}last=Date.now()}catch{}finally{busy=false}}document.getElementById('x-refresh')?.addEventListener('click',update);setInterval(update,10000);setInterval(tick,1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-last>10000)update()})})();</script>`;
}

export function renderExecutiveOverviewV4(data: ExecutiveDashboardV4): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TigerIQ — Bảng điều hành</title><style id="x-executive-v4">${BASE_CSS}</style></head><body><div class="x-app" data-version="${WEB_LOCAL_VERSION_V17}" data-layout="executive-reference-1648x928" data-font="segoe-ui">${sidebar('overview')}${header('TigerIQ AI Lab','Bảng điều hành',true)}<main class="x-main">${kpis(data)}<div class="x-overview-grid"><div>${workTable(data)}</div><div class="x-right">${distribution(data)}${workload(data)}${systemSummary(data)}</div><div class="x-bottom-grid">${team(data)}${systems(data)}${ownerCard(data)}</div><footer class="x-footer"><span>“AI giúp chúng ta đi nhanh hơn, nhưng con người tạo ra hành trình ý nghĩa.”</span><span>TigerIQ AI Lab &nbsp;|&nbsp; Kiến tạo giá trị thực bằng AI</span></footer></div></main></div>${liveScript()}</body></html>`;
}

function replacePrimaryNav(html: string, active: View): string {
  const nav = `<nav class="nav x-nav">${primaryNav(active)}</nav>`;
  return html.replace(/<nav class="nav">[\s\S]*?<\/nav>/, nav);
}

function functionalSubnav(view: View): string {
  if (view === 'models') return '<div class="x-subnav"><a class="on" href="/?view=models">Dự án / Mô hình AI</a></div>';
  if (view === 'system' || view === 'evidence') return `<div class="x-subnav"><a class="${view === 'system' ? 'on' : ''}" href="/?view=system">Hệ thống</a><a class="${view === 'evidence' ? 'on' : ''}" href="/?view=evidence">Bằng chứng</a></div>`;
  return '';
}

export function themeFunctionalPageV4(input: string, view: View): string {
  let html = input
    .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi, '')
    .replace(/@import\s+url\([^)]*fonts\.googleapis\.com[^)]*\);?/gi, '')
    .replace(/<meta\s+http-equiv=["']refresh["'][^>]*>/gi, '');
  html = replacePrimaryNav(html, view);
  html = html.replace(/<a class="brand"[\s\S]*?<\/a>/, `<div class="brand x-functional-brand">${brand()}</div>`);
  html = html.replace('<main class="content">', `<main class="content">${functionalSubnav(view)}`);
  html = html.replace('<body', `<body data-version="${WEB_LOCAL_VERSION_V17}" data-layout="executive-functional-v4"`);
  const css = `<style id="x-functional-v4">${BASE_CSS}
body{background:radial-gradient(circle at 52% -15%,#123a75 0,#071b37 34%,#041229 70%,#031022 100%)!important;color:#f6f9ff!important;font:400 15px/1.45 "Segoe UI",Arial,sans-serif!important}.shell{display:grid!important;grid-template-columns:138px minmax(0,1fr)!important;min-height:100vh!important;background:transparent!important}.sidebar{width:auto!important;position:sticky!important;top:0!important;height:100vh!important;padding:14px 7px 17px!important;background:linear-gradient(180deg,#071a33,#06152a 64%,#071a33)!important;border-right:1px solid #1c3d65!important}.x-functional-brand{display:block!important;padding:0!important;border:0!important}.x-functional-brand>.x-brand{display:flex!important}.sidebar>.nav,.sidebar>.x-nav{margin-top:15px!important;display:flex!important;flex-direction:column!important;gap:7px!important}.sidebar .x-nav a{height:47px!important;padding:0 11px!important;display:flex!important}.sidebar .foot{border-top:1px solid rgba(78,125,177,.2)!important;color:#8fa5bf!important}.content{min-width:0!important;padding:15px 18px 28px!important;background:transparent!important}.top{min-height:66px!important;margin:-15px -18px 14px!important;padding:0 20px!important;background:linear-gradient(90deg,rgba(6,25,52,.92),rgba(9,37,77,.83),rgba(5,22,47,.93))!important;border-bottom:1px solid rgba(53,98,149,.32)!important}.top h1{font-size:21px!important;font-weight:650!important}.top p{font-size:13px!important;color:#a9bdd4!important}.search{border:1px solid #2a5181!important;background:#0d2a50!important;border-radius:8px!important}.panel,.grid-main,.detail,.assign,.login,.kpis>article{background:linear-gradient(180deg,rgba(11,34,65,.96),rgba(8,28,54,.97))!important;border:1px solid #214a78!important;border-radius:12px!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 9px 24px rgba(0,0,0,.13)!important}.panel,.grid-main,.detail{margin-bottom:12px!important}.panel h2,.panel h3,.grid-main h2,.detail h2{color:#f6f9ff!important}.muted,small{color:#9fb2ca!important}.btn,button{font-family:"Segoe UI",Arial,sans-serif!important}.x-subnav{display:flex;gap:7px;margin:0 0 12px}.x-subnav a{padding:7px 11px;border:1px solid #28527e;border-radius:8px;background:#0a294d;color:#a9bfd8;font-size:12px}.x-subnav a.on{background:#0c6bbd;color:#fff;border-color:#1a89e8}@media(max-width:760px){.shell{grid-template-columns:1fr!important}.sidebar{position:static!important;height:auto!important}.sidebar>.nav,.sidebar>.x-nav{display:grid!important;grid-template-columns:repeat(4,1fr)!important}.content{padding:10px!important}.top{margin:-10px -10px 10px!important}}
</style>`;
  return html.replace('</head>', `${css}</head>`);
}

function copyHeaders(upstream: Response, res: ServerResponse, overview = false): void {
  const blocked = new Set(['content-length', 'transfer-encoding', 'connection', 'content-encoding', 'content-security-policy']);
  for (const [key, value] of upstream.headers.entries()) if (!blocked.has(key.toLowerCase())) res.setHeader(key, value);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-security-policy', overview
    ? "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    : "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

async function relay(options: OwnerCockpitV17Options, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers();
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers.set('content-type', contentType);
  const upstream = await fetch(`${options.stableUrl}${req.url ?? '/'}`, { method: req.method, headers, body: await readBody(req), redirect: 'manual' });
  const type = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
  const path = new URL(req.url ?? '/', 'http://local').pathname;
  const view = viewFrom(req.url);
  if (req.method === 'GET' && path === '/' && upstream.ok && type.includes('text/html')) {
    const stableHtml = await upstream.text();
    if (/class="login"/.test(stableHtml)) {
      copyHeaders(upstream, res, false);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.statusCode = upstream.status;
      res.end(themeFunctionalPageV4(stableHtml, view));
      return;
    }
    if (view === 'overview') {
      const telemetryResponse = await fetch(`${options.backendUrl}/api/server`, { cache: 'no-store' });
      if (!telemetryResponse.ok) throw new Error('telemetry_unavailable');
      const telemetry = await telemetryResponse.json() as ServerTelemetry;
      const data = await (options.loadData ? options.loadData(telemetry) : loadExecutiveDashboardV4(options.repo, telemetry));
      copyHeaders(upstream, res, true);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.statusCode = 200;
      res.end(renderExecutiveOverviewV4(data));
      return;
    }
    copyHeaders(upstream, res, false);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.statusCode = upstream.status;
    res.end(themeFunctionalPageV4(stableHtml, view));
    return;
  }
  copyHeaders(upstream, res, false);
  const payload = Buffer.from(await upstream.arrayBuffer());
  res.statusCode = upstream.status;
  res.end(payload);
}

export async function startOwnerCockpitV17(options: OwnerCockpitV17Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public_bind_forbidden');
  const server = createServer(async (req, res) => {
    try { await relay(options, req, res); }
    catch (error) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ error: 'owner_cockpit_v17_unavailable', detail: String(error instanceof Error ? error.message : error).slice(0, 180) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
