import type { ExecutiveDashboardV4, ExecutivePersonV4, ExecutiveSystemV4 } from './executive-data-v4.js';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function tone(value: string): string {
  return ['active','waiting','blocked','done','paused','stale','unknown'].includes(value) ? value : 'unknown';
}

function personCard(person: ExecutivePersonV4, data: ExecutiveDashboardV4): string {
  const works = data.works.filter((work) => work.ownerCode === person.key);
  const active = works.filter((work) => work.tone === 'active').length;
  const blocked = works.filter((work) => work.tone === 'blocked').length;
  return `<a class="ev5-card" href="/people/${encodeURIComponent(person.key)}"><div class="ev5-head"><b>${esc(person.key)}</b><span class="ev5-state ${tone(person.tone)}">${esc(person.status)}</span></div><h3>${esc(person.name)}</h3><p>${esc(person.role)}</p><dl><div><dt>Đang giữ</dt><dd>${active}</dd></div><div><dt>Bị chặn</dt><dd>${blocked}</dd></div><div><dt>Queue/runtime</dt><dd>${person.activeCount}</dd></div></dl><small>${esc(person.current)}</small></a>`;
}

function systemCard(system: ExecutiveSystemV4): string {
  return `<a class="ev5-card" href="/system/${encodeURIComponent(system.key)}"><div class="ev5-head"><b>${esc(system.key)}</b><span class="ev5-state ${tone(system.tone)}">${esc(system.status)}</span></div><h3>${esc(system.name)}</h3><p>${esc(system.note)}</p></a>`;
}
function personDetail(person: ExecutivePersonV4 | undefined, data: ExecutiveDashboardV4): string {
  if (!person) return '<div class="ev5-empty">Không tìm thấy AI employee trong Registry snapshot hiện hành.</div>';
  const works = data.works.filter((work) => work.ownerCode === person.key);
  const rows = works.length ? works.map((work) => `<a class="ev5-work" href="/work/${encodeURIComponent(work.workId || `GH-${work.number ?? ''}`)}"><b>${esc(work.workId || `GH-${work.number ?? ''}`)}</b><span>${esc(work.title)}</span><em class="ev5-state ${tone(work.tone)}">${esc(work.status)}</em></a>`).join('') : '<div class="ev5-empty">Không có Work source-backed đang gắn với employee này.</div>';
  return `<section class="ev5-detail"><a class="ev5-back" href="/?view=workforce">← Nhân sự</a><div class="ev5-title"><div><small>${esc(person.key)}</small><h2>${esc(person.name)}</h2><p>${esc(person.role)}</p></div><span class="ev5-state ${tone(person.tone)}">${esc(person.status)}</span></div><div class="ev5-metrics"><article><small>Active work</small><b>${person.activeCount}</b></article><article><small>Đang làm gì</small><b>${esc(person.current)}</b></article><article><small>Runtime/model</small><b>Chưa có binding xác minh</b></article><article><small>Heartbeat riêng</small><b>Chưa có contract</b></article></div><h3>Work liên quan</h3><div class="ev5-work-list">${rows}</div></section>`;
}

function systemDetail(system: ExecutiveSystemV4 | undefined): string {
  if (!system) return '<div class="ev5-empty">Không tìm thấy system_id trong snapshot hiện hành.</div>';
  return `<section class="ev5-detail"><a class="ev5-back" href="/?view=system">← Hệ thống</a><div class="ev5-title"><div><small>${esc(system.key)}</small><h2>${esc(system.name)}</h2><p>${esc(system.note)}</p></div><span class="ev5-state ${tone(system.tone)}">${esc(system.status)}</span></div><div class="ev5-metrics"><article><small>Health</small><b>${esc(system.status)}</b></article><article><small>Heartbeat / uptime</small><b>${system.tone === 'unknown' ? 'Chưa có telemetry contract' : 'Theo snapshot telemetry hiện hành'}</b></article><article><small>Last error</small><b>Chưa có event lỗi trong view này</b></article><article><small>Self-heal / reboot</small><b>Chưa có history contract</b></article></div><p class="ev5-source">Không suy diễn PID/uptime/restart khi nguồn telemetry chưa cung cấp.</p></section>`;
}

export function renderWorkforceContentV5(data: ExecutiveDashboardV4, selectedId = ''): string {
  if (selectedId) return `<div class="ev5-shell" data-live-section="entity-content">${personDetail(data.people.find((person) => person.key === selectedId), data)}</div>`;
  return `<div class="ev5-shell" data-live-section="entity-content"><div class="ev5-intro"><h1>Nhân sự</h1><p>AI nào đang làm gì — chỉ employee trong Registry, không trộn service.</p></div><div class="ev5-grid">${data.people.filter((person) => person.key !== 'VY').map((person) => personCard(person,data)).join('')}</div></div>`;
}

export function renderSystemContentV5(data: ExecutiveDashboardV4, selectedId = ''): string {
  if (selectedId) return `<div class="ev5-shell" data-live-section="entity-content">${systemDetail(data.systems.find((system) => system.key === selectedId))}</div>`;
  return `<div class="ev5-shell" data-live-section="entity-content"><div class="ev5-intro"><h1>Hệ thống</h1><p>Máy có khỏe không — status thiếu contract được giữ ở Chưa xác minh.</p></div><div class="ev5-grid systems">${data.systems.map(systemCard).join('')}</div></div>`;
}
export const ENTITY_V5_CSS = `
.ev5-shell{min-width:0}.ev5-intro{margin-bottom:14px}.ev5-intro h1{margin:0;font-size:22px}.ev5-intro p{margin:4px 0 0;color:#9fb2ca}.ev5-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.ev5-grid.systems{grid-template-columns:repeat(3,minmax(0,1fr))}.ev5-card{min-width:0;display:block;border:1px solid #214a78;border-radius:11px;background:linear-gradient(180deg,#0b274a,#09213e);padding:12px;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}.ev5-card:hover{transform:translateY(-1px);border-color:#3c79b3;box-shadow:0 8px 20px rgba(0,0,0,.15)}.ev5-card:focus-visible,.ev5-back:focus-visible,.ev5-work:focus-visible{outline:2px solid #5fc4ff;outline-offset:2px}.ev5-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.ev5-head>b{font-size:10px;color:#56baff}.ev5-card h3{margin:9px 0 4px;font-size:14px}.ev5-card p{margin:0 0 10px;color:#a5bad1;font-size:11px}.ev5-card dl{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:9px 0}.ev5-card dl div{background:#091f3b;border-radius:7px;padding:6px}.ev5-card dt{font-size:9px;color:#7791ad}.ev5-card dd{margin:2px 0 0;font-weight:700}.ev5-card>small{display:block;color:#879fba;overflow-wrap:anywhere}.ev5-state{display:inline-flex;padding:3px 7px;border-radius:6px;background:#23364f;color:#a8bbd1;font-size:10px;font-style:normal;font-weight:700}.ev5-state.active{background:#0c3d35;color:#36dd8c}.ev5-state.blocked{background:#4b2331;color:#ff7489}.ev5-state.done{background:#123b58;color:#52baff}.ev5-state.waiting{background:#50351c;color:#ffae58}.ev5-detail{border:1px solid #214a78;border-radius:12px;background:linear-gradient(180deg,rgba(11,34,65,.96),rgba(8,28,54,.97));padding:15px}.ev5-back{display:inline-block;margin-bottom:12px;color:#67bdff}.ev5-title{display:flex;justify-content:space-between;gap:18px}.ev5-title h2{margin:4px 0}.ev5-title p{margin:0;color:#9fb2ca}.ev5-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:15px 0}.ev5-metrics article{min-width:0;border:1px solid #244b77;border-radius:8px;background:#0a294d;padding:10px;display:grid;gap:5px}.ev5-metrics small{color:#829ab6}.ev5-metrics b{overflow-wrap:anywhere}.ev5-work-list{display:grid;gap:8px}.ev5-work{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #234b78;border-radius:8px;padding:9px;background:#0a294d}.ev5-work>b{font-size:10px;color:#56baff}.ev5-source,.ev5-empty{color:#879fba}.ev5-empty{padding:20px;text-align:center}
@media(max-width:1200px){.ev5-grid,.ev5-grid.systems{grid-template-columns:1fr 1fr}.ev5-metrics{grid-template-columns:1fr 1fr}}@media(max-width:700px){.ev5-grid,.ev5-grid.systems,.ev5-metrics{grid-template-columns:1fr}.ev5-title{flex-direction:column}.ev5-work{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.ev5-card{transition:none}}
`;