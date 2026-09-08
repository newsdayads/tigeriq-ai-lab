import type { ExecutiveDashboardV4, ExecutiveWorkV4 } from './executive-data-v4.js';

type WorkLaneV5 = 'active' | 'waiting' | 'blocked' | 'done';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

export function stableWorkIdV5(work: ExecutiveWorkV4): string {
  return work.workId || (work.number ? `GH-${work.number}` : 'UNKNOWN');
}

function normalizedWorkId(value: string | null): string {
  const raw = String(value ?? '').trim();
  if (/^\d+$/.test(raw)) return `GH-${raw}`;
  return raw;
}

function laneFor(work: ExecutiveWorkV4): WorkLaneV5 {
  if (work.tone === 'active') return 'active';
  if (work.tone === 'blocked') return 'blocked';
  if (work.tone === 'done') return 'done';
  return 'waiting';
}

function ageLabel(timestamp?: string): string {
  const value = Date.parse(timestamp || '');
  if (!Number.isFinite(value)) return 'Chưa có mốc';
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s trước`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ trước`;
  return `${Math.floor(seconds / 86400)} ngày trước`;
}
function queryState(url: URL) {
  return {
    q: (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('vi-VN'),
    owner: (url.searchParams.get('owner') ?? '').trim(),
    priority: (url.searchParams.get('priority') ?? '').trim().toUpperCase(),
    lane: (url.searchParams.get('lane') ?? '').trim() as WorkLaneV5 | '',
    stale: url.searchParams.get('stale') === '1',
  };
}

function matches(work: ExecutiveWorkV4, state: ReturnType<typeof queryState>): boolean {
  if (state.q && !`${stableWorkIdV5(work)} ${work.title} ${work.goal ?? ''} ${work.owner} ${work.currentStep ?? ''}`.toLocaleLowerCase('vi-VN').includes(state.q)) return false;
  if (state.owner && work.ownerCode !== state.owner) return false;
  if (state.priority && String(work.priority ?? '—').toUpperCase() !== state.priority) return false;
  if (state.lane && laneFor(work) !== state.lane) return false;
  if (state.stale && work.tone !== 'stale') return false;
  return true;
}

function filtersQuery(url: URL): string {
  const keep = new URLSearchParams();
  for (const key of ['q', 'owner', 'priority', 'lane', 'stale']) {
    const value = url.searchParams.get(key);
    if (value) keep.set(key, value);
  }
  return keep.toString();
}

function detailHref(work: ExecutiveWorkV4, url: URL): string {
  const qs = filtersQuery(url);
  return `/work/${encodeURIComponent(stableWorkIdV5(work))}${qs ? `?${qs}` : ''}`;
}

function toneClass(work: ExecutiveWorkV4): string {
  return ['active', 'waiting', 'blocked', 'done', 'paused', 'stale'].includes(work.tone) ? work.tone : 'unknown';
}
function filterBar(data: ExecutiveDashboardV4, url: URL): string {
  const state = queryState(url);
  const owners = [...new Set(data.works.map((work) => work.ownerCode).filter(Boolean))] as string[];
  const priorities = [...new Set(data.works.map((work) => work.priority).filter((value): value is string => Boolean(value && value !== '—')))];
  const option = (value: string, label: string, selected: string) => `<option value="${esc(value)}"${selected === value ? ' selected' : ''}>${esc(label)}</option>`;
  return `<form class="wv5-filters" method="get" action="/">
    <input type="hidden" name="view" value="work">
    <input name="q" value="${esc(url.searchParams.get('q') ?? '')}" placeholder="Tìm Work ID, mục tiêu, bước…">
    <select name="owner"><option value="">Tất cả AI</option>${owners.map((owner) => option(owner, owner, state.owner)).join('')}</select>
    <select name="priority"><option value="">Mọi ưu tiên</option>${priorities.map((priority) => option(priority, priority, state.priority)).join('')}</select>
    <select name="lane"><option value="">Mọi trạng thái</option>${option('active','Đang thực thi',state.lane)}${option('waiting','Chờ',state.lane)}${option('blocked','Bị chặn',state.lane)}${option('done','Hoàn tất',state.lane)}</select>
    <label class="wv5-check"><input type="checkbox" name="stale" value="1"${state.stale ? ' checked' : ''}> Có thể đang treo</label>
    <button type="submit">Lọc</button><a href="/?view=work">Xóa lọc</a>
  </form>`;
}

function card(work: ExecutiveWorkV4, url: URL): string {
  const id = stableWorkIdV5(work);
  const evidence = work.evidenceRef ? `<a class="wv5-evidence" href="${esc(work.evidenceRef)}">Bằng chứng cuối</a>` : '<span class="wv5-muted">Chưa có evidence link</span>';
  return `<article class="wv5-card ${toneClass(work)}">
    <div class="wv5-card-top"><a class="wv5-title" href="${esc(detailHref(work,url))}"><b>${esc(id)}</b><span>${esc(work.title)}</span></a><span class="wv5-priority">${esc(work.priority ?? '—')}</span></div>
    <div class="wv5-meta"><span>${esc(work.owner)}</span><span>${esc(work.project ?? 'Chưa chuẩn hóa project mapping')}</span></div>
    <div class="wv5-step"><small>Bước hiện tại</small><strong>${esc(work.currentStep ?? 'Chưa có bước thực thi xác minh')}</strong></div>
    <div class="wv5-foot"><span class="wv5-status ${toneClass(work)}">${esc(work.status)}</span><span>${esc(ageLabel(work.lastActivityAt))}</span>${evidence}</div>
  </article>`;
}
function board(data: ExecutiveDashboardV4, url: URL): string {
  const state = queryState(url);
  const filtered = data.works.filter((work) => matches(work, state));
  const defs: Array<[WorkLaneV5, string]> = [['active','Đang thực thi'],['waiting','Chờ'],['blocked','Bị chặn'],['done','Hoàn tất gần đây']];
  return `<div class="wv5-board">${defs.map(([lane,label]) => {
    const items = filtered.filter((work) => laneFor(work) === lane);
    return `<section class="wv5-lane ${lane}"><header><h2>${label}</h2><b>${items.length}</b></header><div class="wv5-stack">${items.length ? items.map((work) => card(work,url)).join('') : '<div class="wv5-empty">Không có Work phù hợp.</div>'}</div></section>`;
  }).join('')}</div>`;
}

function detail(data: ExecutiveDashboardV4, url: URL, selectedRaw: string): string {
  const selectedId = normalizedWorkId(selectedRaw);
  const work = data.works.find((item) => stableWorkIdV5(item) === selectedId || String(item.number ?? '') === selectedRaw);
  const qs = filtersQuery(url);
  const back = `/?view=work${qs ? `&${qs}` : ''}`;
  if (!work) return `<section class="wv5-detail"><a class="wv5-back" href="${back}">← Công việc</a><div class="wv5-empty">Không tìm thấy ${esc(selectedId)} trong snapshot hiện hành.</div></section>`;
  const timeline = work.timeline?.length ? work.timeline.map((event) => `<li><time>${esc(event.timestamp ? new Date(event.timestamp).toLocaleString('vi-VN',{hour12:false}) : '—')}</time><p>${esc(event.message)}</p>${event.evidenceRef ? `<a href="${esc(event.evidenceRef)}">Mở evidence</a>` : ''}</li>`).join('') : '<li class="wv5-empty">Chưa có timeline được xác minh.</li>';
  return `<section class="wv5-detail"><a class="wv5-back" href="${back}">← Công việc</a><div class="wv5-detail-head"><div><small>${esc(stableWorkIdV5(work))} · ${esc(work.priority ?? '—')}</small><h2>${esc(work.title)}</h2><p>${esc(work.goal ?? 'Chưa có mục tiêu chi tiết được chuẩn hóa.')}</p></div><span class="wv5-status ${toneClass(work)}">${esc(work.status)}</span></div><div class="wv5-detail-grid"><article><small>AI phụ trách</small><b>${esc(work.owner)}</b></article><article><small>Bước hiện tại</small><b>${esc(work.currentStep ?? 'Chưa xác minh')}</b></article><article><small>Hoạt động cuối</small><b>${esc(ageLabel(work.lastActivityAt))}</b></article><article><small>Việc kế tiếp</small><b>${esc(work.next)}</b></article></div><div class="wv5-timeline"><h3>Timeline / evidence</h3><ol>${timeline}</ol></div></section>`;
}

export function renderWorkContentV5(data: ExecutiveDashboardV4, url: URL, selectedRaw = ''): string {
  return `<div class="wv5-shell"><div class="wv5-intro"><div><h1>Công việc</h1><p>Execution board — chỉ hiển thị trạng thái có nguồn xác minh.</p></div><span>generated ${esc(data.generatedAt)}</span></div>${selectedRaw ? detail(data,url,selectedRaw) : `${filterBar(data,url)}${board(data,url)}`}</div>`;
}
export const WORK_V5_CSS = `
.wv5-shell{min-width:0}.wv5-intro{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:0 0 14px}.wv5-intro h1{margin:0;font-size:22px}.wv5-intro p{margin:4px 0 0;color:#9fb2ca}.wv5-intro>span{color:#7890ac;font-size:11px}.wv5-filters{display:grid;grid-template-columns:minmax(220px,1.6fr) repeat(3,minmax(120px,.7fr)) auto auto auto;gap:8px;margin-bottom:14px}.wv5-filters input,.wv5-filters select,.wv5-filters button,.wv5-filters>a{height:38px;border:1px solid #28527e;border-radius:8px;background:#0a294d;color:#e9f2ff;padding:0 10px}.wv5-filters button{background:#0875dc;cursor:pointer}.wv5-filters>a{display:grid;place-items:center;color:#b7cae0}.wv5-check{display:flex;align-items:center;gap:6px;color:#a9bdd4;white-space:nowrap}.wv5-check input{width:auto;height:auto}.wv5-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:start}.wv5-lane{min-width:0;background:rgba(7,27,55,.58);border:1px solid #1d436e;border-radius:12px;overflow:hidden}.wv5-lane>header{height:47px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;border-bottom:1px solid #1d436e}.wv5-lane h2{margin:0;font-size:13px}.wv5-lane header b{min-width:25px;height:25px;border-radius:999px;display:grid;place-items:center;background:#183d66;font-size:11px}.wv5-stack{display:grid;gap:9px;padding:9px}.wv5-card{min-width:0;border:1px solid #224c79;background:#0b274a;border-radius:10px;padding:10px;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}.wv5-card:hover{transform:translateY(-1px);border-color:#3c79b3;box-shadow:0 7px 18px rgba(0,0,0,.16)}.wv5-card.blocked{border-color:#704052}.wv5-card.stale{opacity:.78}.wv5-card-top{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}.wv5-title{min-width:0;display:grid;gap:3px}.wv5-title b{font-size:10px;color:#58b8ff}.wv5-title span{font-size:12px;font-weight:650;line-height:1.35}.wv5-title:focus-visible,.wv5-evidence:focus-visible,.wv5-back:focus-visible{outline:2px solid #5fc4ff;outline-offset:2px}.wv5-priority{flex:none;padding:2px 6px;border-radius:5px;background:#173b62;color:#ffd477;font-size:10px;font-weight:700}.wv5-meta,.wv5-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:#93abc5;font-size:10px}.wv5-meta{margin:8px 0}.wv5-step{display:grid;gap:3px;margin:8px 0;padding:8px;border-radius:7px;background:#091f3b}.wv5-step small{color:#7f99b6}.wv5-step strong{font-size:11px;font-weight:600;overflow-wrap:anywhere}.wv5-status{display:inline-flex;padding:3px 7px;border-radius:6px;background:#23364f;color:#a8bbd1;font-size:10px;font-weight:700}.wv5-status.active{background:#0c3d35;color:#36dd8c}.wv5-status.blocked{background:#4b2331;color:#ff7489}.wv5-status.done{background:#123b58;color:#52baff}.wv5-status.waiting{background:#50351c;color:#ffae58}.wv5-evidence{margin-left:auto;color:#56baff}.wv5-muted{margin-left:auto;color:#738aa5}.wv5-empty{padding:18px 10px;color:#8197b1;text-align:center;font-size:11px}.wv5-detail{border:1px solid #214a78;border-radius:12px;background:linear-gradient(180deg,rgba(11,34,65,.96),rgba(8,28,54,.97));padding:15px}.wv5-back{display:inline-block;margin-bottom:12px;color:#67bdff}.wv5-detail-head{display:flex;justify-content:space-between;gap:18px}.wv5-detail-head h2{margin:4px 0 7px}.wv5-detail-head p{margin:0;color:#a7bbd2;max-width:850px}.wv5-detail-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}.wv5-detail-grid article{min-width:0;border:1px solid #244b77;border-radius:8px;background:#0a294d;padding:10px;display:grid;gap:5px}.wv5-detail-grid small{color:#839bb6}.wv5-detail-grid b{overflow-wrap:anywhere}.wv5-timeline{border-top:1px solid #214a78;padding-top:12px}.wv5-timeline h3{margin:0 0 8px}.wv5-timeline ol{list-style:none;margin:0;padding:0;display:grid;gap:8px}.wv5-timeline li{border-left:2px solid #286da6;padding:5px 9px}.wv5-timeline time{font-size:10px;color:#829ab6}.wv5-timeline p{margin:3px 0;color:#d8e6f5}.wv5-timeline a{font-size:10px;color:#59baff}
@media(max-width:1250px){.wv5-board{grid-template-columns:1fr 1fr}.wv5-filters{grid-template-columns:1fr 1fr 1fr}.wv5-detail-grid{grid-template-columns:1fr 1fr}}@media(max-width:760px){.wv5-board,.wv5-filters,.wv5-detail-grid{grid-template-columns:1fr}.wv5-intro,.wv5-detail-head{align-items:flex-start;flex-direction:column}.wv5-evidence,.wv5-muted{margin-left:0}}
@media(prefers-reduced-motion:reduce){.wv5-card{transition:none}}
`;