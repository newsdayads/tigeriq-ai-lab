await import('./app.js');

const $ = id => document.getElementById(id);
const meta = {
  overview: ['TIG OWNER COCKPIT', 'Tổng quan', 'Tình hình công ty, quyết định cần Sếp và kết quả quan trọng.'],
  'owner-actions': ['OWNER ACTION', 'CẦN SẾP', 'Chỉ hiển thị ngoại lệ đang chờ quyết định; không suy diễn AUTHORIZE.'],
  missions: ['WORK', 'Công việc', 'Goal/KPI, Trello read-only, Mission, Outcome và Process trong một luồng.'],
  organization: ['COMPANY', 'Công ty', 'Phòng ban và AI Employee theo vai trò kinh doanh; model/provider là năng lực kỹ thuật.'],
  technical: ['SYSTEM', 'Hệ thống', 'Controller, SHA/CI, Job, lease, provider, device, Prompt và Result/Evidence.'],
};

function setMeta(view) {
  const row = meta[view] || meta.overview;
  if ($('pageEyebrow')) $('pageEyebrow').textContent = row[0];
  if ($('pageTitle')) $('pageTitle').textContent = row[1];
  if ($('pageSubtitle')) $('pageSubtitle').textContent = row[2];
}

function count(selector) { return document.querySelectorAll(selector).length; }
function updateExecutiveSummary() {
  const ownerCount = count('#homeOwnerActions .owner-action-mini');
  const missionCount = count('#homeMissions .mission-row');
  const outcomeCount = count('#homeOutcomes .outcome-row');
  const badKpis = count('#homeKpis .status.bad');
  document.body.classList.toggle('has-owner-actions', ownerCount > 0);
  if ($('cockpitMissionCount')) $('cockpitMissionCount').textContent = String(missionCount);
  if ($('cockpitOwnerCount')) $('cockpitOwnerCount').textContent = String(ownerCount);
  if ($('cockpitOutcomeCount')) $('cockpitOutcomeCount').textContent = String(outcomeCount);
  if ($('cockpitHealth')) $('cockpitHealth').textContent = ownerCount > 0 ? 'Cần Sếp quyết định' : badKpis > 0 ? 'Cần theo dõi KPI' : 'Đang vận hành ổn định';
  if ($('cockpitHealthSummary')) $('cockpitHealthSummary').textContent = ownerCount > 0
    ? `${ownerCount} ngoại lệ đang chờ Sếp; các phần còn lại chỉ tiếp tục trong authority envelope hiện có.`
    : 'Không có Owner Action đang chờ trong projection hiện tại.';
}

for (const button of document.querySelectorAll('.nav button')) {
  button.addEventListener('click', () => setMeta(button.dataset.view));
}
document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target.closest('[data-view-jump]') : null;
  if (target) queueMicrotask(() => setMeta(target.getAttribute('data-view-jump')));
});

const observed = ['homeOwnerActions','homeMissions','homeOutcomes','homeKpis'].map($).filter(Boolean);
const observer = new MutationObserver(updateExecutiveSummary);
for (const node of observed) observer.observe(node, { childList:true, subtree:true, characterData:true });
setMeta(location.hash.slice(1) || 'overview');
updateExecutiveSummary();
