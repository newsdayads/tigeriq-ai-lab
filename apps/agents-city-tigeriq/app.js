// DOM-only renderer. All content from Core is treated as untrusted text.
const $ = id => document.getElementById(id);
const NAMES = {coordination:'Điều phối',engineering:'Kỹ thuật',quality:'Kiểm thử'};
let selected = 'coordination';
let snapshot = null;
let liveSnapshot = null;
let refreshing = false;
const rooms = [...document.querySelectorAll('.room')];
const animalCity=document.querySelector('.city');
const rosterPanel=el('section',undefined,'animal-roster');
rosterPanel.setAttribute('aria-label','Danh bạ văn phòng AI 3D');
rosterPanel.style.cssText='position:relative;z-index:1;padding:14px;margin:14px 0 4px;border:1px solid #6286a866;border-radius:16px;background:#12283edb';
const rosterHeading=el('h2','NHÂN SỰ TIGERIQ · 6 KHU', 'section-title');
rosterHeading.style.cssText='font-size:16px;margin:0 0 7px';
const rosterInfo=el('p','Đang đối chiếu Registry #335 và trạng thái Core...','note');
rosterInfo.setAttribute('role','status');
const rosterGrid=el('div',undefined,'animal-roster-grid');
rosterGrid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:9px';
rosterPanel.append(rosterHeading,rosterInfo,rosterGrid);
if(animalCity)animalCity.append(rosterPanel);
let rosterSnapshot=null;
const rosterLabels={BUSY:'Đang làm',IDLE:'Chưa có job',WAIT:'Chờ',STOPPED:'Ngừng',UNKNOWN:'Chưa xác minh'};
const rosterColors={BUSY:'#2fe0a2',IDLE:'#aad1e8',WAIT:'#ffd184',STOPPED:'#b6bbc5',UNKNOWN:'#bec2ce'};
function renderRoster(){
  rosterGrid.replaceChildren();
  if(!rosterSnapshot){
    rosterInfo.textContent='Danh bạ chưa xác minh; chưa hiển thị danh tính hoặc trạng thái.';
    return;
  }
  const data=rosterSnapshot;
  rosterInfo.textContent=data.sourceFresh
    ? data.total+' vị trí · Registry '+data.registryVersion+' và Core đã xác minh · Tiger CEO không chiếm mã NV'
    : data.total+' vị trí tham khảo · Nguồn chưa đủ mới hoặc Core chưa xác minh; không suy diễn AI đang làm';
  for(const zone of data.zones){
    const card=el('section',undefined,'animal-zone-card');
    card.dataset.animalZone=zone.id;
    card.style.cssText='min-width:0;border:1px solid #66839f55;border-radius:12px;background:#1c354d;padding:10px';
    const heading=el('h3',zone.name+' · '+(zone.members?.length||0));
    heading.style.cssText='font-size:13px;font-weight:750;color:#f5f9ff;margin:0 0 8px';
    card.append(heading);
    for(const person of zone.members||[]){
      const line=el('div',undefined,'animal-staff-line');
      line.style.cssText='display:flex;gap:5px;align-items:flex-start;justify-content:space-between;border-top:1px solid #ffffff16;padding:5px 0;font-size:11px';
      const identity=el('span',person.employeeId+' · '+person.name);
      identity.style.cssText='flex:1;min-width:0;overflow-wrap:anywhere';
      const label=el('span',rosterLabels[person.status]||rosterLabels.UNKNOWN);
      label.style.cssText='font-size:10px;white-space:nowrap;color:'+(rosterColors[person.status]||rosterColors.UNKNOWN);
      line.append(identity,label);card.append(line);
    }
    rosterGrid.append(card);
  }
}
async function refreshRoster(){
  try{
    const data=await readJson('/api/roster');
    if(data.readOnly!==true||!Array.isArray(data.zones)||data.zones.length!==6||
       !Array.isArray(data.staff)||data.staff.length>100)
      throw new Error('ROSTER_CONTRACT_INVALID');
    rosterSnapshot=data;
  }catch{rosterSnapshot=null;}
  renderRoster();
  window.dispatchEvent(new CustomEvent('tigeriq:roster',{detail:rosterSnapshot}));
}


function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function renderWorkers() {
  const host = $('workers');
  host.replaceChildren();
  if (!liveSnapshot?.ok || liveSnapshot.liveWorkerBindingsVerified !== true) {
    $('activeWorkers').textContent = '—';
    host.append(el('p','Không có worker/job đang chạy được Core xác minh.','empty'));
    return;
  }
  $('activeWorkers').textContent = String(liveSnapshot.totalActiveWorkers);
  const workers = liveSnapshot.workers.filter(worker => worker.room === selected);
  if (!workers.length) {
    host.append(el('p','Phòng này hiện không có worker BUSY + job running khớp danh tính.','empty'));
    return;
  }
  for (const worker of workers) {
    const div = el('article',undefined,'worker');
    div.append(el('h3',worker.employeeId + ' · ' + worker.name));
    const identity = [
      worker.provider || 'provider chưa rõ',
      worker.capability || worker.kind || 'capability chưa rõ',
      worker.leaseVerified ? 'lease đang hiệu lực' : 'job/resource claim đã xác minh',
    ].join(' · ');
    div.append(el('div',identity,'meta'));
    div.append(el('div','Job: ' + worker.currentJobId,'meta'));
    div.append(el('div',worker.jobTitle,'worker-job'));
    host.append(div);
  }
}

function render() {
  rooms.forEach(button => {
    const active = button.dataset.room === selected;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('panelTitle').textContent = 'Phòng ' + (NAMES[selected] || selected).toLowerCase();
  const cards = $('cards');
  cards.replaceChildren();
  if (!snapshot?.ok) {
    $('total').textContent = '—';
    $('done').textContent = '—';
    for (const id of Object.keys(NAMES)) $('count-' + id).textContent = 'Chưa xác minh';
    $('visibleCount').textContent='Không có Work Order được xác minh.';
    cards.append(el('p','Không có dữ liệu Work Order đã xác minh. Không hiển thị trạng thái suy đoán.','empty'));
    renderWorkers();
    return;
  }
  const room = snapshot.rooms.find(x => x.id === selected);
  for (const r of snapshot.rooms) $('count-' + r.id).textContent = r.items.length + ' thẻ';
  $('total').textContent = String(snapshot.total);
  $('done').textContent = String(snapshot.rooms.reduce((sum,r) =>
    sum + r.items.filter(x => x.state === 'done_verified').length,0));
  const query=String($('workSearch').value||'').trim().toLocaleLowerCase('vi');
  const state=$('workFilter').value;
  const entries=(room?.items||[]).filter(item=>
    (state==='all'||item.state===state) &&
    (!query||['#'+item.id,item.title,item.currentStep,item.nextAction].some(
      value=>String(value||'').toLocaleLowerCase('vi').includes(query))));
  $('visibleCount').textContent=entries.length+' / '+(room?.items?.length||0)+' Work Order trong phòng.';
  if (!entries.length) {
    cards.append(el('p','Chưa có Work Order thuộc nhóm hiển thị này.','empty'));
  } else {
    for (const item of entries.slice(0,24)) {
      const div = el('article',undefined,'work is-'+item.state);
      div.append(el('h3','#' + item.id + ' · ' + item.title));
      const status = item.state === 'done_verified' ? 'DONE được xác minh' :
        item.state === 'open' ? 'Thẻ mở — KHÔNG đồng nghĩa đang chạy' : 'Đóng — chưa xác minh DONE';
      const more = [
        item.priority, status,
        item.progress ? 'Mốc đã đánh dấu ' + item.progress.accepted + '/' + item.progress.total : 'Tiến độ chưa xác minh',
        item.currentStep ? 'Bước: ' + item.currentStep : '',
      ].filter(Boolean).join(' · ');
      div.append(el('div',more,'meta'));
      if (item.nextAction) div.append(el('div','Tiếp theo: ' + item.nextAction,'meta'));
      const link = el('a','Hồ sơ GitHub');
      link.href = item.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      div.append(link);
      cards.append(div);
    }
  }
  renderWorkers();
}

async function readJson(path) {
  const response = await fetch(path,{cache:'no-store',credentials:'same-origin'});
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.reason || 'SOURCE_UNVERIFIED');
  }
  return body;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  $('refresh').disabled = true;
  $('sourceStatus').textContent = 'Đang đối chiếu Work Order…';
  $('liveStatus').textContent = 'Đang đối chiếu worker/job Core…';
  try {
    const [workResult,liveResult] = await Promise.allSettled([
      readJson('/api/rooms'),
      readJson('/api/live'),
    ]);

    if (workResult.status === 'fulfilled' &&
        workResult.value.readOnly === true &&
        workResult.value.dispatchEnabled === false) {
      snapshot = workResult.value;
      $('sourceStatus').classList.remove('error');
      $('sourceStatus').textContent = 'Work Order: ' + snapshot.source + ' · ' +
        new Date(snapshot.verifiedAt).toLocaleString('vi-VN') + ' · chỉ đọc.';
    } else {
      snapshot = null;
      $('sourceStatus').classList.add('error');
      $('sourceStatus').textContent = 'CHƯA XÁC MINH Work Order — ' +
        String(workResult.reason?.message || 'CORE_UNVERIFIED').slice(0,90);
    }

    if (liveResult.status === 'fulfilled' &&
        liveResult.value.liveWorkerBindingsVerified === true) {
      liveSnapshot = liveResult.value;
      $('liveStatus').classList.remove('error');
      $('liveStatus').textContent = 'Worker runtime: ' + liveSnapshot.source + ' · ' +
        new Date(liveSnapshot.verifiedAt).toLocaleString('vi-VN') +
        ' · ' + liveSnapshot.totalActiveWorkers + ' worker đang làm được xác minh.';
    } else {
      liveSnapshot = null;
      $('liveStatus').classList.add('error');
      $('liveStatus').textContent = 'CHƯA XÁC MINH worker/job — ' +
        String(liveResult.reason?.message || 'CORE_LIVE_UNVERIFIED').slice(0,90);
    }
  } finally {
    refreshing = false;
    $('refresh').disabled = false;
    render();
    // The WebGL world lights up only from a verified Core worker/job binding.
    window.dispatchEvent(new CustomEvent('tigeriq:live',{detail:liveSnapshot}));
  }
}

rooms.forEach(button => button.addEventListener('click', () => {
  selected = button.dataset.room;
  render();
}));
$('workSearch').addEventListener('input',render);
$('workFilter').addEventListener('change',render);
window.addEventListener('tigeriq:refresh',refresh);
$('refresh').addEventListener('click', refresh);
$('refresh').addEventListener('click', refreshRoster);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {refresh();refreshRoster();}
});
setInterval(() => {
  if (document.visibilityState === 'visible') refresh();
}, 10_000);
setInterval(() => {
  if (document.visibilityState === 'visible') refreshRoster();
}, 30_000);
refresh();
refreshRoster();
