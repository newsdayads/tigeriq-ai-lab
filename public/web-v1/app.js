import { MockControllerClient, WorkforceControllerClient } from './controller-client.js';
import { MOCK_CONTROLLER_SNAPSHOT, MOCK_CONTROL_TOWER_PREVIEW } from './mock-data.js';
import { buildCompanyControlTowerViewModel, controlTowerTruthCheck, kpiHealthScore } from './company-control-tower-adapter.js';

const $ = id => document.getElementById(id);
const state = {
  mode: 'mock',
  client: new MockControllerClient(MOCK_CONTROLLER_SNAPSHOT),
  snapshot: null,
  viewModel: null,
  controllerError: null,
  owner: { configured: false, authenticated: false, identity: null, googleClientId: null },
};

const pageMeta = {
  overview: ['COMPANY CONTROL TOWER', 'Tổng quan công ty', 'Sếp nhìn mục tiêu, KPI, Mission, kết quả và ngoại lệ trước.'],
  goals: ['OWNER GOAL / KPI', 'Mục tiêu & KPI', 'Quản trị bằng mục tiêu và kết quả, không bằng số lượng task.'],
  missions: ['PLAN → ASSIGN → EXECUTE', 'Mission cấp công ty', 'Mission nối Goal/Signal với outcome; Job chỉ là runtime reference.'],
  organization: ['DEPARTMENT / AI EMPLOYEE', 'Phòng ban & nhân viên AI', 'Employee là vai trò và trách nhiệm; model/provider chỉ là năng lực.'],
  'owner-actions': ['EXCEPTION / OWNER ACTION', 'CẦN SẾP', 'Chỉ đưa lên Sếp các ngoại lệ quan trọng hoặc việc vượt quyền.'],
  outcomes: ['BUSINESS OUTCOME', 'Kết quả kinh doanh', 'Outcome phải cho biết tác động tới Goal/KPI khi có thể.'],
  processes: ['BUSINESS PROCESS', 'Sức khỏe quy trình', 'Theo dõi vòng Sense → Interpret → Plan → Authorize → Execute → Verify → Measure.'],
  technical: ['TECHNICAL OPERATIONS', 'Vận hành kỹ thuật', 'SHA/CI/lease/port, Controller, Job, provider và Prompt nằm ở đây.'],
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fmt = value => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString('vi-VN', { hour12: false });
};
const clamp = value => Math.max(0, Math.min(100, Number(value || 0)));
const statusClass = value => {
  const text = String(value || '').toLowerCase();
  if (/pass|completed|healthy|online|on_track|ready|active/.test(text)) return 'good';
  if (/fail|failed|error|offline|blocked|critical/.test(text)) return 'bad';
  if (/running|assigned|busy|in_progress/.test(text)) return 'blue';
  return 'warn';
};
const statusLabel = value => {
  const key = String(value || 'UNKNOWN').toUpperCase();
  const map = {
    PASS: 'Đạt', READY: 'Sẵn sàng', COMPLETED: 'Hoàn tất', RUNNING: 'Đang chạy', QUEUED: 'Đang chờ',
    PENDING: 'Chờ', BLOCKED: 'Bị chặn', FAILED: 'Lỗi', UNKNOWN: 'Chưa rõ', ON_TRACK: 'Đúng hướng',
    AT_RISK: 'Cần chú ý', NEEDS_OWNER: 'Cần Sếp', NO_SOURCE: 'Chưa có nguồn', PREVIEW_SAMPLE: 'Mẫu', BRANCH_ONLY: 'Branch',
    HEALTHY: 'Tốt', ONLINE: 'Online', OFFLINE: 'Offline', ACTIVE: 'Hoạt động', SUSPENDED: 'Tạm dừng',
  };
  return map[key] || key.replaceAll('_', ' ');
};
const badge = value => `<span class="status ${statusClass(value)}">${esc(statusLabel(value))}</span>`;
const mockChip = row => row?.isMock ? '<span class="chip mock-chip">MẪU</span>' : '';
const unavailable = text => `<div class="unavailable">${esc(text)}</div>`;

async function loadOwnerAuth() {
  try {
    const response = await fetch('/api/owner-auth?action=status', { cache: 'no-store', credentials: 'include' });
    if (!response.ok) throw new Error('OWNER_AUTH_UNAVAILABLE');
    state.owner = await response.json();
  } catch {
    state.owner = { configured: false, authenticated: false, identity: null, googleClientId: null, unavailable: true };
  }
  renderOwner();
}

function renderOwner() {
  const owner = state.owner;
  if (owner.authenticated && owner.identity) {
    $('ownerAccount').innerHTML = `${owner.identity.picture ? `<img class="owner-avatar" src="${esc(owner.identity.picture)}" alt="">` : '<span class="owner-avatar">S</span>'}<span>${esc(owner.identity.name || owner.identity.email)} · Sếp</span>`;
  } else {
    $('ownerAccount').innerHTML = '<span class="owner-avatar">S</span><span>Sếp</span>';
  }
}

async function ownerGoogleLogin() {
  if (!state.owner.configured || !state.owner.googleClientId) return showConnection({ ok: false, error: 'OWNER_AUTH_NOT_CONFIGURED' });
  if (!globalThis.google?.accounts?.id) return showConnection({ ok: false, error: 'GOOGLE_IDENTITY_SCRIPT_NOT_READY' });
  globalThis.google.accounts.id.initialize({
    client_id: state.owner.googleClientId,
    callback: async ({ credential }) => {
      const response = await fetch('/api/owner-auth?action=identity', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ credential }),
      });
      showConnection(await response.json().catch(() => ({})));
      await loadOwnerAuth();
    },
  });
  globalThis.google.accounts.id.prompt();
}

function emptySnapshot(reason) {
  return {
    schemaVersion: 'tigeriq.web-control.snapshot.v1',
    generatedAt: new Date().toISOString(),
    source: { mode: 'controller', authoritative: false, label: 'CONTROLLER UNAVAILABLE' },
    controller: { state: 'unavailable', contractState: reason || 'UNAVAILABLE', baseUrl: localStorage.getItem('tigeriq.controller.url') || null },
    company: { name: 'TigerIQ AI Lab', version: 'V2', truthPolicy: 'Không có dữ liệu live khi Controller lỗi.' },
    departments: [], jobs: [], employees: [], devices: [], providers: [], prompts: [], results: [], checks: [], activity: [], build: {}, leases: [],
  };
}

function buildViewModel() {
  const previewBusiness = state.mode === 'mock' ? MOCK_CONTROL_TOWER_PREVIEW : null;
  state.viewModel = controlTowerTruthCheck(buildCompanyControlTowerViewModel(state.snapshot || MOCK_CONTROLLER_SNAPSHOT, { previewBusiness }));
  return state.viewModel;
}

async function refresh() {
  $('refreshBtn').disabled = true;
  state.controllerError = null;
  try {
    state.snapshot = await state.client.snapshot();
  } catch (error) {
    state.controllerError = error;
    state.snapshot = state.mode === 'controller' ? emptySnapshot(error.message) : MOCK_CONTROLLER_SNAPSHOT;
  } finally {
    $('refreshBtn').disabled = false;
    buildViewModel();
    render();
  }
}

function renderTruth(vm) {
  const banner = $('modeBanner');
  const pill = $('sourcePill');
  if (state.mode === 'mock') {
    banner.className = 'truth-banner';
    banner.innerHTML = '<div><b>DỮ LIỆU MẪU · authoritative=false</b><span>Em đang dùng adapter/view-model tạm trong khi #146 chốt business contract. Không có dữ liệu live nào được suy diễn từ Job.</span></div><button class="text-btn" data-view-jump="technical">Xem nguồn dữ liệu →</button>';
    pill.innerHTML = '<span></span><b>MẪU · KHÔNG LIVE</b>';
  } else if (state.controllerError) {
    banner.className = 'truth-banner error';
    banner.innerHTML = `<div><b>CONTROLLER MẤT KẾT NỐI</b><span>${esc(state.controllerError.message)} · Em không dùng GitHub/Vercel hay mock để thay thế dữ liệu live.</span></div><button class="text-btn" data-view-jump="technical">Kiểm tra kết nối →</button>`;
    pill.innerHTML = '<span></span><b>CONTROLLER OFFLINE</b>';
  } else if (!vm.source.businessAvailable) {
    banner.className = 'truth-banner controller';
    banner.innerHTML = '<div><b>RUNTIME LIVE · BUSINESS CONTRACT CHƯA MAP</b><span>Controller có dữ liệu runtime authoritative, nhưng #146 chưa cung cấp business-state projection nên Goal/KPI/Mission không được tự suy diễn.</span></div><button class="text-btn" data-view-jump="technical">Xem runtime →</button>';
    pill.innerHTML = '<span></span><b>RUNTIME LIVE</b>';
  } else {
    banner.className = 'truth-banner controller';
    banner.innerHTML = `<div><b>COMPANY DATA LIVE</b><span>${esc(vm.source.label)} · cập nhật ${fmt(vm.generatedAt)}</span></div>`;
    pill.innerHTML = '<span></span><b>AUTHORITATIVE</b>';
  }
}

function primaryGoal(vm) { return vm.goals[0] || null; }
function goalKpis(vm, goal) { return goal ? vm.kpis.filter(kpi => !goal.kpiIds?.length || goal.kpiIds.includes(kpi.kpiId)) : vm.kpis; }

function renderOverview(vm) {
  const goal = primaryGoal(vm);
  const kpis = goalKpis(vm, goal).slice(0, 4);
  const health = kpiHealthScore(kpis);
  $('primaryGoalTitle').textContent = goal?.title || (vm.source.businessAvailable ? 'Chưa có mục tiêu ưu tiên' : 'Chưa có business contract authoritative');
  $('primaryGoalObjective').textContent = goal?.objective || 'Em không suy diễn Goal/KPI từ Job runtime khi #146 chưa map dữ liệu.';
  $('primaryGoalMeta').innerHTML = goal ? `${mockChip(goal)}<span>${esc(goal.priority || '—')}</span><span>${esc(statusLabel(goal.status))}</span><span>Hạn ${fmt(goal.deadline)}</span>` : '<span>Contract #146 pending</span>';
  const goalProgress = health ?? clamp(goal?.progressPct || 0);
  $('goalProgressRing').style.setProperty('--progress', goalProgress);
  $('goalProgress').textContent = health === null ? '—' : `${goalProgress}%`;

  $('homeKpis').innerHTML = kpis.length ? kpis.map(kpi => `<article class="kpi-card"><div class="kpi-card-head"><span>${esc(kpi.name)}</span>${badge(kpi.state)}</div><strong>${kpi.currentValue ?? '—'}${kpi.unit === '%' ? '%' : ''}</strong><small>Mục tiêu ${kpi.target ?? '—'} ${kpi.unit && kpi.unit !== '%' ? esc(kpi.unit) : ''}</small><div class="kpi-line"><i style="width:${clamp(kpi.healthPct)}%"></i></div><div class="chip-row">${mockChip(kpi)}</div></article>`).join('') : unavailable('Chưa có KPI authoritative.');

  const performance = vm.performance || {};
  $('businessDataState').textContent = performance.availability === 'available' ? 'CÓ NGUỒN' : 'CHƯA CÓ NGUỒN';
  $('businessMetrics').innerHTML = performance.metrics?.length ? performance.metrics.map(metric => `<div class="business-metric"><span>${esc(metric.label)}</span><strong>${metric.value ?? '—'}${metric.value !== null && metric.unit ? ` ${esc(metric.unit)}` : ''}</strong><small>${esc(statusLabel(metric.state))}</small>${mockChip(metric)}</div>`).join('') : unavailable('Chưa có doanh thu/chi phí/outcome authoritative.');
  $('businessDataNote').textContent = performance.note || '—';

  $('homeOwnerActions').innerHTML = vm.ownerActions.length ? vm.ownerActions.slice(0, 2).map(action => `<div class="owner-action-mini"><div class="row-top"><b>${esc(action.title)}</b>${badge(action.status)}</div><p>${esc(action.decisionNeeded || action.issue)}</p><div class="chip-row">${mockChip(action)}<span class="chip">${esc(action.severity || '—')}</span></div></div>`).join('') : '<div class="empty">Không có ngoại lệ cần Sếp.</div>';

  $('homeMissions').innerHTML = vm.missions.length ? vm.missions.slice(0, 3).map(mission => `<div class="mission-row"><div class="row-top"><b>${esc(mission.title)}</b>${badge(mission.status)}</div><p>${esc(mission.expectedOutcome)}</p><div class="progress-track"><i style="width:${clamp(mission.progressPct)}%"></i></div><div class="chip-row">${mockChip(mission)}<span class="chip">${mission.progressPct ?? 0}%</span><span class="chip">${esc(mission.riskLevel || '—')}</span></div></div>`).join('') : unavailable('Chưa có Mission authoritative.');

  const activeEmployees = vm.employees.filter(row => String(row.availability || '').toLowerCase() === 'online' || String(row.availability || '').toLowerCase() === 'idle' || String(row.availability || '').toLowerCase() === 'busy').length;
  $('homeOrganization').innerHTML = `<div class="org-row"><div class="row-top"><b>${vm.departments.length} phòng ban</b><span class="chip">${vm.employees.length} AI Employee</span></div><p>${activeEmployees ? `${activeEmployees} có trạng thái hoạt động từ nguồn hiện tại.` : 'Chưa có heartbeat live; trạng thái nhân viên không được giả online.'}</p></div>`;

  $('homeOutcomes').innerHTML = vm.outcomes.length ? vm.outcomes.slice(0, 3).map(outcome => `<div class="outcome-row"><div class="row-top"><b>${esc(outcome.title)}</b><span class="chip">${fmt(outcome.completedAt)}</span></div><p>${esc(outcome.summary)}</p><div class="chip-row">${mockChip(outcome)}${(outcome.kpiEffects || []).slice(0, 2).map(effect => `<span class="chip">${esc(effect.delta)}</span>`).join('')}</div></div>`).join('') : unavailable('Chưa có Business Outcome authoritative.');

  $('homeProcesses').innerHTML = vm.processes.length ? vm.processes.slice(0, 3).map(process => `<div class="process-health-row"><div class="row-top"><b>${esc(process.name)}</b>${badge(process.health || process.status)}</div><p>${(process.steps || []).filter(step => ['RUNNING','PENDING','BLOCKED'].includes(String(step.state || '').toUpperCase())).slice(0, 2).map(step => `${step.label}: ${statusLabel(step.state)}`).join(' · ') || 'Không có bước cần chú ý.'}</p><div class="chip-row">${mockChip(process)}<span class="chip">${process.exceptionCount ?? 0} ngoại lệ</span></div></div>`).join('') : unavailable('Chưa có Business Process authoritative.');

  $('runtimeSummary').innerHTML = vm.runtimeSummary.map(row => `<span class="runtime-pill"><b>${esc(row.label)}:</b>&nbsp;${esc(row.value)}</span>`).join('');
}

function renderGoals(vm) {
  $('goalGrid').innerHTML = vm.goals.length ? vm.goals.map(goal => {
    const rows = goalKpis(vm, goal);
    return `<article class="goal-card"><div class="row-top"><div><div class="job-id">${esc(goal.goalId)}</div><h4>${esc(goal.title)}</h4></div>${badge(goal.status)}</div><p>${esc(goal.objective)}</p><div class="metric-grid"><div class="metric-box"><span>Ưu tiên</span><b>${esc(goal.priority || '—')}</b></div><div class="metric-box"><span>Tiến độ</span><b>${goal.progressPct ?? '—'}%</b></div><div class="metric-box"><span>KPI</span><b>${rows.length}</b></div></div><div class="chip-row">${mockChip(goal)}${(goal.constraints || []).slice(0, 2).map(item => `<span class="chip">${esc(item)}</span>`).join('')}</div>${rows.map(kpi => `<div class="prompt-version"><div class="row-top"><b>${esc(kpi.name)}</b>${badge(kpi.state)}</div><p>${kpi.currentValue ?? '—'} ${esc(kpi.unit || '')} / target ${kpi.target ?? '—'}</p></div>`).join('')}</article>`;
  }).join('') : unavailable('Business contract chưa trả Goal/KPI.');
}

function renderMissions(vm) {
  $('missionBoard').innerHTML = vm.missions.length ? vm.missions.map(mission => `<article class="mission-card"><div class="row-top"><div><div class="job-id">${esc(mission.missionId)}</div><h4>${esc(mission.title)}</h4></div>${badge(mission.status)}</div><p>${esc(mission.expectedOutcome)}</p><div class="progress-track"><i style="width:${clamp(mission.progressPct)}%"></i></div><div class="metric-grid"><div class="metric-box"><span>Tiến độ</span><b>${mission.progressPct ?? '—'}%</b></div><div class="metric-box"><span>Risk</span><b>${esc(mission.riskLevel || '—')}</b></div><div class="metric-box"><span>Job refs</span><b>${mission.jobRefs?.length ?? 0}</b></div></div><div class="chip-row">${mockChip(mission)}${(mission.departments || []).map(dep => `<span class="chip">${esc(dep)}</span>`).join('')}</div><p><b>Authority:</b> ${esc(mission.autonomyEnvelope || '—')}</p></article>`).join('') : unavailable('Chưa có Mission authoritative.');
}

function renderOrganization(vm) {
  $('departmentGrid').innerHTML = vm.departments.length ? vm.departments.map(dep => `<article class="department-card"><div class="department-top"><div class="department-icon">${esc(dep.icon || '•')}</div>${badge(dep.health)}</div><h4 style="margin-top:8px">${esc(dep.name)}</h4><p>${esc(dep.purpose)}</p><div class="chip-row">${mockChip(dep)}<span class="chip">${dep.employeeCount ?? 0} nhân viên</span><span class="chip">${dep.activeJobs ?? 0} job runtime</span></div></article>`).join('') : '<div class="empty">Chưa có phòng ban.</div>';
  $('employeeGrid').innerHTML = vm.employees.length ? vm.employees.map(emp => `<article class="employee-card"><div class="employee-top"><div class="avatar-box">${esc((emp.displayName || 'AI').split(' ').slice(-1)[0].slice(0,2).toUpperCase())}</div>${badge(emp.availability)}</div><h4 style="margin-top:8px">${esc(emp.displayName)}</h4><div class="employee-role">${esc(emp.role || '—')} · ${esc(emp.department || '—')}</div><span class="autonomy-badge">${esc(emp.autonomyLevel || 'Autonomy chưa map')}</span><p>Quản lý: <b>${esc(emp.supervisor || '—')}</b></p><p>AI kỹ thuật: ${esc(emp.provider || '—')} / ${esc(emp.model || '—')}</p><div class="chip-row">${mockChip(emp)}${(emp.capabilities || []).slice(0,3).map(item => `<span class="chip">${esc(item)}</span>`).join('')}</div></article>`).join('') : '<div class="empty">Chưa có AI Employee.</div>';
}

function renderOwnerActions(vm) {
  $('ownerActionBoard').innerHTML = vm.ownerActions.length ? vm.ownerActions.map(action => `<article class="owner-action-card"><div class="row-top"><div><div class="job-id">${esc(action.exceptionId)}</div><h4>${esc(action.title)}</h4></div>${badge(action.status)}</div><p><b>Vấn đề:</b> ${esc(action.issue)}</p><p><b>Ảnh hưởng:</b> ${esc(action.impact)}</p><p><b>Em/hệ thống đã làm:</b> ${esc(action.attempted)}</p><p><b>Đề xuất:</b> ${esc(action.recommendation)}</p><div class="decision-box"><span>SẾP CẦN QUYẾT ĐỊNH</span><b>${esc(action.decisionNeeded)}</b></div><div class="chip-row">${mockChip(action)}<span class="chip">${esc(action.severity || '—')}</span><span class="chip">Goal ${esc(action.goalId || '—')}</span></div></article>`).join('') : '<div class="empty">Hiện không có ngoại lệ cần Sếp.</div>';
}

function renderOutcomes(vm) {
  $('outcomeBoard').innerHTML = vm.outcomes.length ? vm.outcomes.map(outcome => `<article class="outcome-card"><div class="row-top"><div><div class="job-id">${esc(outcome.outcomeId)}</div><h4>${esc(outcome.title)}</h4></div><span class="chip">${fmt(outcome.completedAt)}</span></div><p>${esc(outcome.summary)}</p><div class="chip-row">${mockChip(outcome)}<span class="chip">Mission ${esc(outcome.missionId || '—')}</span>${(outcome.kpiEffects || []).map(effect => `<span class="chip">${esc(effect.delta)}</span>`).join('')}</div><p><b>Evidence:</b> ${esc(statusLabel(outcome.evidenceState))}</p></article>`).join('') : unavailable('Chưa có Business Outcome authoritative.');
}

function renderProcesses(vm) {
  $('processBoard').innerHTML = vm.processes.length ? vm.processes.map(process => `<article class="process-card"><div class="row-top"><div><div class="job-id">${esc(process.processId)}</div><h4>${esc(process.name)}</h4></div>${badge(process.health || process.status)}</div><p>Trigger: ${esc(process.trigger || '—')}</p><div class="process-steps">${(process.steps || []).map(step => `<span class="process-step ${statusClass(step.state)}">${esc(step.label)} · ${esc(statusLabel(step.state))}</span>`).join('')}</div><div class="chip-row">${mockChip(process)}<span class="chip">${process.exceptionCount ?? 0} ngoại lệ</span></div></article>`).join('') : unavailable('Chưa có Business Process authoritative.');
}

function renderTechnical(vm) {
  const tech = vm.technical;
  const build = tech.build || {};
  $('buildFacts').innerHTML = [
    ['Commit SHA', build.sha || 'Chưa có runtime/preview metadata trong snapshot'],
    ['CI', build.ci || 'unknown'],
    ['Preview', build.preview || 'unknown'],
    ['Ghi chú', 'GitHub/Vercel là bằng chứng kỹ thuật, không phải business state'],
  ].map(([label,value]) => `<div class="technical-fact"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');

  const controller = tech.controller || {};
  $('runtimeFacts').innerHTML = [
    ['Controller', controller.state || 'unknown'],
    ['Tailscale', controller.tailscale || 'unknown'],
    ['Database', controller.database || 'unknown'],
    ['Contract', controller.contractState || 'unknown'],
  ].map(([label,value]) => `<div class="technical-fact"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');

  $('deviceTechnical').innerHTML = tech.devices.length ? tech.devices.map(device => `<article class="device-card"><div class="row-top"><div><div class="job-id">${esc(device.nodeId)}</div><h4>${esc(device.displayName || device.platform)}</h4></div>${badge(device.status)}</div><div class="metric-grid"><div class="metric-box"><span>Port</span><b>${device.controllerPort ?? '—'}</b></div><div class="metric-box"><span>Lease</span><b>${esc(device.leaseState || 'unknown')}</b></div><div class="metric-box"><span>Heartbeat</span><b>${fmt(device.lastHeartbeatAt)}</b></div></div><div class="chip-row">${mockChip(device)}<span class="chip">Tailscale ${esc(device.tailscaleIp || '—')}</span></div></article>`).join('') : '<div class="empty">Chưa có thiết bị.</div>';

  $('jobBoard').innerHTML = tech.jobs.length ? tech.jobs.map(job => `<article class="job-card"><div class="job-top"><div><div class="job-id">${esc(job.jobId)}</div><h4>${esc(job.objective)}</h4></div>${badge(job.stage)}</div><p>${esc(job.department || '—')} · ${esc(job.assignedEmployeeId || '—')}</p><div class="progress-track"><i style="width:${clamp(job.progress)}%"></i></div><div class="metric-grid"><div class="metric-box"><span>Tiến độ</span><b>${job.progress ?? 0}%</b></div><div class="metric-box"><span>Attempts</span><b>${job.attempts ?? 0}/${job.maxAttempts ?? 0}</b></div><div class="metric-box"><span>Blocker</span><b>${esc(job.blocker?.code || '—')}</b></div></div><div class="chip-row">${mockChip(job)}</div>${job.blocker ? `<p>${esc(job.blocker.message)}</p><button class="secondary-btn retry-btn" data-job="${esc(job.jobId)}">Gửi retry intent</button>` : ''}</article>`).join('') : '<div class="empty">Chưa có Job runtime.</div>';

  $('providerGrid').innerHTML = tech.providers.length ? tech.providers.map(provider => `<article class="provider-card"><div class="provider-top"><div><div class="job-id">${esc(provider.providerId)}</div><h4>${esc(provider.displayName)}</h4></div>${badge(provider.health)}</div><p>${esc(provider.role || '—')}</p><div class="metric-grid"><div class="metric-box"><span>Credential</span><b>${esc(provider.credentialPresent || '—')}</b></div><div class="metric-box"><span>Billing</span><b>${esc(provider.billingMode || '—')}</b></div><div class="metric-box"><span>Latency</span><b>${provider.latencyP50Ms ?? '—'} ms</b></div></div><div class="chip-row">${mockChip(provider)}${(provider.models || []).map(model => `<span class="chip">${esc(model)}</span>`).join('')}</div></article>`).join('') : '<div class="empty">Chưa có provider.</div>';

  $('promptGrid').innerHTML = tech.prompts.length ? tech.prompts.map(prompt => `<article class="prompt-card"><div class="row-top"><div><div class="job-id">${esc(prompt.promptId)}</div><h4>${esc(prompt.name)}</h4></div><span class="chip">${esc(prompt.activeVersion || '—')}</span></div><p>${esc(prompt.purpose)}</p>${(prompt.versions || []).map(version => `<div class="prompt-version"><div class="row-top"><b>${esc(version.version)}</b>${badge(version.status)}</div><p>${esc(version.content)}</p><div class="chip-row"><span class="chip">runs ${version.metrics?.runs ?? 0}</span><span class="chip">PASS ${version.metrics?.pass ?? 0}</span><span class="chip">FAIL ${version.metrics?.fail ?? 0}</span></div></div>`).join('')}</article>`).join('') : '<div class="empty">Chưa có Prompt.</div>';

  $('technicalResults').innerHTML = tech.results.length ? tech.results.map(result => `<article class="result-card"><div class="result-top"><div><div class="job-id">${esc(result.jobId)} · ${esc(result.resultId)}</div><h4>${esc(result.conclusion || '—')}</h4></div>${badge(result.status)}</div><p>AI: ${esc(result.provider || '—')} / ${esc(result.model || '—')}</p><div class="metric-grid"><div class="metric-box"><span>Evidence</span><b>${esc(statusLabel(result.evidence?.state))}</b></div><div class="metric-box"><span>Review</span><b>${esc(statusLabel(result.review?.state))}</b></div><div class="metric-box"><span>Judge</span><b>${esc(statusLabel(result.judge?.state))}</b></div></div><div class="chip-row">${mockChip(result)}</div></article>`).join('') : '<div class="empty">Chưa có Result kỹ thuật.</div>';

  document.querySelectorAll('.retry-btn').forEach(button => { button.onclick = () => retryJob(button.dataset.job); });
}

function render() {
  const vm = state.viewModel || buildViewModel();
  renderTruth(vm);
  renderOverview(vm);
  renderGoals(vm);
  renderMissions(vm);
  renderOrganization(vm);
  renderOwnerActions(vm);
  renderOutcomes(vm);
  renderProcesses(vm);
  renderTechnical(vm);
  $('goalModeNote').textContent = state.mode === 'mock'
    ? 'Mẫu: em chỉ tạo draft phản hồi; không dispatch Job thật.'
    : 'Controller mode: Web gửi Owner intent; Work Management mới được quyền chia việc.';
  bindJumpButtons();
}

function showConnection(value) { $('connectionResult').textContent = JSON.stringify(value, null, 2); }

async function connectController() {
  try {
    const client = new WorkforceControllerClient({ baseUrl: $('controllerUrl').value.trim(), accessToken: $('controllerToken').value });
    state.client = client;
    state.mode = 'controller';
    sessionStorage.setItem('tigeriq.controller.token', $('controllerToken').value);
    localStorage.setItem('tigeriq.controller.url', client.baseUrl);
    showConnection({ ok: true, mode: 'controller', baseUrl: client.baseUrl, note: 'Business fields chỉ hiển thị khi #146 contract có dữ liệu; Web không suy diễn từ Job.' });
    await refresh();
  } catch (error) {
    showConnection({ ok: false, error: error.message, hint: error.hint || null });
  }
}

async function probeController() {
  try {
    const client = new WorkforceControllerClient({ baseUrl: $('controllerUrl').value.trim(), accessToken: $('controllerToken').value });
    showConnection(await client.health());
  } catch (error) {
    showConnection({ ok: false, error: error.message, hint: error.hint || null });
  }
}

async function useMock() {
  state.client = new MockControllerClient(MOCK_CONTROLLER_SNAPSHOT);
  state.mode = 'mock';
  state.controllerError = null;
  showConnection({ ok: true, mode: 'mock', authoritative: false, businessPreview: true });
  await refresh();
}

async function submitGoal(event) {
  event.preventDefault();
  const goal = {
    objective: $('goalObjective').value.trim(),
    priority: $('goalPriority').value,
    deadline: $('goalDeadline').value ? new Date($('goalDeadline').value).toISOString() : null,
    constraints: $('goalConstraints').value.split('\n').map(item => item.trim()).filter(Boolean),
    expectedEvidence: $('goalEvidence').value.split('\n').map(item => item.trim()).filter(Boolean),
    requestedBy: 'owner-company-control-tower',
  };
  const out = $('goalResult');
  out.hidden = false;
  try {
    out.textContent = JSON.stringify(await state.client.submitGoal(goal), null, 2);
    if (state.mode === 'controller') await refresh();
  } catch (error) {
    out.textContent = JSON.stringify({ ok: false, error: error.message }, null, 2);
  }
}

async function retryJob(jobId) {
  try {
    showConnection(await state.client.retryJob(jobId, 'owner_web_retry_intent'));
    if (state.mode === 'controller') await refresh();
  } catch (error) {
    showConnection({ ok: false, error: error.message, jobId });
  }
}

function switchView(view) {
  const meta = pageMeta[view] || pageMeta.overview;
  document.querySelectorAll('.nav button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.dataset.section === view));
  $('pageEyebrow').textContent = meta[0];
  $('pageTitle').textContent = meta[1];
  $('pageSubtitle').textContent = meta[2];
  history.replaceState(null, '', `#${view}`);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function bindJumpButtons() {
  document.querySelectorAll('[data-view-jump]').forEach(button => { button.onclick = () => switchView(button.dataset.viewJump); });
}

document.querySelectorAll('.nav button').forEach(button => { button.onclick = () => switchView(button.dataset.view); });
$('refreshBtn').onclick = refresh;
$('connectBtn').onclick = connectController;
$('probeBtn').onclick = probeController;
$('mockBtn').onclick = useMock;
$('ownerLoginBtn').onclick = ownerGoogleLogin;
$('goalForm').onsubmit = submitGoal;
$('controllerUrl').value = localStorage.getItem('tigeriq.controller.url') || '';
$('controllerToken').value = sessionStorage.getItem('tigeriq.controller.token') || '';
switchView(location.hash.slice(1) in pageMeta ? location.hash.slice(1) : 'overview');
await Promise.all([loadOwnerAuth(), refresh()]);
