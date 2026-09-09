import type { ExecutiveDashboardV4, ExecutivePersonV4, ExecutiveSystemV4, ExecutiveWorkV4 } from './executive-data-v4.js';
import { stableWorkIdV5 } from './work-view-v5.js';
import { recentRuntimeLiveEventsV5, type LiveEventV5 } from './live-events-v5.js';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}
function tone(value: string): string {
  return ['active','waiting','blocked','done','paused','stale','unknown'].includes(value) ? value : 'unknown';
}
function age(timestamp?: string): string {
  const at = Date.parse(timestamp || '');
  if (!Number.isFinite(at)) return 'chưa có mốc';
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return `${s} giây trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}
const priorityRank = (value?: string) => value === 'P0' ? 0 : value === 'P1' ? 1 : value === 'P2' ? 2 : 3;
const stateRank = (value: string) => value === 'blocked' ? 0 : value === 'active' ? 1 : value === 'stale' ? 2 : value === 'waiting' ? 3 : value === 'paused' ? 4 : 5;
function sortWork(items: ExecutiveWorkV4[]): ExecutiveWorkV4[] {
  return [...items].sort((a,b) => priorityRank(a.priority)-priorityRank(b.priority) || stateRank(a.tone)-stateRank(b.tone) || Date.parse(b.lastActivityAt || '')-Date.parse(a.lastActivityAt || ''));
}

function personWork(person: ExecutivePersonV4, data: ExecutiveDashboardV4): ExecutiveWorkV4 | undefined {
  return sortWork(data.works.filter((work) => work.ownerCode === person.key && work.tone !== 'done'))[0];
}
function employeeRow(person: ExecutivePersonV4, data: ExecutiveDashboardV4): string {
  const work = personWork(person, data);
  const current = work
    ? `<div class="cv5-current"><a href="/work/${encodeURIComponent(stableWorkIdV5(work))}"><b>${esc(stableWorkIdV5(work))} · ${esc(work.title)}</b></a><span>${esc(work.currentStep || 'Chưa có bước thực thi được xác minh')}</span></div>`
    : '<div class="cv5-current cv5-idle"><b>Chưa có việc đang chạy được xác minh</b><span>Sẵn sàng nhận việc khi có quyền giữ việc và nhịp sống thật.</span></div>';
  return `<article class="cv5-person"><a class="cv5-person-main" href="/people/${encodeURIComponent(person.key)}"><div class="cv5-avatar">${esc(person.initials)}</div><div class="cv5-person-id"><strong>${esc(person.name)}</strong><small>${esc(person.role)}</small></div></a><span class="cv5-state ${tone(person.tone)}"><i></i>${esc(person.status)}</span>${current}<time>${esc(work ? age(work.lastActivityAt) : '—')}</time></article>`;
}
function priorityWork(work: ExecutiveWorkV4): string {
  return `<a class="cv5-priority-work ${tone(work.tone)}" href="/work/${encodeURIComponent(stableWorkIdV5(work))}"><div><span class="cv5-priority">${esc(work.priority || '—')}</span><b>${esc(work.title)}</b></div><small>${esc(work.owner)} · ${esc(work.status)}</small><p>${esc(work.currentStep || work.next)}</p><time>${esc(age(work.lastActivityAt))}</time></a>`;
}
function systemRow(row: ExecutiveSystemV4): string {
  return `<a class="cv5-system-row" href="/system/${encodeURIComponent(row.key)}"><span class="cv5-system-dot ${tone(row.tone)}"></span><div><b>${esc(row.name)}</b><small>${esc(row.note)}</small></div><strong class="${tone(row.tone)}">${esc(row.status)}</strong></a>`;
}

function attention(data: ExecutiveDashboardV4): string {
  const items: Array<{tone:string; title:string; note:string; href:string}> = [];
  if (data.ownerActionRequired) items.push({ tone:'blocked', title:'Cần anh Sơn xử lý', note:data.ownerActionText, href:'/?view=evidence' });
  for (const work of sortWork(data.works.filter((w) => w.tone === 'blocked' || w.tone === 'stale')).slice(0,4)) {
    items.push({
      tone: work.tone,
      title: `${stableWorkIdV5(work)} · ${work.title}`,
      note: work.tone === 'stale' ? `Mất tín hiệu · ${age(work.lastActivityAt)}` : (work.currentStep || work.next),
      href: `/work/${encodeURIComponent(stableWorkIdV5(work))}`,
    });
  }
  if (!items.length) return '<div class="cv5-clear"><b>Không có việc cần can thiệp ngay</b><span>Chưa ghi nhận blocker, mất nhịp hoặc quyết định bắt buộc.</span></div>';
  return items.map((item) => `<a class="cv5-alert ${tone(item.tone)}" href="${esc(item.href)}"><i></i><div><b>${esc(item.title)}</b><span>${esc(item.note)}</span></div></a>`).join('');
}

function liveEventTone(event:LiveEventV5):string{if(event.severity==='error')return 'blocked';if(event.event_type==='work.completed'||event.event_type==='system.recovered')return 'done';if(event.stale||event.severity==='warning')return 'waiting';return 'active';}
function liveEventLabel(event:LiveEventV5):string{return ({'work.queued':'Xếp hàng','work.claimed':'Đã nhận','work.started':'Bắt đầu','work.step':'Chuyển bước','work.heartbeat':'Heartbeat','work.blocked':'Mất nhịp','work.failed':'Thất bại','work.completed':'Hoàn tất','system.health':'Sức khỏe','system.error':'Lỗi hệ thống','system.recovered':'Phục hồi'} as Record<string,string>)[event.event_type]??event.event_type;}
function liveTimeline():string{const events=recentRuntimeLiveEventsV5(20).reverse(),rows=events.map((event)=>{const href=event.entity_type==='work'?`/work/${encodeURIComponent(event.entity_id)}`:`/system/${encodeURIComponent(event.entity_id)}`;return `<a class="cv5-priority-work ${liveEventTone(event)}" data-live-event-id="${esc(event.event_id)}" href="${href}"><div><span class="cv5-priority">${esc(liveEventLabel(event))}</span><b>${esc(event.entity_id)}</b></div><small>${esc(event.worker_id??event.owner_id??'runtime')}</small><p>${esc(event.message)}</p><time>${esc(age(event.last_activity_at??event.timestamp))}</time></a>`;}).join('');return `<section class="cv5-panel cv5-priority-list" id="x-live-timeline"><header><div><h2>Vừa xảy ra</h2><p>Event runtime thật · tối đa 20 mốc gần nhất.</p></div><span id="x-since-count" data-live-since>—</span></header><div id="x-event-list">${rows||'<div class="cv5-empty">Chưa có event runtime mới.</div>'}</div></section>`;}

export function renderCommandOverviewV5(data: ExecutiveDashboardV4): string {
  const employees = data.people.filter((person) => person.key !== 'VY');
  const busy = employees.filter((person) => person.tone === 'active').length;
  const stale = data.works.filter((work) => work.tone === 'stale').length;
  const critical = data.systems.filter((row) => ['control','worker','web','postgresql','ollama'].includes(row.key));
  const systemWarnings = critical.filter((row) => !['active','done'].includes(row.tone)).length;
  const works = sortWork(data.works.filter((work) => work.tone !== 'done')).slice(0,6);
  const cards = [
    ['Đang thực thi', data.activeCount, data.activeCount ? 'Có nhịp sống và bằng chứng thật' : 'Chưa có việc đang chạy xác minh', 'active'],
    ['Bị chặn / mất nhịp', data.blockedCount + stale, stale ? `${stale} việc mất tín hiệu` : 'Không có cảnh báo công việc', data.blockedCount + stale ? 'blocked' : 'done'],
    ['Nhân sự đang bận', busy, `${employees.length - busy} AI chưa có việc đang chạy`, busy ? 'active' : 'waiting'],
    ['Cần anh Sơn', data.ownerActionRequired ? 1 : 0, data.ownerActionRequired ? data.ownerActionText : 'Không có quyết định bắt buộc', data.ownerActionRequired ? 'blocked' : 'done'],
    ['Hệ thống cần chú ý', systemWarnings, systemWarnings ? 'Có thành phần chưa khỏe/chưa xác minh' : 'Các thành phần chính đang phản hồi', systemWarnings ? 'waiting' : 'done'],
  ];
  const cardHtml = cards.map(([label,value,note,t]) => `<article class="cv5-kpi ${tone(String(t))}"><span class="cv5-kpi-dot"></span><small>${esc(label)}</small><b>${esc(value)}</b><p>${esc(note)}</p></article>`).join('');
  const workHtml = works.length ? works.map(priorityWork).join('') : '<div class="cv5-empty">Chưa có công việc ưu tiên được xác minh.</div>';
  const focus = works[0] ? `<section class="cv5-focus ${tone(works[0].tone)}"><div><small>VIỆC ƯU TIÊN HIỆN TẠI</small><a href="/work/${encodeURIComponent(stableWorkIdV5(works[0]))}"><b>${esc(stableWorkIdV5(works[0]))} · ${esc(works[0].title)}</b></a><span>${esc(works[0].owner)} · ${esc(works[0].status)}</span></div><div><small>Bước hiện tại</small><strong>${esc(works[0].currentStep || works[0].next)}</strong><time>${esc(age(works[0].lastActivityAt))}</time></div></section>` : '';
  const source = `<section class="cv5-source"><b>${esc(data.sourceStatus || 'Nguồn trực tiếp')}</b><span>${esc(data.sourceNote || 'Dữ liệu đang được đồng bộ từ nguồn hiện hành.')}</span></section>`;
  return `<div class="cv5-shell" data-live-section="command-overview">
    <section class="cv5-hero"><div><small>TRUNG TÂM ĐIỀU HÀNH</small><h1>Hôm nay hệ thống đang làm gì?</h1><p>Nhìn theo trách nhiệm và hành động, không theo log kỹ thuật.</p></div><a href="/?view=work">Mở bảng Công việc →</a></section>
    ${source}${focus}<section class="cv5-kpis">${cardHtml}</section>
    <div class="cv5-main-grid"><section class="cv5-panel cv5-people"><header><div><h2>AI đang làm gì ngay lúc này</h2><p>Người phụ trách → việc đang giữ → bước hiện tại → hoạt động cuối.</p></div><a href="/?view=workforce">Xem toàn bộ nhân sự</a></header><div class="cv5-people-head"><span>Nhân sự</span><span>Trạng thái</span><span>Việc / bước hiện tại</span><span>Cập nhật</span></div><div class="cv5-people-list">${employees.map((person) => employeeRow(person,data)).join('')}</div></section>
      <section class="cv5-panel cv5-priority-list"><header><div><h2>Công việc cần nhìn trước</h2><p>Sắp theo ưu tiên và trạng thái cần can thiệp.</p></div><a href="/?view=work">Xem bảng đầy đủ</a></header><div>${workHtml}</div></section></div>
    <div class="cv5-bottom-grid"><section class="cv5-panel"><header><div><h2>Cần chú ý ngay</h2><p>Chỉ blocker, mất nhịp hoặc quyết định thật.</p></div></header><div class="cv5-alerts">${attention(data)}</div></section>
      <section class="cv5-panel"><header><div><h2>Sức khỏe hệ thống chính</h2><p>${systemWarnings ? `${systemWarnings} thành phần cần xem` : 'Các thành phần chính đang phản hồi'}</p></div><a href="/?view=system">Mở Hệ thống</a></header><div class="cv5-systems">${critical.map(systemRow).join('')}</div></section>${liveTimeline()}</div>
  </div>`;
}

export const COMMAND_OVERVIEW_V5_CSS = `
.cv5-source{display:flex;align-items:center;gap:9px;padding:8px 11px;margin-bottom:10px;border:1px solid #28527e;border-radius:9px;background:#092443}.cv5-source b{font-size:10px;color:#4bd99a;white-space:nowrap}.cv5-source span{font-size:10px;color:#91a9c2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cv5-focus{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.75fr);gap:18px;margin-bottom:11px;padding:12px 14px;border:1px solid #2a6395;border-left:4px solid #2aa8ff;border-radius:10px;background:linear-gradient(90deg,#0c3158,#0a2748)}.cv5-focus.blocked{border-left-color:#ff6f83}.cv5-focus>div{display:grid;gap:3px;min-width:0}.cv5-focus small{font-size:9px;color:#7fa4c8;letter-spacing:.08em}.cv5-focus b{font-size:13px}.cv5-focus span,.cv5-focus time{font-size:10px;color:#8fa8c4}.cv5-focus strong{font-size:11px;overflow-wrap:anywhere}
.cv5-shell{min-width:0}.cv5-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:2px 0 14px;padding:4px 2px}.cv5-hero small{color:#63beff;font-size:10px;font-weight:800;letter-spacing:.12em}.cv5-hero h1{margin:3px 0 2px;font-size:24px;letter-spacing:-.02em}.cv5-hero p{margin:0;color:#8fa8c4}.cv5-hero>a,.cv5-panel header>a{color:#68c2ff;font-size:11px}.cv5-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:12px}.cv5-kpi{min-width:0;border:1px solid #244d7b;border-radius:11px;background:linear-gradient(160deg,#0d2b50,#0a213f);padding:12px;position:relative;overflow:hidden}.cv5-kpi-dot{width:8px;height:8px;border-radius:50%;background:#869bb3;display:block;margin-bottom:10px}.cv5-kpi.active .cv5-kpi-dot{background:#35db8b;box-shadow:0 0 0 5px rgba(53,219,139,.08)}.cv5-kpi.blocked .cv5-kpi-dot{background:#ff6f83}.cv5-kpi.waiting .cv5-kpi-dot{background:#ffad55}.cv5-kpi.done .cv5-kpi-dot{background:#55b9ff}.cv5-kpi small{display:block;color:#9eb4cc;font-weight:650}.cv5-kpi>b{display:block;font-size:28px;line-height:1.1;margin:6px 0}.cv5-kpi p{margin:0;color:#839bb6;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;
export const COMMAND_OVERVIEW_V5_CSS_MORE = `
.cv5-main-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(330px,.75fr);gap:12px}.cv5-bottom-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.cv5-panel{min-width:0;border:1px solid #214a78;border-radius:12px;background:linear-gradient(180deg,rgba(11,34,65,.98),rgba(8,28,54,.98));overflow:hidden}.cv5-panel>header{min-height:57px;padding:10px 13px;border-bottom:1px solid rgba(59,104,153,.25);display:flex;align-items:center;justify-content:space-between;gap:12px}.cv5-panel h2{margin:0;font-size:15px}.cv5-panel header p{margin:2px 0 0;color:#8199b4;font-size:10px}.cv5-people-head{display:grid;grid-template-columns:155px 105px minmax(0,1fr) 85px;gap:10px;padding:7px 12px;background:#0d3158;color:#8da7c2;font-size:9px;text-transform:uppercase;letter-spacing:.06em}.cv5-person{display:grid;grid-template-columns:155px 105px minmax(0,1fr) 85px;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid rgba(44,81,124,.55);min-width:0}.cv5-person:hover{background:#0b2d52}.cv5-person-main{display:flex;align-items:center;gap:9px;min-width:0}.cv5-avatar{width:35px;height:35px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#258ee4,#6a4de8);font-size:11px;font-weight:800;flex:none}.cv5-person-id{display:grid;min-width:0}.cv5-person-id strong{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cv5-person-id small{font-size:9px;color:#7f99b6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cv5-state{display:inline-flex;align-items:center;gap:5px;width:max-content;padding:4px 7px;border-radius:999px;background:#223951;color:#a7bcd2;font-size:9px;font-weight:750}.cv5-state i{width:6px;height:6px;border-radius:50%;background:currentColor}.cv5-state.active{background:#0c3d35;color:#36dd8c}.cv5-state.blocked{background:#4b2331;color:#ff7489}.cv5-state.waiting{background:#50351c;color:#ffae58}.cv5-state.paused,.cv5-state.stale{background:#28394e;color:#aab9ca}.cv5-current{display:grid;gap:3px;min-width:0}.cv5-current a{min-width:0}.cv5-current b{display:block;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cv5-current span{font-size:9px;color:#8fa7c1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cv5-person>time{color:#7993ae;font-size:9px;text-align:right}
`;
export const COMMAND_OVERVIEW_V5_CSS_LAST = `
.cv5-priority-list>div{display:grid;gap:7px;padding:9px}.cv5-priority-work{display:grid;gap:4px;padding:9px;border:1px solid #234a75;border-radius:8px;background:#0a294d;transition:.14s}.cv5-priority-work:hover{border-color:#3d78b3;transform:translateY(-1px)}.cv5-priority-work.blocked{border-color:#6e3b4d}.cv5-priority-work>div{display:flex;align-items:flex-start;gap:7px}.cv5-priority{padding:2px 5px;border-radius:5px;background:#193a5d;color:#ffd06a;font-size:9px;font-weight:800}.cv5-priority-work b{font-size:10px}.cv5-priority-work small,.cv5-priority-work time{color:#8199b4;font-size:9px}.cv5-priority-work p{margin:0;color:#c9d8e8;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cv5-alerts,.cv5-systems{display:grid;gap:7px;padding:9px}.cv5-alert{display:flex;gap:9px;align-items:flex-start;padding:9px;border-radius:8px;background:#0a294d;border:1px solid #234b78}.cv5-alert>i{width:8px;height:8px;border-radius:50%;background:#8ba0b7;margin-top:4px;flex:none}.cv5-alert.blocked{border-color:#754256}.cv5-alert.blocked>i{background:#ff6f83}.cv5-alert.stale>i{background:#9ca8b5}.cv5-alert div{display:grid;gap:3px}.cv5-alert b{font-size:10px}.cv5-alert span{font-size:9px;color:#91a8c0}.cv5-clear{display:grid;gap:4px;padding:17px;text-align:center;color:#9db4cc}.cv5-clear b{color:#43d995}.cv5-system-row{display:grid;grid-template-columns:9px minmax(0,1fr) auto;gap:9px;align-items:center;padding:8px;border-radius:8px;background:#0a294d}.cv5-system-dot{width:8px;height:8px;border-radius:50%;background:#8497ac}.cv5-system-dot.active,.cv5-system-dot.done{background:#35d88a;box-shadow:0 0 0 4px rgba(53,216,138,.07)}.cv5-system-dot.blocked{background:#ff6d82}.cv5-system-dot.waiting{background:#ffad55}.cv5-system-row div{display:grid;min-width:0}.cv5-system-row b{font-size:10px}.cv5-system-row small{font-size:9px;color:#7f99b6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cv5-system-row>strong{font-size:9px;color:#a8bbd1}.cv5-system-row>strong.active,.cv5-system-row>strong.done{color:#3bdc91}.cv5-system-row>strong.blocked{color:#ff7489}.cv5-empty{padding:20px;text-align:center;color:#8197b1;font-size:10px}@media(max-width:1250px){.cv5-kpis{grid-template-columns:repeat(3,1fr)}.cv5-main-grid{grid-template-columns:1fr}.cv5-bottom-grid{grid-template-columns:1fr 1fr}}@media(max-width:800px){.cv5-focus{grid-template-columns:minmax(0,1fr)}.cv5-kpis{grid-template-columns:1fr 1fr}.cv5-bottom-grid{grid-template-columns:1fr}.cv5-people-head{display:none}.cv5-person{grid-template-columns:1fr auto}.cv5-current{grid-column:1/-1}.cv5-person>time{text-align:left}.cv5-hero{align-items:flex-start;flex-direction:column}}@media(max-width:520px){.cv5-kpis{grid-template-columns:1fr}.cv5-person{grid-template-columns:1fr}.cv5-state{grid-row:auto}.cv5-person>time{text-align:left}}@media(prefers-reduced-motion:reduce){.cv5-priority-work{transition:none}}
`;
