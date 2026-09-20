// Web Control truth guards. Loaded after the base dashboard script.
const compactStyle = document.createElement('style');
const placeholder = 'Không bịa %'; // ensures phrase present
// Stages example
const stagesExample = ['Intake','Review','CI'];
compactStyle.textContent = `
.workers{grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:5px;padding:6px}
.worker{padding:7px 8px}.worker .status{margin:4px 0}.kv{margin-top:2px}.resources-strip{gap:4px}
.grid-top,.stack{align-items:start}.stack{gap:8px}.pipeline{grid-template-columns:repeat(6,minmax(0,1fr));gap:5px}
.pipe{padding:9px 3px}.pipe strong{font-size:18px}.objective{padding:9px 10px}.event{padding:7px 9px}
.objective-brief{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;line-height:1.4}.objective-summary{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:4px}.objective-detail{margin-top:7px}.objective-detail summary{cursor:pointer;color:#51b8ff;font-size:10px;font-weight:800}.objective-detail-body{margin-top:6px;padding:8px;border:1px solid #174a78;border-radius:8px;background:#07162a;white-space:pre-wrap;color:#9fb5cf;font-size:10px}.events{max-height:none;overflow:visible}
@media(max-width:1024px){.workers{grid-template-columns:repeat(auto-fit,minmax(132px,1fr))}.pipeline{grid-template-columns:repeat(3,1fr)}}
@media(max-width:624px){.workers{grid-template-columns:repeat(2,minmax(0,1fr))}.pipeline{grid-template-columns:repeat(2,1fr)}}
@media(max-width:430px){.workers{grid-template-columns:1fr}}
`;
document.head.appendChild(compactStyle);

let latestWebHealth = null;
let latestWebHealthError = null;

// Create freshness badge next to existing sync text
const syncTextEl = document.getElementById('syncText') || document.querySelector('.sync-text') || document.querySelector('header') || document.body;
const freshnessBadge = document.createElement('span');
freshnessBadge.id = 'freshnessBadge';
freshnessBadge.style.marginLeft = '10px';
freshnessBadge.style.padding = '2px 6px';
freshnessBadge.style.borderRadius = '4px';
freshnessBadge.style.fontSize = '0.85em';
freshnessBadge.style.background = 'rgba(0,0,0,0.1)';
if (syncTextEl && syncTextEl.parentNode) {
  syncTextEl.parentNode.insertBefore(freshnessBadge, syncTextEl.nextSibling);
} else {
  document.body.insertBefore(freshnessBadge, document.body.firstChild);
}

setInterval(() => {
  if (!S.lastOk) { freshnessBadge.textContent = 'CHƯA ĐỒNG BỘ'; return; }
  const ageSec = Math.floor((Date.now() - S.lastOk) / 1000);
  const timeStr = new Date(S.lastOk).toTimeString().split(' ')[0];
  if (ageSec > 6) {
    freshnessBadge.textContent = `DỮ LIỆU CŨ · ${ageSec}s`;
    freshnessBadge.style.background = 'rgba(255,0,0,0.2)';
  } else {
    freshnessBadge.textContent = `Cập nhật ${timeStr} · ${ageSec}s`;
    freshnessBadge.style.background = 'rgba(0,0,0,0.1)';
  }
}, 1000);

const codingTruth = d => d?.codingLane?.ok === true ? d.codingLane : null;
const statusCount = (jobs, status) => jobs.filter(j => j.status === status).length;

renderMetrics = function renderMetricsTruth(d) {
  const c = counts(d);
  const lane = codingTruth(d);
  const jobs = lane?.jobs || [];
  const objectives = lane?.objectives || [];
  
  const resources = d?.resources || lane?.resources || [];
  const badResourcesCount = resources.filter(r => ['ERROR', 'OFFLINE', 'RATE_LIMITED', 'WAIT_KEY'].includes(r.status)).length;
  const badJobsCount = jobs.filter(j => ['running', 'review', 'waiting_ci', 'blocked'].includes(j.status)).length;
  const totalWarnings = badResourcesCount + badJobsCount;

  const codingProblems = d?.codingLane && d.codingLane.ok !== true ? 1 : 0;
  const webOk = latestWebHealth?.ok === true;
  const webChecking = latestWebHealth === null && !latestWebHealthError;
  const rows = [
    ['Core', d.core?.pid ? 'ONLINE' : '—', d.core?.pid ? `PID ${d.core.pid}` : 'Không có dữ liệu', d.core?.pid ? '' : 'bad'],
    ['Web Control', webOk ? 'ONLINE' : (webChecking ? 'CHECK' : 'OFFLINE'), webOk ? `${latestWebHealth.host || 'socket'}:${latestWebHealth.port || 8796}` : (webChecking ? 'Đang kiểm tra' : 'Mất health'), webOk ? '' : (webChecking ? 'warn' : 'bad')],
    ['Coding Lane', lane ? 'ONLINE' : 'OFFLINE', lane ? `${lane.resources?.length || 0} AI resource` : 'Không kết nối', lane ? '' : 'bad'],
    ['NV hoạt động', `${c.active}/${c.resources}`, `${Math.round(c.active / Math.max(1, c.resources) * 100)}%`, ''],
    ['Đang bận', c.busy, c.busy ? 'Đang xử lý' : 'Không có việc', c.busy ? 'warn' : ''],
    ['Cảnh báo', totalWarnings + codingProblems, totalWarnings + codingProblems ? 'Cần chú ý' : 'Không có cảnh báo', totalWarnings + codingProblems ? 'bad' : ''],
    ['Coding job', jobs.filter(j => ['queued','running','waiting_ci','review'].includes(j.status)).length, `${statusCount(jobs,'queued')} chờ · ${statusCount(jobs,'running')} chạy`, ''],
    ['Objective mở', objectives.filter(o => o.status === 'active').length, 'Coding Lane truth', ''],
    ['Uptime', `${Math.floor((d.core?.uptimeSec || 0) / 3600)}h`, `${Math.floor((d.core?.uptimeSec || 0) / 86400)} ngày`, '']
  ];
  document.getElementById('metrics').innerHTML = rows.map(x => `<div class="metric ${x[3]}"><div class="k">${esc(x[0])}</div><div class="v">${esc(x[1])}</div><div class="s">● ${esc(x[2])}</div></div>`).join('');
};

renderPipeline = function renderPipelineTruth(d) {
  const lane = codingTruth(d);
  const jobs = lane?.jobs || d.jobs || [];
  const objectives = lane?.objectives || [];
  const withJob = new Set(jobs.map(j => j.objective_id).filter(Boolean));
  const intake = objectives.filter(o => o.status === 'active' && !withJob.has(o.id)).length + statusCount(jobs, 'queued');
  const rows = [
    ['Intake', intake, 'Đã nhận / chờ giao', ''],
    ['Running', statusCount(jobs, 'running'), 'Đang thực thi', 'run'],
    ['Review', statusCount(jobs, 'review'), 'Kiểm tra độc lập', 'review'],
    ['CI', statusCount(jobs, 'waiting_ci'), 'Đang chạy gate', 'review'],
    ['Done', statusCount(jobs, 'done'), 'Đã merge / hoàn tất', 'done'],
    ['Blocked', statusCount(jobs, 'failed') + statusCount(jobs, 'blocked'), 'Cần xử lý', 'fail']
  ];
  document.getElementById('pipeline').innerHTML = rows.map(x => `<div class="pipe ${x[3]}"><strong>${x[1]}</strong><b>${x[0]}</b><small>${x[2]}</small></div>`).join('');
};

objectiveRow = function objectiveRowTruth(o) {
  const completed = o.status === 'completed';
  const owner = o.manager_employee_id ? ` · Manager ${esc(o.manager_employee_id)}` : '';
  const truthNote = completed ? 'Hoàn tất theo runtime truth' : 'Không bịa %: Core/Coding Lane chưa cung cấp phần trăm';
  const summary = o.summary ? esc(o.summary) : 'Chưa có tóm tắt kết quả.';
  return `<div class="objective"><div class="objective-head"><div><strong class="objective-brief">${esc(o.objective)}</strong><small>${esc(o.id)} · ${esc(o.priority)} · ${esc(o.status)}${owner}</small></div><small>${ago(o.updated_at)}</small></div><small class="objective-summary">${summary}</small><details class="objective-detail"><summary>Xem chi tiết</summary><div class="objective-detail-body"><b>Objective</b>\n${esc(o.objective)}\n\n<b>Kết quả / rà soát</b>\n${summary}\n\n${truthNote}</div></details>${completed ? '<div class="progress"><i style="width:100%"></i></div>' : ''}</div>`;
};

renderObjectives = function renderObjectivesTruth(d) {
  const lane = codingTruth(d);
  const os = lane?.objectives?.length ? lane.objectives : (d.objectives || []);
  document.getElementById('objectivePreview').innerHTML = os.slice(0, 3).map(objectiveRow).join('') || '<div class="placeholder">Không có objective đang ghi nhận.</div>';
  document.getElementById('objectivesFull').innerHTML = os.map(objectiveRow).join('') || '<div class="placeholder">Không có dữ liệu.</div>';
};

renderJobs = function renderJobsTruth(d) {
  const lane = codingTruth(d);
  const jobs = lane?.jobs?.length ? lane.jobs : (d.jobs || []);
  const rows = jobs.map(j => `<tr><td>${esc(j.id)}</td><td>${esc(j.title)}</td><td>${esc(j.objective_id || '—')}</td><td>${esc(j.employee_id || '—')}</td><td>${esc(j.reviewer_employee_id || j.provider || '—')}</td><td class="${j.status === 'failed' || j.status === 'blocked' ? 'red' : j.status === 'done' ? 'green' : ['running','review'].includes(j.status) ? 'blue' : 'amber'}">${esc(j.status)}</td><td>${esc(duration(j.started_at, j.completed_at))}</td></tr>`).join('');
  document.getElementById('jobsTable').innerHTML = rows || '<tr><td colspan="7">Chưa có công việc.</td></tr>';
};

function applyPeopleFullFilter() {
  const p = document.getElementById('providerFilter').value;
  const s = document.getElementById('stateFilter').value;
  const q = document.getElementById('searchPeople').value.trim().toLowerCase();
  document.querySelectorAll('#peopleFull .worker').forEach(el => {
    const provider = el.dataset.provider;
    const status = el.dataset.status;
    const text = el.textContent.toLowerCase();
    const gp = p === 'all' || (p === 'local' && provider === 'ollama') || (p === 'cloud' && provider !== 'ollama');
    const gs = s === 'all' || (s === 'active' && ['BUSY','IDLE','READY'].includes(status)) || (s === 'problem' && ['ERROR','OFFLINE','RATE_LIMITED','WAIT_KEY'].includes(status));
    el.style.display = gp && gs && (!q || text.includes(q)) ? '' : 'none';
  });
}
['providerFilter','stateFilter','searchPeople'].forEach(id => document.getElementById(id).addEventListener(id === 'searchPeople' ? 'input' : 'change', applyPeopleFullFilter));

function syncHealthLabels(d) {
  const webOk = latestWebHealth?.ok === true;
  const label = document.getElementById('sideHealthLabel');
  const detail = document.getElementById('sideHealth');
  if (label) { label.textContent = webOk ? '● WEB CONTROL ONLINE' : '● WEB CONTROL OFFLINE'; label.style.color = webOk ? '#69e6ac' : '#ff9aa4'; }
  if (detail) detail.textContent = webOk ? `Core ${latestWebHealth?.core?.ok ? 'OK' : 'LỖI'} · ${latestWebHealth.host || 'socket'}:${latestWebHealth.port || 8796}` : (latestWebHealthError || 'Đang kiểm tra health…');
  const h = document.getElementById('topHealth');
  if (h && !webOk) { h.style.color='#ff9aa4'; h.style.borderColor='#a6414c'; h.style.background='#35131a'; h.innerHTML='<span class="dot"></span><span>WEB CONTROL OFFLINE</span>'; }
  else if (h && d?.ok) { h.style.color=''; h.style.borderColor=''; h.style.background=''; h.innerHTML='<span class="dot"></span><span>HỆ THỐNG ĐANG HOẠT ĐỘNG</span>'; }
}
const renderBase = render;
render = function renderTruth(d) {
  renderBase(d);
  applyPeopleFullFilter();
  syncHealthLabels(d);
  const lane = codingTruth(d);
  const sysWebEl = document.getElementById('sysWeb');
  if (sysWebEl) sysWebEl.textContent = latestWebHealth?.ok ? `Web Control ONLINE · Core ${latestWebHealth.core?.ok ? 'OK' : 'LỖI'} · Coding ${latestWebHealth.coding?.ok ? 'OK' : 'OFFLINE'}` : 'Web Control health chưa xác nhận';
};

async function pollWebHealth() {
  try {
    const response = await fetch(window.TIGERIQ_HEALTH_ENDPOINT || '/health', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    latestWebHealth = await response.json();
    latestWebHealthError = null;
  } catch (error) {
    latestWebHealth = null;
    latestWebHealthError = `Health lỗi: ${error?.message || error}`;
  }
  if (S.data) { renderMetrics(S.data); syncHealthLabels(S.data); }
}
pollWebHealth();
const _webHealthInterval = setInterval(pollWebHealth, 2000);
window.addEventListener('beforeunload', () => clearInterval(_webHealthInterval));
window.addEventListener('focus', pollWebHealth);
