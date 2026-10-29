// DOM-only renderer. All content from Core is treated as untrusted text.
const $ = id => document.getElementById(id);
const NAMES = {coordination:'Điều phối',engineering:'Kỹ thuật',quality:'Kiểm thử'};
let selected = 'coordination';
let snapshot = null;
const rooms = [...document.querySelectorAll('.room')];

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
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
    cards.append(el('p','Không có dữ liệu Core đã xác minh. Không hiển thị trạng thái suy đoán.','empty'));
    return;
  }
  const room = snapshot.rooms.find(x => x.id === selected);
  for (const r of snapshot.rooms) $('count-' + r.id).textContent = r.items.length + ' thẻ';
  $('total').textContent = String(snapshot.total);
  $('done').textContent = String(snapshot.rooms.reduce((sum,r) =>
    sum + r.items.filter(x => x.state === 'done_verified').length,0));
  const entries = room?.items || [];
  if (!entries.length) {
    cards.append(el('p','Chưa có Work Order thuộc nhóm hiển thị này.','empty'));
    return;
  }
  for (const item of entries.slice(0,24)) {
    const div = el('article',undefined,'work');
    div.append(el('h3','#' + item.id + ' · ' + item.title));
    let status = item.state === 'done_verified' ? 'DONE được xác minh' :
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

async function refresh() {
  $('refresh').disabled = true;
  $('sourceStatus').textContent = 'Đang đối chiếu TigerIQ Core…';
  try {
    const res = await fetch('/api/rooms',{cache:'no-store',credentials:'same-origin'});
    const body = await res.json();
    if (!res.ok || body.ok !== true || body.readOnly !== true ||
        body.dispatchEnabled !== false) throw new Error(body.reason || 'CORE_UNVERIFIED');
    snapshot = body;
    $('sourceStatus').textContent = 'Nguồn: ' + body.source + ' · ' +
      'Cập nhật: ' + new Date(body.verifiedAt).toLocaleString('vi-VN') +
      ' · Chỉ quan sát, không ghi dữ liệu.';
  } catch (error) {
    snapshot = null;
    $('sourceStatus').textContent = 'CHƯA XÁC MINH — ' + String(error.message || error).slice(0,90);
    $('sourceStatus').classList.add('error');
  } finally {
    $('refresh').disabled = false;
    render();
  }
}
rooms.forEach(button => button.addEventListener('click', () => {
  selected = button.dataset.room;
  render();
}));
$('refresh').addEventListener('click', refresh);
refresh();
