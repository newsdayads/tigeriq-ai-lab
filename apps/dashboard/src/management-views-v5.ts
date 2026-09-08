import type { ExecutiveDashboardV4, ExecutiveWorkV4 } from './executive-data-v4.js';
import { stableWorkIdV5 } from './work-view-v5.js';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}
function tone(value: string): string {
  return ['active','waiting','blocked','done','paused','stale','unknown'].includes(value) ? value : 'unknown';
}
function age(timestamp?: string): string {
  const at = Date.parse(timestamp || '');
  if (!Number.isFinite(at)) return 'Chưa có mốc';
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}
function projectId(work: ExecutiveWorkV4): string { return work.projectId || 'project:unmapped'; }
function projectName(work: ExecutiveWorkV4): string { return work.project || 'Chưa chuẩn hóa project mapping'; }
function projectGroups(data: ExecutiveDashboardV4) {
  const groups = new Map<string, ExecutiveWorkV4[]>();
  for (const work of data.works) {
    const id = projectId(work);
    groups.set(id, [...(groups.get(id) ?? []), work]);
  }
  return [...groups.entries()].map(([id, works]) => ({ id, works, name: projectName(works[0]),
    active: works.filter((w) => w.tone === 'active').length,
    blocked: works.filter((w) => w.tone === 'blocked').length,
    done: works.filter((w) => w.tone === 'done').length,
    last: works.map((w) => w.lastActivityAt || w.updatedAt || '').sort().at(-1) || '' }));
}
export function renderProjectsV5(data: ExecutiveDashboardV4, selectedId = ''): string {
  const groups = projectGroups(data);
  if (selectedId) {
    const group = groups.find((item) => item.id === selectedId);
    if (!group) return '<div class="mv5-empty">Không tìm thấy project_id trong snapshot hiện hành.</div>';
    const rows = group.works.map((work) => `<a class="mv5-row" href="/work/${encodeURIComponent(stableWorkIdV5(work))}"><b>${esc(stableWorkIdV5(work))}</b><span>${esc(work.title)}</span><em class="mv5-state ${tone(work.tone)}">${esc(work.status)}</em></a>`).join('');
    return `<div class="mv5-shell" data-live-section="management-content"><a class="mv5-back" href="/?view=models">← Dự án</a><div class="mv5-title"><div><small>${esc(group.id)}</small><h1>${esc(group.name)}</h1></div><span>${age(group.last)}</span></div><div class="mv5-metrics"><article><small>Active</small><b>${group.active}</b></article><article><small>Blocked</small><b>${group.blocked}</b></article><article><small>Done</small><b>${group.done}</b></article><article><small>Milestone</small><b>Lifecycle từ Work thật</b></article></div><h3>Work thuộc dự án</h3><div class="mv5-list">${rows || '<div class="mv5-empty">Chưa có Work.</div>'}</div></div>`;
  }
  const cards = groups.map((group) => `<a class="mv5-card" href="/projects/${encodeURIComponent(group.id)}"><div class="mv5-card-head"><b>${esc(group.id)}</b><span>${age(group.last)}</span></div><h2>${esc(group.name)}</h2><p>Outcome lấy từ Work/goal đã ánh xạ; không dựng % nếu thiếu mẫu số.</p><dl><div><dt>Active</dt><dd>${group.active}</dd></div><div><dt>Blocked</dt><dd>${group.blocked}</dd></div><div><dt>Done</dt><dd>${group.done}</dd></div></dl></a>`).join('');
  return `<div class="mv5-shell" data-live-section="management-content"><div class="mv5-intro"><h1>Dự án</h1><p>Vì mục tiêu nào — gom Work theo stable project_id.</p></div><div class="mv5-grid">${cards || '<div class="mv5-empty">Chưa chuẩn hóa project mapping.</div>'}</div></div>`;
}

function timelineEvents(data: ExecutiveDashboardV4) {
  return data.works.flatMap((work) => (work.timeline ?? []).map((event) => ({ ...event, work })))
    .filter((event) => Number.isFinite(Date.parse(event.timestamp || '')))
    .sort((a,b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
export function renderReportsV5(data: ExecutiveDashboardV4): string {
  const events = timelineEvents(data);
  const stale = data.works.filter((w) => w.tone === 'stale').length;
  const cards = [
    ['Hoàn tất', data.doneCount, 'Từ snapshot Work hiện hành'],
    ['Bị chặn', data.blockedCount, 'Từ lifecycle có evidence'],
    ['Stale', stale, 'Theo ngưỡng heartbeat hiện hành'],
    ['Event có timestamp', events.length, 'Nguồn timeline/evidence đang nạp'],
  ];
  const errors = events.filter((event) => /error|fail|blocked|lỗi|bị chặn/i.test(event.message)).slice(0,10);
  return `<div class="mv5-shell" data-live-section="management-content"><div class="mv5-intro"><h1>Báo cáo</h1><p>Kết quả từ dữ liệu thật; metric thiếu timestamp hiển thị Chưa đủ dữ liệu.</p></div><div class="mv5-metrics">${cards.map(([name,value,note]) => `<article><small>${esc(name)}</small><b>${esc(value)}</b><span>${esc(note)}</span></article>`).join('')}</div><div class="mv5-report-grid"><section><h2>Cycle time / tự động hóa</h2><div class="mv5-empty">Chưa đủ dữ liệu lifecycle timestamps chuẩn để tính median/p95 hoặc tỷ lệ tự động.</div></section><section><h2>Lỗi / blocker gần đây</h2>${errors.length ? errors.map((event) => `<a class="mv5-event" href="/work/${encodeURIComponent(stableWorkIdV5(event.work))}"><time>${esc(new Date(event.timestamp).toLocaleString('vi-VN',{hour12:false}))}</time><span>${esc(event.message)}</span></a>`).join('') : '<div class="mv5-empty">Chưa có event lỗi trong snapshot hiện hành.</div>'}</section></div></div>`;
}
export function renderSettingsV5(): string {
  const rows = [
    ['SSE live stream','Bật','Server → UI; fallback polling khi stream lỗi'],
    ['Fallback refresh','5 giây','Read-only trong release này'],
    ['Heartbeat stale','120 giây','Nguồn hiện hành của Web V5'],
    ['Write controls','Khóa','Chờ execution bridge #486 + Owner auth/audit'],
    ['Browser lane control','Khóa','Không bypass policy #497'],
  ];
  return `<div class="mv5-shell" data-live-section="management-content"><div class="mv5-intro"><h1>Cài đặt</h1><p>Luật vận hành — read-first, write fail-closed.</p></div><div class="mv5-settings">${rows.map(([name,value,note]) => `<article><div><b>${esc(name)}</b><small>${esc(note)}</small></div><span>${esc(value)}</span></article>`).join('')}</div><section class="mv5-callout"><b>Điều khiển ghi chưa mở.</b><p>Backend hiện có auth cho giao job, nhưng chưa có contract stop/retry/reprioritize/kill-switch đạt #486; Web không tạo nút giả.</p></section></div>`;
}

export function renderOverviewSignalsV5(data: ExecutiveDashboardV4): string {
  const recent = timelineEvents(data).slice(0,8);
  const queued = data.works.filter((w) => w.tone === 'waiting' || w.tone === 'paused').slice(0,5);
  const recentHtml = recent.length ? recent.map((event) => `<a href="/work/${encodeURIComponent(stableWorkIdV5(event.work))}"><time>${esc(age(event.timestamp))}</time><span>${esc(event.message)}</span></a>`).join('') : '<div class="mv5-empty">Chưa có event mới.</div>';
  const queueHtml = queued.length ? queued.map((work) => `<a href="/work/${encodeURIComponent(stableWorkIdV5(work))}"><b>${esc(work.priority ?? '—')}</b><span>${esc(work.title)}</span><small>${esc(work.next)}</small></a>`).join('') : '<div class="mv5-empty">Không có việc chờ được xác minh.</div>';
  return `<section class="mv5-overview" data-live-section="overview-signals" data-active="${data.activeCount}" data-done="${data.doneCount}" data-blocked="${data.blockedCount}" data-generated="${esc(data.generatedAt)}"><article><h2>Vừa xảy ra</h2><div class="mv5-events">${recentHtml}</div></article><article><h2>Sắp làm gì</h2><div class="mv5-queue">${queueHtml}</div></article><article><h2>Từ lần xem trước</h2><div class="mv5-since"><b data-since-done>—</b><span>hoàn tất</span><b data-since-active>—</b><span>active</span><b data-since-blocked>—</b><span>blocked</span></div></article></section>`;
}
export function overviewCheckpointScriptV5(): string {
  return `<script id="mv5-checkpoint">(()=>{function run(){const el=document.querySelector('[data-live-section="overview-signals"]');if(!el)return;const cur={active:+(el.dataset.active||0),done:+(el.dataset.done||0),blocked:+(el.dataset.blocked||0),generated:el.dataset.generated||''};let prev=null;try{prev=JSON.parse(localStorage.getItem('tigeriq-v5-last-view')||'null')}catch{};const set=(q,v)=>{const n=document.querySelector(q);if(n)n.textContent=prev?String(v):'Lần đầu'};set('[data-since-done]',cur.done-(prev?.done||0));set('[data-since-active]',cur.active-(prev?.active||0));set('[data-since-blocked]',cur.blocked-(prev?.blocked||0));try{localStorage.setItem('tigeriq-v5-last-view',JSON.stringify(cur))}catch{}}window.tqV5Checkpoint=run;run()})();</script>`;
}
export const MANAGEMENT_V5_CSS = `
.mv5-shell{min-width:0}.mv5-intro{margin-bottom:14px}.mv5-intro h1,.mv5-title h1{margin:0;font-size:22px}.mv5-intro p{margin:4px 0 0;color:#9fb2ca}.mv5-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.mv5-card{min-width:0;border:1px solid #214a78;border-radius:11px;background:linear-gradient(180deg,#0b274a,#09213e);padding:13px;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}.mv5-card:hover{transform:translateY(-1px);border-color:#3c79b3;box-shadow:0 8px 20px rgba(0,0,0,.15)}.mv5-card:focus-visible,.mv5-row:focus-visible,.mv5-event:focus-visible,.mv5-back:focus-visible{outline:2px solid #5fc4ff;outline-offset:2px}.mv5-card-head,.mv5-title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.mv5-card-head b{font-size:10px;color:#56baff}.mv5-card-head span,.mv5-title>span{font-size:10px;color:#829ab6}.mv5-card h2{font-size:15px;margin:8px 0 4px}.mv5-card p{color:#9fb2ca;font-size:11px}.mv5-card dl{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.mv5-card dl div{background:#091f3b;border-radius:7px;padding:6px}.mv5-card dt{font-size:9px;color:#7791ad}.mv5-card dd{margin:2px 0 0;font-weight:700}.mv5-back{display:inline-block;margin-bottom:12px;color:#67bdff}.mv5-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:15px 0}.mv5-metrics article{min-width:0;border:1px solid #244b77;border-radius:8px;background:#0a294d;padding:10px;display:grid;gap:5px}.mv5-metrics small{color:#829ab6}.mv5-metrics b{font-size:16px;overflow-wrap:anywhere}.mv5-metrics span{font-size:10px;color:#8da5c0}.mv5-list{display:grid;gap:8px}.mv5-row{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #234b78;border-radius:8px;padding:9px;background:#0a294d}.mv5-row>b{font-size:10px;color:#56baff}.mv5-state{padding:3px 7px;border-radius:6px;background:#23364f;color:#a8bbd1;font-size:10px;font-style:normal}.mv5-state.active{background:#0c3d35;color:#36dd8c}.mv5-state.blocked{background:#4b2331;color:#ff7489}.mv5-state.done{background:#123b58;color:#52baff}.mv5-report-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mv5-report-grid section,.mv5-callout{border:1px solid #214a78;border-radius:10px;background:#0a294d;padding:12px}.mv5-report-grid h2{font-size:14px;margin:0 0 9px}.mv5-event{display:grid;gap:3px;padding:8px;border-bottom:1px solid #214a78}.mv5-event time{font-size:9px;color:#829ab6}.mv5-settings{display:grid;gap:8px}.mv5-settings article{display:flex;align-items:center;justify-content:space-between;gap:20px;border:1px solid #234b78;border-radius:8px;background:#0a294d;padding:10px 12px}.mv5-settings article div{display:grid}.mv5-settings small{color:#829ab6}.mv5-settings span{font-weight:700}.mv5-callout{margin-top:12px}.mv5-callout p{margin:5px 0 0;color:#9fb2ca}.mv5-empty{padding:16px;color:#8197b1;text-align:center;font-size:11px}
`;
// Extend management CSS with Overview live signals and responsive rules.
export const OVERVIEW_SIGNALS_V5_CSS = `
.mv5-overview{display:grid;grid-template-columns:1.35fr 1.05fr .7fr;gap:12px;margin-bottom:13px}.mv5-overview>article{min-width:0;border:1px solid #214a78;border-radius:11px;background:linear-gradient(180deg,rgba(11,34,65,.96),rgba(8,28,54,.97));padding:12px}.mv5-overview h2{margin:0 0 8px;font-size:14px}.mv5-events,.mv5-queue{display:grid;gap:6px}.mv5-events>a,.mv5-queue>a{min-width:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;border-radius:7px;padding:7px;background:#091f3b}.mv5-events>a:hover,.mv5-queue>a:hover{background:#0d3159}.mv5-events time,.mv5-queue b{font-size:9px;color:#56baff}.mv5-events span,.mv5-queue span{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mv5-queue small{grid-column:2;color:#829ab6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mv5-since{display:grid;grid-template-columns:auto 1fr;gap:7px 9px;align-items:center}.mv5-since b{font-size:17px;color:#56baff}.mv5-since span{font-size:10px;color:#9fb2ca}
@media(max-width:1100px){.mv5-overview{grid-template-columns:1fr 1fr}.mv5-overview>article:last-child{grid-column:1/-1}.mv5-grid{grid-template-columns:1fr 1fr}.mv5-metrics{grid-template-columns:1fr 1fr}}@media(max-width:700px){.mv5-overview,.mv5-grid,.mv5-metrics,.mv5-report-grid{grid-template-columns:1fr}.mv5-overview>article:last-child{grid-column:auto}.mv5-row{grid-template-columns:1fr}.mv5-settings article,.mv5-title{align-items:flex-start;flex-direction:column}}
@media(prefers-reduced-motion:reduce){.mv5-card{transition:none}}
`;
