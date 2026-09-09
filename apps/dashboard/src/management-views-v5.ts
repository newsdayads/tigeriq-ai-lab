import type { ExecutiveDashboardV4, ExecutiveWorkV4 } from './executive-data-v4.js';
import { stableWorkIdV5 } from './work-view-v5.js';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}
function tone(value: string): string {
  return ['active','waiting','blocked','done','paused','stale','unknown'].includes(value) ? value : 'unknown';
}
type SourcePresentationState = 'loading' | 'error' | 'stale' | 'ready';
function sourcePresentationState(data?: ExecutiveDashboardV4): SourcePresentationState {
  if (!data) return 'loading';
  const status = String(data.sourceStatus || '').toLowerCase();
  const note = String(data.sourceNote || '').toLowerCase();
  if (status.includes('tải') || status.includes('loading') || note.includes('đang đồng bộ')) return 'loading';
  if (status.includes('lỗi') || status.includes('error') || note.includes('không thể xác minh')) return 'error';
  if (status.includes('mất tín hiệu') || status.includes('stale') || note.includes('quá ngưỡng')) return 'stale';
  return 'ready';
}
function sourceBar(data?: ExecutiveDashboardV4): string {
  const state = sourcePresentationState(data);
  const status = data?.sourceStatus || (data ? 'Nguồn trực tiếp' : 'Đang tải');
  const note = data?.sourceNote || (data ? 'Dữ liệu đang đồng bộ từ nguồn hiện hành.' : 'Đang chờ nguồn trạng thái hiện hành.');
  return `<div class="mv5-source ${state}" data-source-state="${state}"><b>${esc(status)}</b><span>${esc(note)}</span></div>`;
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
function projectName(work: ExecutiveWorkV4): string { return work.project || 'Chưa liên kết dự án'; }
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
  const state = sourcePresentationState(data);
  const source = sourceBar(data);
  if (selectedId) {
    const group = groups.find((item) => item.id === selectedId);
    if (!group) return `<div class="mv5-shell" data-live-section="management-content" data-source-state="${state}">${source}<div class="mv5-empty" data-entity-state="empty">Không tìm thấy dự án trong dữ liệu hiện hành.</div></div>`;
    const ordered=[...group.works].sort((a,b)=>(a.priority||'P9').localeCompare(b.priority||'P9'));
    const rows=ordered.map((work)=>`<a class="mv5-row" href="/work/${encodeURIComponent(stableWorkIdV5(work))}"><b>${esc(stableWorkIdV5(work))}</b><span>${esc(work.title)}<small>${esc(work.currentStep || work.next)}</small></span><em class="mv5-state ${tone(work.tone)}">${esc(work.status)}</em></a>`).join('');
    const next=ordered.find((w)=>w.tone==='active') || ordered.find((w)=>w.tone==='blocked'||w.tone==='stale') || ordered.find((w)=>w.tone==='waiting');
    return `<div class="mv5-shell" data-live-section="management-content" data-source-state="${state}"><a class="mv5-back" href="/?view=models">← Dự án</a>${source}<div class="mv5-title"><div><small>${esc(group.id)}</small><h1>${esc(group.name)}</h1></div><span>${age(group.last)}</span></div><div class="mv5-focus"><small>Mốc đang tập trung</small><b>${next ? esc(next.title) : 'Không có việc mở'}</b><span>${next ? esc(next.currentStep || next.next) : 'Dự án không có công việc đang xử lý.'}</span></div><div class="mv5-metrics"><article><small>Đang làm</small><b>${group.active}</b></article><article><small>Bị chặn</small><b>${group.blocked}</b></article><article><small>Chờ xử lý</small><b>${group.works.filter(w=>w.tone==='waiting'||w.tone==='paused'||w.tone==='stale').length}</b></article><article><small>Hoàn tất</small><b>${group.done}</b></article></div><h3>Công việc thuộc dự án</h3><div class="mv5-list">${rows || '<div class="mv5-empty" data-entity-state="empty">Chưa có công việc.</div>'}</div></div>`;
  }
  const cards=groups.map((group)=>{const open=group.works.find(w=>w.tone==='active')||group.works.find(w=>w.tone==='blocked'||w.tone==='stale')||group.works.find(w=>w.tone==='waiting');return `<a class="mv5-card" href="/projects/${encodeURIComponent(group.id)}"><div class="mv5-card-head"><b>${esc(group.id)}</b><span>${age(group.last)}</span></div><h2>${esc(group.name)}</h2><p>${open ? esc(open.currentStep || open.next) : 'Không có việc mở.'}</p><dl><div><dt>Đang làm</dt><dd>${group.active}</dd></div><div><dt>Bị chặn</dt><dd>${group.blocked}</dd></div><div><dt>Hoàn tất</dt><dd>${group.done}</dd></div></dl></a>`}).join('');
  return `<div class="mv5-shell" data-live-section="management-content" data-source-state="${state}"><div class="mv5-intro"><h1>Dự án</h1><p>Nhìn theo mục tiêu và công việc đang chạy; mỗi dự án dùng mã dự án ổn định, không dùng phần trăm giả.</p></div>${source}<div class="mv5-grid">${cards || '<div class="mv5-empty" data-entity-state="empty">Chưa có dự án được liên kết.</div>'}</div></div>`;
}

function timelineEvents(data: ExecutiveDashboardV4) {
  return data.works.flatMap((work) => (work.timeline ?? []).map((event) => ({ ...event, work })))
    .filter((event) => Number.isFinite(Date.parse(event.timestamp || '')))
    .sort((a,b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
export function renderReportsV5(data: ExecutiveDashboardV4): string {
  const events=timelineEvents(data); const stale=data.works.filter(w=>w.tone==='stale').length; const systemWarnings=data.systems.filter(x=>!['active','done'].includes(x.tone)).length;
  const attention=data.works.filter(w=>w.tone==='blocked'||w.tone==='stale').slice(0,8);
  const state=sourcePresentationState(data); const source=sourceBar(data);
  const cards=[['Đang làm',data.activeCount,'Công việc có trạng thái thực thi'],['Chờ xử lý',data.waitingCount,'Chưa bắt đầu hoặc đang chờ'],['Bị chặn / mất tín hiệu',data.blockedCount+stale,'Cần điều tra hoặc khôi phục'],['Cần anh Sơn',data.ownerActionRequired?1:0,data.ownerActionText],['Cảnh báo hệ thống',systemWarnings,'Thành phần chưa khỏe hoặc chưa xác minh'],['Sự kiện có thời gian',events.length,'Nguồn dòng thời gian / bằng chứng đang nạp']];
  const recent=events.slice(0,12).map(e=>`<a class="mv5-event" href="/work/${encodeURIComponent(stableWorkIdV5(e.work))}"><time>${esc(new Date(e.timestamp).toLocaleString('vi-VN',{hour12:false}))}</time><span>${esc(e.message)}</span></a>`).join('');
  const problems=attention.map(w=>`<a class="mv5-event warn" href="/work/${encodeURIComponent(stableWorkIdV5(w))}"><time>${esc(w.owner)} · ${esc(w.status)}</time><span>${esc(w.title)} — ${esc(w.currentStep || w.next)}</span></a>`).join('');
  return `<div class="mv5-shell" data-live-section="management-content" data-source-state="${state}"><div class="mv5-intro"><h1>Báo cáo điều hành</h1><p>Chỉ số để quyết định hôm nay, không dùng số liệu ước lượng giả.</p></div>${source}<div class="mv5-metrics mv5-metrics-five">${cards.map(([name,value,note])=>`<article><small>${esc(name)}</small><b>${esc(value)}</b><span>${esc(note)}</span></article>`).join('')}</div><div class="mv5-data-gap"><b>Thời gian xử lý / mức đáp ứng:</b><span>Chưa đủ dữ liệu chuẩn để tính trung vị, phân vị 95 hoặc tỷ lệ tự động.</span></div><div class="mv5-report-grid"><section><h2>Hoạt động gần nhất</h2>${recent || '<div class="mv5-empty" data-entity-state="empty">Chưa có sự kiện mới được xác minh.</div>'}</section><section><h2>Điểm cần chú ý</h2>${problems || '<div class="mv5-empty good" data-entity-state="empty">Không có công việc bị chặn hoặc mất tín hiệu.</div>'}</section></div></div>`;
}

export function renderSettingsV5(data?: ExecutiveDashboardV4): string {
  const state=sourcePresentationState(data); const source=sourceBar(data);
  const sourceStatus=data?.sourceStatus || 'Đang tải'; const sourceNote=data?.sourceNote || 'Đang chờ nguồn trạng thái hiện hành.';
  const rows=[['Đồng bộ trực tiếp',data ? 'Bật' : 'Chưa xác minh','Luồng sự kiện trực tiếp; khi mất kết nối dùng cập nhật dự phòng 5 giây'],['Ngưỡng mất tín hiệu','120 giây','Công việc thiếu nhịp sống mới sẽ được đánh dấu mất tín hiệu'],['Nguồn công việc',sourceStatus,sourceNote],['Điều khiển ghi','Khóa khi chưa xác thực','Mọi thao tác thay đổi cần phiên đăng nhập, mã chống giả mạo và nhật ký'],['Phạm vi mạng','Riêng tư','Chỉ địa chỉ máy cục bộ hoặc mạng riêng được phép phục vụ Web Control']];
  return `<div class="mv5-shell" data-live-section="management-content" data-source-state="${state}"><div class="mv5-intro"><h1>Cài đặt vận hành</h1><p>Những quy tắc đang tác động trực tiếp lên Trung tâm điều hành V5; các nguồn trạng thái ưu tiên đọc trước khi cho phép hành động.</p></div>${source}<div class="mv5-settings">${rows.map(([name,value,note])=>`<article><div><b>${esc(name)}</b><small>${esc(note)}</small></div><span>${esc(value)}</span></article>`).join('')}</div><section class="mv5-callout"><b>Điều khiển an toàn đã có nền tảng.</b><p>Các nút thay đổi hệ thống chỉ mở khi phiên đăng nhập hợp lệ. Không hiển thị nút giả và không tự vượt qua giới hạn bảo mật.</p></section></div>`;
}

export function renderOverviewSignalsV5(data: ExecutiveDashboardV4): string {
  const state=sourcePresentationState(data); const source=sourceBar(data);
  const recent = timelineEvents(data).slice(0,8);
  const queued = data.works.filter((w) => w.tone === 'waiting' || w.tone === 'paused').slice(0,5);
  const recentHtml = recent.length ? recent.map((event) => `<a href="/work/${encodeURIComponent(stableWorkIdV5(event.work))}"><time>${esc(age(event.timestamp))}</time><span>${esc(event.message)}</span></a>`).join('') : '<div class="mv5-empty" data-entity-state="empty">Chưa có sự kiện mới.</div>';
  const queueHtml = queued.length ? queued.map((work) => `<a href="/work/${encodeURIComponent(stableWorkIdV5(work))}"><b>${esc(work.priority ?? '—')}</b><span>${esc(work.title)}</span><small>${esc(work.next)}</small></a>`).join('') : '<div class="mv5-empty" data-entity-state="empty">Không có việc chờ được xác minh.</div>';
  return `<section class="mv5-overview" data-live-section="overview-signals" data-source-state="${state}" data-active="${data.activeCount}" data-done="${data.doneCount}" data-blocked="${data.blockedCount}" data-generated="${esc(data.generatedAt)}"><div class="mv5-overview-source">${source}</div><article><h2>Vừa xảy ra</h2><div class="mv5-events">${recentHtml}</div></article><article><h2>Sắp làm gì</h2><div class="mv5-queue">${queueHtml}</div></article><article><h2>Từ lần xem trước</h2><div class="mv5-since"><b data-since-done>—</b><span>hoàn tất</span><b data-since-active>—</b><span>đang làm</span><b data-since-blocked>—</b><span>bị chặn</span></div></article></section>`;
}
export function overviewCheckpointScriptV5(): string {
  return `<script id="mv5-checkpoint">(()=>{function run(){const el=document.querySelector('[data-live-section="overview-signals"]');if(!el)return;const cur={active:+(el.dataset.active||0),done:+(el.dataset.done||0),blocked:+(el.dataset.blocked||0),generated:el.dataset.generated||''};let prev=null;try{prev=JSON.parse(localStorage.getItem('tigeriq-v5-last-view')||'null')}catch{};const set=(q,v)=>{const n=document.querySelector(q);if(n)n.textContent=prev?String(v):'Lần đầu'};set('[data-since-done]',cur.done-(prev?.done||0));set('[data-since-active]',cur.active-(prev?.active||0));set('[data-since-blocked]',cur.blocked-(prev?.blocked||0));try{localStorage.setItem('tigeriq-v5-last-view',JSON.stringify(cur))}catch{}}window.tqV5Checkpoint=run;run()})();</script>`;
}
export const MANAGEMENT_V5_CSS = `
.mv5-source{display:flex;gap:9px;align-items:center;padding:8px 10px;margin-bottom:10px;border:1px solid #28527e;border-radius:8px;background:#092443}.mv5-source b{font-size:10px;color:#49d99a;white-space:nowrap}.mv5-source span{font-size:10px;color:#8fa7c1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mv5-source.loading{border-color:#8a6a2d}.mv5-source.loading b{color:#ffd166}.mv5-source.error{border-color:#8b3a4c}.mv5-source.error b{color:#ff8194}.mv5-source.stale{border-color:#80572b}.mv5-source.stale b{color:#ffb25f}.mv5-focus{display:grid;gap:4px;margin:12px 0;padding:11px;border:1px solid #2c5d8d;border-left:4px solid #2aa8ff;border-radius:9px;background:#0a294d}.mv5-focus small{color:#7f9bb8;font-size:9px}.mv5-focus b{font-size:13px}.mv5-focus span{color:#a1b5cc;font-size:10px}.mv5-row>span{display:grid;gap:2px}.mv5-row>span small{color:#8199b4;font-size:9px}.mv5-metrics-five{grid-template-columns:repeat(5,minmax(0,1fr))}.mv5-event.warn{border-left:3px solid #ff6f83}.mv5-empty.good{color:#45d995}.mv5-data-gap{display:flex;gap:8px;align-items:center;margin:-3px 0 12px;padding:8px 10px;border:1px solid #6f5b2a;border-radius:8px;background:#30291b}.mv5-data-gap b{font-size:10px;color:#ffd27a}.mv5-data-gap span{font-size:10px;color:#b9ad8f}
.mv5-shell{min-width:0}.mv5-intro{margin-bottom:14px}.mv5-intro h1,.mv5-title h1{margin:0;font-size:22px}.mv5-intro p{margin:4px 0 0;color:#9fb2ca}.mv5-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.mv5-card{min-width:0;border:1px solid #214a78;border-radius:11px;background:linear-gradient(180deg,#0b274a,#09213e);padding:13px;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}.mv5-card:hover{transform:translateY(-1px);border-color:#3c79b3;box-shadow:0 8px 20px rgba(0,0,0,.15)}.mv5-card:focus-visible,.mv5-row:focus-visible,.mv5-event:focus-visible,.mv5-back:focus-visible{outline:2px solid #5fc4ff;outline-offset:2px}.mv5-card-head,.mv5-title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.mv5-card-head b{font-size:10px;color:#56baff}.mv5-card-head span,.mv5-title>span{font-size:10px;color:#829ab6}.mv5-card h2{font-size:15px;margin:8px 0 4px}.mv5-card p{color:#9fb2ca;font-size:11px;overflow-wrap:anywhere;word-break:break-word}.mv5-card dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.mv5-card dl div{background:#091f3b;border-radius:7px;padding:6px}.mv5-card dt{font-size:9px;color:#7791ad}.mv5-card dd{margin:2px 0 0;font-weight:700}.mv5-back{display:inline-block;margin-bottom:12px;color:#67bdff}.mv5-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:15px 0}.mv5-metrics article{min-width:0;border:1px solid #244b77;border-radius:8px;background:#0a294d;padding:10px;display:grid;gap:5px}.mv5-metrics small{color:#829ab6}.mv5-metrics b{font-size:16px;overflow-wrap:anywhere}.mv5-metrics span{font-size:10px;color:#8da5c0}.mv5-list{display:grid;gap:8px}.mv5-row{min-width:0;display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #234b78;border-radius:8px;padding:9px;background:#0a294d;transition:transform .15s ease,border-color .15s ease,background .15s ease}.mv5-row:hover{transform:translateY(-1px);border-color:#3c79b3;background:#0d3159}.mv5-row>span{min-width:0;overflow-wrap:anywhere;word-break:break-word}.mv5-row>b{font-size:10px;color:#56baff}.mv5-state{padding:3px 7px;border-radius:6px;background:#23364f;color:#a8bbd1;font-size:10px;font-style:normal}.mv5-state.active{background:#0c3d35;color:#36dd8c}.mv5-state.blocked{background:#4b2331;color:#ff7489}.mv5-state.done{background:#123b58;color:#52baff}.mv5-report-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.mv5-report-grid section,.mv5-callout{min-width:0;border:1px solid #214a78;border-radius:10px;background:#0a294d;padding:12px}.mv5-report-grid h2{font-size:14px;margin:0 0 9px}.mv5-event{min-width:0;display:grid;gap:3px;padding:8px;border-bottom:1px solid #214a78;border-radius:7px;transition:transform .15s ease,background .15s ease}.mv5-event:hover{transform:translateY(-1px);background:#0d3159}.mv5-event span,.mv5-event b{min-width:0;overflow-wrap:anywhere;word-break:break-word}.mv5-event time{font-size:9px;color:#829ab6}.mv5-settings{display:grid;gap:8px}.mv5-settings article{min-width:0;display:flex;align-items:center;justify-content:space-between;gap:20px;border:1px solid #234b78;border-radius:8px;background:#0a294d;padding:10px 12px}.mv5-settings article div,.mv5-settings article span{min-width:0}.mv5-settings article div{display:grid}.mv5-settings small{color:#829ab6;overflow-wrap:anywhere;word-break:break-word}.mv5-settings span{font-weight:700;overflow-wrap:anywhere;word-break:break-word}.mv5-callout{margin-top:12px}.mv5-callout p{margin:5px 0 0;color:#9fb2ca}.mv5-empty{padding:16px;color:#8197b1;text-align:center;font-size:11px}
`;
// Extend management CSS with Overview live signals and responsive rules.
export const OVERVIEW_SIGNALS_V5_CSS = `
.mv5-overview{display:grid;grid-template-columns:1.35fr 1.05fr .7fr;gap:12px;margin-bottom:13px}.mv5-overview-source{grid-column:1/-1}.mv5-overview-source .mv5-source{margin-bottom:0}.mv5-overview>article{min-width:0;border:1px solid #214a78;border-radius:11px;background:linear-gradient(180deg,rgba(11,34,65,.96),rgba(8,28,54,.97));padding:12px}.mv5-overview h2{margin:0 0 8px;font-size:14px}.mv5-events,.mv5-queue{display:grid;gap:6px}.mv5-events>a,.mv5-queue>a{min-width:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;border-radius:7px;padding:7px;background:#091f3b}.mv5-events>a:hover,.mv5-queue>a:hover{background:#0d3159}.mv5-events time,.mv5-queue b{font-size:9px;color:#56baff}.mv5-events span,.mv5-queue span{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mv5-queue small{grid-column:2;color:#829ab6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mv5-since{display:grid;grid-template-columns:auto 1fr;gap:7px 9px;align-items:center}.mv5-since b{font-size:17px;color:#56baff}.mv5-since span{font-size:10px;color:#9fb2ca}
@media(max-width:1100px){.mv5-overview{grid-template-columns:1fr 1fr}.mv5-overview>article:last-child{grid-column:1/-1}.mv5-grid{grid-template-columns:1fr 1fr}.mv5-metrics{grid-template-columns:1fr 1fr}}@media(max-width:700px){.mv5-overview,.mv5-grid,.mv5-metrics,.mv5-report-grid{grid-template-columns:1fr}.mv5-overview>article:last-child{grid-column:auto}.mv5-row{grid-template-columns:1fr}.mv5-settings article,.mv5-title{align-items:flex-start;flex-direction:column}}
@media(prefers-reduced-motion:reduce){.mv5-card{transition:none}}
`;