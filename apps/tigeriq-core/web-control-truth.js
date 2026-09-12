// Web Control truth guards. Loaded after the base dashboard script.
const compactStyle = document.createElement('style');
compactStyle.textContent = `
.workers{grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:5px;padding:6px}
.worker{padding:7px 8px}.worker .status{margin:4px 0}.kv{margin-top:2px}.resources-strip{gap:4px}
.grid-top,.stack{align-items:start}.stack{gap:8px}.pipeline{grid-template-columns:repeat(6,minmax(0,1fr));gap:5px}
.pipe{padding:9px 3px}.pipe strong{font-size:18px}.objective{padding:9px 10px}.event{padding:7px 9px}
.freshness-indicator { font-size: 12px; margin-left: 10px; display: inline-flex; align-items: center; gap: 4px; }
.freshness-indicator.stale { color: #fff; background: #dc2626; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
.stale-warning-banner { background: #fee2e2; color: #991b1b; padding: 8px 12px; margin-bottom: 8px; border-radius: 4px; font-weight: 500; display: none; }
.stale-warning-banner.visible { display: block; }
@media(max-width:1024px){.workers{grid-template-columns:repeat(auto-fit,minmax(132px,1fr))}.pipeline{grid-template-columns:repeat(3,1fr)}}
@media(max-width:624px){.workers{grid-template-columns:repeat(2,minmax(0,1fr))}.pipeline{grid-template-columns:repeat(2,1fr)}}
@media(max-width:430px){.workers{grid-template-columns:1fr}}
`;
document.head.appendChild(compactStyle);

// Create warning banner and inject into DOM if not present
let warningBanner = document.getElementById('staleWarningBanner');
if (!warningBanner) {
  warningBanner = document.createElement('div');
  warningBanner.id = 'staleWarningBanner';
  warningBanner.className = 'stale-warning-banner';
  warningBanner.textContent = 'Cảnh báo: Dữ liệu có thể đã cũ do mất kết nối hoặc lỗi phản hồi.';
  const container = document.querySelector('.container') || document.body;
  container.insertBefore(warningBanner, container.firstChild);
}

// Create freshness indicator next to topHealth / sysWeb or header
let freshnessEl = document.getElementById('freshnessIndicator');
if (!freshnessEl) {
  freshnessEl = document.createElement('span');
  freshnessEl.id = 'freshnessIndicator';
  freshnessEl.className = 'freshness-indicator';
  const topHealthEl = document.getElementById('topHealth');
  if (topHealthEl && topHealthEl.parentNode) {
    topHealthEl.parentNode.appendChild(freshnessEl);
  } else {
    document.body.appendChild(freshnessEl);
  }
}

let dataAgeSec = 0;
let lastSuccessfulData = null;
let isStale = false;

function updateFreshnessDisplay() {
  if (isStale || dataAgeSec > 6) {
    freshnessEl.textContent = 'DỮ LIỆU CŨ';
    freshnessEl.className = 'freshness-indicator stale';
    warningBanner.classList.add('visible');
  } else {
    const timestamp = new Date().toLocaleTimeString();
    freshnessEl.textContent = `Cập nhật lúc ${timestamp} (Tuổi dữ liệu: ${dataAgeSec}s)`;
    freshnessEl.className = 'freshness-indicator';
    warningBanner.classList.remove('visible');
  }
}

setInterval(() => {
  dataAgeSec++;
  if (dataAgeSec > 6 && !isStale) {
    isStale = true;
  }
  updateFreshnessDisplay();
}, 1000);

const codingTruth = d => d?.codingLane?.ok === true ? d.codingLane : null;
const statusCount = (jobs, status) => jobs.filter(j => j.status === status).length;

renderMetrics = function renderMetricsTruth(d) {
  const c = counts(d);
  const lane = codingTruth(d);
  const jobs = lane?.jobs || [];
  const objectives = lane?.objectives || [];
  const codingProblems = d?.codingLane && d.codingLane.ok !== true ? 1 : 0;
  const coreHealthVal = d?.core?.ok || d?.core?.pid ? 'ONLINE' : 'OFFLINE';
  const webHealthVal = 'ONLINE';
  const codingHealthVal = lane ? 'ONLINE' : 'OFFLINE';

  const rows = [
    ['Core', coreHealthVal, d.core?.pid ? `PID ${d.core.pid}` : 'Không có dữ liệu', coreHealthVal === 'ONLINE' ? '' : 'bad'],
    ['Web Control', webHealthVal, 'Read-only', ''],
    ['Coding Lane', codingHealthVal, lane ? `${lane.resources?.length || 0} AI resource` : 'Không kết nối', codingHealthVal === 'ONLINE' ? '' : 'bad'],
    ['NV hoạt động', `${c.active}/${c.resources}`, `${Math.round(c.active / Math.max(1, c.resources) * 100)}%`, ''],
    ['Đang bận', c.busy, c.busy ? 'Đang xử lý' : 'Không có việc', c.busy ? 'warn' : ''],
    ['Cảnh báo', c.problems + codingProblems, c.problems + codingProblems ? 'Cần chú ý' : 'Không có cảnh báo', c.problems + codingProblems ? 'bad' : ''],
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
  return `<div class="objective"><div class="objective-head"><div><strong>${esc(o.objective)}</strong><small>${esc(o.id)} · ${esc(o.priority)} · ${esc(o.status)}${owner}</small></div><small>${ago(o.updated_at)}</small></div>${o.summary ? `<small>${esc(o.summary)}</small>` : ''}<small>${truthNote}</small>${completed ? '<div class="progress"><i style="width:100%"></i></div>' : ''}</div>`;
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
['providerFilter','stateFilter','searchPeople'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener(id === 'searchPeople' ? 'input' : 'change', applyPeopleFullFilter);
});

const renderBase = typeof render !== 'undefined' ? render : function(){};
render = function renderTruth(d) {
  const h = document.getElementById('topHealth');
  if (h) {
    h.style.color = '';
    h.style.borderColor = '';
    h.style.background = '';
  }
  renderBase(d);
  applyPeopleFullFilter();
  const lane = codingTruth(d);
  const sysWebEl = document.getElementById('sysWeb');
  if (sysWebEl) {
    sysWebEl.textContent = lane ? `Web Control đọc Core + Coding Lane thật · Coding PID ${lane.pid ?? '—'}` : 'Web Control đọc Core thật · Coding Lane chưa kết nối';
  }
};

// Extended Polling Loop merging /api/status and /health
async function pollTruth() {
  try {
    const [statusRes, healthRes] = await Promise.all([
      fetch('/api/status'),
      fetch('/health')
    ]);
    if (!statusRes.ok || !healthRes.ok) {
      throw new Error(`HTTP error: status=${statusRes.status}, health=${healthRes.status}`);
    }
    const statusData = await statusRes.json();
    const healthData = await healthRes.json();

    const mergedTruth = {
      ...statusData,
      health: healthData,
      core: { ...(statusData.core || {}), ...(healthData.core || {}) },
      codingLane: statusData.codingLane
    };

    lastSuccessfulData = mergedTruth;
    dataAgeSec = 0;
    isStale = false;
    updateFreshnessDisplay();
    render(mergedTruth);
  } catch (err) {
    isStale = true;
    updateFreshnessDisplay();
    if (lastSuccessfulData) {
      render(lastSuccessfulData);
    }
  }
}

// Hook into existing poll if any, or run standalone interval
if (typeof window !== 'undefined') {
  setInterval(pollTruth, 5000);
}
