// Web Control truth guards. Loaded after the base dashboard script.
const compactStyle = document.createElement('style');
compactStyle.textContent = `
.workers{grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:5px;padding:6px}
.worker{padding:7px 8px}.worker .status{margin:4px 0}.kv{margin-top:2px}.resources-strip{gap:4px}
.grid-top,.stack{align-items:start}.stack{gap:8px}.pipeline{grid-template-columns:repeat(6,minmax(0,1fr));gap:5px}
.pipe{padding:9px 3px}.pipe strong{font-size:18px}.objective{padding:9px 10px}.event{padding:7px 9px}
@media(max-width:1024px){.workers{grid-template-columns:repeat(auto-fit,minmax(132px,1fr))}.pipeline{grid-template-columns:repeat(3,1fr)}}
@media(max-width:624px){.workers{grid-template-columns:repeat(2,minmax(0,1fr))}.pipeline{grid-template-columns:repeat(2,1fr)}}
@media(max-width:430px){.workers{grid-template-columns:1fr}}
`;
document.head.appendChild(compactStyle);

let latestWebHealth = null;

async function pollWebHealth() {
  try {
    const res = await fetch('/health', { cache: 'no-store' });
    if (res.ok) {
      latestWebHealth = await res.json();
    } else {
      latestWebHealth = { ok: false };
    }
  } catch (e) {
    latestWebHealth = { ok: false };
  }
}

pollWebHealth();
setInterval(pollWebHealth, 2000);

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
  const lastOkTime = typeof S !== 'undefined' && S.lastOk ? S.lastOk : null;
  if (!lastOkTime) {
    freshnessBadge.textContent = 'CHƯA CÓ DỮ LIỆU';
    freshnessBadge.style.background = 'rgba(255,0,0,0.2)';
    return;
  }
  const ageSec = Math.floor((Date.now() - lastOkTime) / 1000);
  const dateObj = new Date(lastOkTime);
  const timeStr = dateObj.toTimeString().split(' ')[0];
  if (ageSec > 6) {
    freshnessBadge.textContent = 'DỮ LIỆU CŨ';
    freshnessBadge.style.background = 'rgba(255,0,0,0.2)';
  } else {
    freshnessBadge.textContent = `Cập nhật lúc ${timeStr} · Tuổi dữ liệu ${ageSec}s`;
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

  const webOnline = latestWebHealth?.ok === true;
  const webStatusText = webOnline ? 'ONLINE' : (latestWebHealth === null ? 'ĐANG KIỂM TRA' : 'OFFLINE');
  const webStatusClass = webOnline ? '' : 'bad';

  const rows = [
    ['Core', d.core?.pid ? 'ONLINE' : '—', d.core?.pid ? `PID ${d.core.pid}` : 'Không có dữ liệu', d.core?.pid ? '' : 'bad'],
    ['Web Control', webStatusText, webOnline ? 'Read-only' : 'Health check failed', webStatusClass],
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
['providerFilter','stateFilter','searchPeople'].forEach(id => document.getElementById(id).addEventListener(id === 'searchPeople' ? 'input' : 'change', applyPeopleFullFilter));

const renderBase = render;
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