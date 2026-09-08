import type { ExecutiveDashboardV4, ExecutivePersonV4, ExecutiveSystemV4 } from './executive-data-v4.js';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function tone(value: string): string {
  return ['active','waiting','blocked','done','paused','stale','unknown'].includes(value) ? value : 'unknown';
}

function ageLabel(timestamp?: string): string {
  const at = Date.parse(timestamp || '');
  if (!Number.isFinite(at)) return 'Chưa có mốc hoạt động';
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds} giây trước`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ trước`;
  return `${Math.floor(seconds / 86400)} ngày trước`;
}
function personCard(person: ExecutivePersonV4, data: ExecutiveDashboardV4): string {
  const works = data.works.filter((work) => work.ownerCode === person.key);
  const current = works.find((work) => work.tone === 'active') || works.find((work) => work.tone === 'blocked' || work.tone === 'stale') || works.find((work) => work.tone === 'waiting');
  const active = works.filter((work) => work.tone === 'active').length;
  const blocked = works.filter((work) => work.tone === 'blocked' || work.tone === 'stale').length;
  const doing = current ? `<div class="ev5-doing"><small>Việc đang theo dõi</small><b>${esc(current.workId || `GH-${current.number ?? ''}`)} · ${esc(current.title)}</b><span>${esc(current.currentStep || current.next)}</span><time>${esc(ageLabel(current.lastActivityAt))}</time></div>` : '<div class="ev5-doing empty"><small>Việc đang theo dõi</small><b>Chưa có việc được xác minh</b><span>Sẵn sàng nhận việc mới.</span></div>';
  return `<a class="ev5-card" href="/people/${encodeURIComponent(person.key)}"><div class="ev5-head"><b>${esc(person.key)}</b><span class="ev5-state ${tone(person.tone)}">${esc(person.status)}</span></div><h3>${esc(person.name)}</h3><p>${esc(person.role)}</p>${doing}<dl><div><dt>Đang làm</dt><dd>${active}</dd></div><div><dt>Cảnh báo</dt><dd>${blocked}</dd></div><div><dt>Tổng liên quan</dt><dd>${works.length}</dd></div></dl></a>`;
}

function systemCard(system: ExecutiveSystemV4): string {
  return `<a class="ev5-card" href="/system/${encodeURIComponent(system.key)}"><div class="ev5-head"><b>${esc(system.key)}</b><span class="ev5-state ${tone(system.tone)}">${esc(system.status)}</span></div><h3>${esc(system.name)}</h3><p>${esc(system.note)}</p></a>`;
}
function personDetail(person: ExecutivePersonV4 | undefined, data: ExecutiveDashboardV4): string {
  if (!person) return '<div class="ev5-empty">Không tìm thấy nhân viên AI trong danh sách chuẩn hiện hành.</div>';
  const works = data.works.filter((work) => work.ownerCode === person.key);
  const rows = works.length ? works.map((work) => `<a class="ev5-work" href="/work/${encodeURIComponent(work.workId || `GH-${work.number ?? ''}`)}"><b>${esc(work.workId || `GH-${work.number ?? ''}`)}</b><span>${esc(work.title)}</span><em class="ev5-state ${tone(work.tone)}">${esc(work.status)}</em></a>`).join('') : '<div class="ev5-empty">Không có công việc có nguồn xác minh đang gắn với nhân sự này.</div>';
  return `<section class="ev5-detail"><a class="ev5-back" href="/?view=workforce">← Nhân sự</a><div class="ev5-title"><div><small>${esc(person.key)}</small><h2>${esc(person.name)}</h2><p>${esc(person.role)}</p></div><span class="ev5-state ${tone(person.tone)}">${esc(person.status)}</span></div><div class="ev5-metrics"><article><small>Việc đang làm</small><b>${person.activeCount}</b></article><article><small>Đang làm gì</small><b>${esc(person.current)}</b></article><article><small>Mô hình thực thi</small><b>Chưa có liên kết xác minh</b></article><article><small>Nhịp sống riêng</small><b>Chưa có nguồn trực tiếp</b></article></div><h3>Công việc liên quan</h3><div class="ev5-work-list">${rows}</div></section>`;
}

function systemDetail(system: ExecutiveSystemV4 | undefined): string {
  if (!system) return '<div class="ev5-empty">Không tìm thấy mã hệ thống trong dữ liệu hiện hành.</div>';
  return `<section class="ev5-detail"><a class="ev5-back" href="/?view=system">← Hệ thống</a><div class="ev5-title"><div><small>${esc(system.key)}</small><h2>${esc(system.name)}</h2><p>${esc(system.note)}</p></div><span class="ev5-state ${tone(system.tone)}">${esc(system.status)}</span></div><div class="ev5-metrics"><article><small>Sức khỏe</small><b>${esc(system.status)}</b></article><article><small>Nhịp sống / thời gian chạy</small><b>${system.tone === 'unknown' ? 'Chưa có nguồn trạng thái trực tiếp' : 'Theo dữ liệu trạng thái hiện hành'}</b></article><article><small>Lỗi gần nhất</small><b>Chưa có sự kiện lỗi trong màn này</b></article><article><small>Tự phục hồi / khởi động lại</small><b>Chưa có lịch sử trực tiếp</b></article></div><p class="ev5-source">Không suy diễn PID, thời gian chạy hoặc lần khởi động lại khi nguồn chưa cung cấp.</p></section>`;
}

export function renderWorkforceContentV5(data: ExecutiveDashboardV4, selectedId = ''): string {
  if (selectedId) return `<div class="ev5-shell" data-live-section="entity-content">${personDetail(data.people.find((person) => person.key === selectedId), data)}</div>`;
  const people=data.people.filter((person)=>person.key!=='VY'); const busy=people.filter((person)=>person.tone==='active').length; const warning=people.filter((person)=>person.tone==='blocked'||person.tone==='stale').length; const paused=people.filter((person)=>person.tone==='paused').length; const idle=people.length-busy-warning-paused;
  const source=`<div class="ev5-sourcebar"><b>${esc(data.sourceStatus || 'Nguồn trực tiếp')}</b><span>${esc(data.sourceNote || 'Dữ liệu đang đồng bộ từ nguồn hiện hành.')}</span></div>`;
  const stats=`<div class="ev5-stats"><article><small>Đang làm</small><b>${busy}</b></article><article><small>Chờ việc</small><b>${Math.max(0,idle)}</b></article><article><small>Cảnh báo</small><b>${warning}</b></article><article><small>Tạm ngưng</small><b>${paused}</b></article></div>`;
  return `<div class="ev5-shell" data-live-section="entity-content"><div class="ev5-intro"><h1>Nhân sự AI</h1><p>AI nào đang làm gì — mỗi người đang giữ việc gì, bước hiện tại là gì và có đang bị chặn hay không.</p></div>${source}${stats}<div class="ev5-grid">${people.map((person) => personCard(person,data)).join('')}</div></div>`;
}

export function renderSystemContentV5(data: ExecutiveDashboardV4, selectedId = ''): string {
  if (selectedId) return `<div class="ev5-shell" data-live-section="entity-content">${systemDetail(data.systems.find((system) => system.key === selectedId))}</div>`;
  const source=`<div class="ev5-sourcebar"><b>${esc(data.sourceStatus || 'Nguồn trực tiếp')}</b><span>${esc(data.sourceNote || 'Dữ liệu đang đồng bộ từ nguồn hiện hành.')}</span></div>`;
  return `<div class="ev5-shell" data-live-section="entity-content"><div class="ev5-intro ev5-intro-actions"><div><h1>Hệ thống</h1><p>Máy có khỏe không — thiếu nguồn trực tiếp thì giữ trạng thái Chưa xác minh.</p></div><a class="ev5-control" href="/?view=evidence#he-thong">Mở điều khiển an toàn</a></div>${source}<div class="ev5-grid systems">${data.systems.map(systemCard).join('')}</div></div>`;
}
export const ENTITY_V5_CSS = `
.ev5-sourcebar{display:flex;gap:9px;align-items:center;padding:8px 10px;margin-bottom:10px;border:1px solid #28527e;border-radius:8px;background:#092443}.ev5-sourcebar b{font-size:10px;color:#49d99a;white-space:nowrap}.ev5-sourcebar span{font-size:10px;color:#8fa7c1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ev5-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}.ev5-stats article{display:flex;align-items:center;justify-content:space-between;border:1px solid #244b77;border-radius:8px;background:#0a294d;padding:8px 10px}.ev5-stats small{color:#829ab6}.ev5-stats b{font-size:17px}
.ev5-shell{min-width:0}.ev5-intro{margin-bottom:14px}.ev5-intro-actions{display:flex;align-items:end;justify-content:space-between;gap:12px}.ev5-control{border:1px solid #2d6b9c;border-radius:8px;padding:8px 10px;background:#0b3157;color:#8fd0ff;font-size:11px;font-weight:700}.ev5-control:hover{background:#0e3d6a}.ev5-intro h1{margin:0;font-size:22px}.ev5-intro p{margin:4px 0 0;color:#9fb2ca}.ev5-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.ev5-grid.systems{grid-template-columns:repeat(3,minmax(0,1fr))}.ev5-card{min-width:0;display:block;border:1px solid #214a78;border-radius:11px;background:linear-gradient(180deg,#0b274a,#09213e);padding:12px;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}.ev5-card:hover{transform:translateY(-1px);border-color:#3c79b3;box-shadow:0 8px 20px rgba(0,0,0,.15)}.ev5-card:focus-visible,.ev5-back:focus-visible,.ev5-work:focus-visible{outline:2px solid #5fc4ff;outline-offset:2px}.ev5-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.ev5-head>b{font-size:10px;color:#56baff}.ev5-card h3{margin:9px 0 4px;font-size:14px}.ev5-card p{margin:0 0 10px;color:#a5bad1;font-size:11px}.ev5-card dl{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:9px 0}.ev5-card dl div{background:#091f3b;border-radius:7px;padding:6px}.ev5-card dt{font-size:9px;color:#7791ad}.ev5-card dd{margin:2px 0 0;font-weight:700}.ev5-card>small{display:block;color:#879fba;overflow-wrap:anywhere}.ev5-state{display:inline-flex;padding:3px 7px;border-radius:6px;background:#23364f;color:#a8bbd1;font-size:10px;font-style:normal;font-weight:700}.ev5-state.active{background:#0c3d35;color:#36dd8c}.ev5-state.blocked{background:#4b2331;color:#ff7489}.ev5-state.done{background:#123b58;color:#52baff}.ev5-state.waiting{background:#50351c;color:#ffae58}.ev5-detail{border:1px solid #214a78;border-radius:12px;background:linear-gradient(180deg,rgba(11,34,65,.96),rgba(8,28,54,.97));padding:15px}.ev5-back{display:inline-block;margin-bottom:12px;color:#67bdff}.ev5-title{display:flex;justify-content:space-between;gap:18px}.ev5-title h2{margin:4px 0}.ev5-title p{margin:0;color:#9fb2ca}.ev5-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:15px 0}.ev5-metrics article{min-width:0;border:1px solid #244b77;border-radius:8px;background:#0a294d;padding:10px;display:grid;gap:5px}.ev5-metrics small{color:#829ab6}.ev5-metrics b{overflow-wrap:anywhere}.ev5-work-list{display:grid;gap:8px}.ev5-work{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #234b78;border-radius:8px;padding:9px;background:#0a294d}.ev5-work>b{font-size:10px;color:#56baff}.ev5-source,.ev5-empty{color:#879fba}.ev5-empty{padding:20px;text-align:center}
@media(max-width:1200px){.ev5-grid,.ev5-grid.systems{grid-template-columns:1fr 1fr}.ev5-metrics{grid-template-columns:1fr 1fr}}@media(max-width:700px){.ev5-intro-actions{align-items:flex-start;flex-direction:column}.ev5-grid,.ev5-grid.systems,.ev5-metrics{grid-template-columns:1fr}.ev5-title{flex-direction:column}.ev5-work{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.ev5-card{transition:none}}
`;
export const ENTITY_V5_CSS_EXTRA = `
.ev5-doing{display:grid;gap:4px;margin:10px 0;padding:9px;border:1px solid #234b78;border-radius:8px;background:#091f3b}.ev5-doing small{color:#7d98b5}.ev5-doing b{font-size:11px;line-height:1.35}.ev5-doing span{font-size:10px;color:#a2b7cd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ev5-doing time{font-size:9px;color:#6f8aa8}.ev5-doing.empty{opacity:.76}.ev5-card dl{margin-top:8px}
`;
