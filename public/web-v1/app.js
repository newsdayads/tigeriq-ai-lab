import { MockControllerClient, WorkforceControllerClient } from './controller-client.js';
import { MOCK_CONTROLLER_SNAPSHOT } from './mock-data.js';

const $ = (id) => document.getElementById(id);
const state = {
  mode: 'mock',
  client: new MockControllerClient(MOCK_CONTROLLER_SNAPSHOT),
  snapshot: null,
  controllerError: null,
  owner: { configured: false, authenticated: false, identity: null, googleClientId: null },
};

const pageMeta = {
  overview: ['Tổng quan công ty', 'PC01/Controller là nguồn trạng thái; Web chỉ trình bày.'],
  goal: ['Giao mục tiêu', 'Gửi intent cho Controller; Web không tự decomposition/scheduling.'],
  jobs: ['Jobs / Queue', 'Trạng thái thật phải đến từ Controller/PostgreSQL.'],
  employees: ['Employees / Devices', 'Heartbeat và capability do Controller cung cấp.'],
  providers: ['AI Providers', 'Quota/health chỉ hiển thị khi Controller có bằng chứng.'],
  prompts: ['Prompt Architect', 'Prompt library/version/PASS-FAIL metrics theo Controller contract.'],
  evidence: ['Result / Evidence / Review / Judge', 'Không suy DONE từ UI hoặc GitHub.'],
  recovery: ['Blocker / Retry / Recovery', 'Retry policy thuộc orchestration; Web chỉ gửi intent.'],
  activity: ['Lịch sử hoạt động', 'Audit trail do Controller cung cấp.'],
  settings: ['Kết nối', 'PC01 → Tailscale → Workforce Controller.'],
};

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString('vi-VN'); }
function pct(value) { return Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—'; }
function statusClass(value) { const v=String(value||'').toLowerCase(); if(/completed|online|idle|pass|healthy|ready/.test(v))return'good'; if(/failed|offline|fail|error/.test(v))return'bad'; if(/running|assigned|busy/.test(v))return'blue'; return'warn'; }
function badge(value) { return `<span class="status ${statusClass(value)}">${esc(value || 'UNKNOWN')}</span>`; }
function mockMark(row) { return row?.isMock ? '<span class="chip">MOCK</span>' : ''; }

async function loadOwnerAuth() {
  try {
    const res = await fetch('/api/owner-auth?action=status', { cache:'no-store', credentials:'include' });
    if (!res.ok) throw new Error('owner_auth_unavailable');
    const data = await res.json();
    state.owner = data;
  } catch {
    state.owner = { configured:false, authenticated:false, identity:null, googleClientId:null, unavailable:true };
  }
  renderOwner();
}

function renderOwner() {
  const box = $('ownerAccount');
  const owner = state.owner;
  if (owner.authenticated && owner.identity) {
    box.innerHTML = `${owner.identity.picture ? `<img class="avatar" src="${esc(owner.identity.picture)}" alt="">` : '<span class="avatar"></span>'}<span>${esc(owner.identity.name || owner.identity.email)} · Owner</span>`;
  } else {
    box.innerHTML = `<span class="avatar"></span><span>${owner.unavailable ? 'Owner UI auth unavailable' : owner.configured ? 'Owner chưa đăng nhập' : 'Owner auth chưa cấu hình'}</span>`;
  }
}

async function ownerGoogleLogin() {
  if (!state.owner.configured || !state.owner.googleClientId) return showConnection({ ok:false, error:'OWNER_AUTH_NOT_CONFIGURED' });
  if (!globalThis.google?.accounts?.id) return showConnection({ ok:false, error:'GOOGLE_IDENTITY_SCRIPT_NOT_READY' });
  globalThis.google.accounts.id.initialize({
    client_id: state.owner.googleClientId,
    callback: async ({ credential }) => {
      const res = await fetch('/api/owner-auth?action=identity', { method:'POST', headers:{'content-type':'application/json'}, credentials:'include', body:JSON.stringify({credential}) });
      const data = await res.json().catch(()=>({}));
      showConnection(data);
      await loadOwnerAuth();
    },
  });
  globalThis.google.accounts.id.prompt();
}

function emptySnapshot(reason) {
  return {
    schemaVersion:'tigeriq.web-control.snapshot.v1', generatedAt:new Date().toISOString(),
    source:{mode:'controller',authoritative:false,label:'CONTROLLER UNAVAILABLE'},
    controller:{state:'unavailable',contractState:reason||'UNAVAILABLE',baseUrl:localStorage.getItem('tigeriq.controller.url')||null},
    company:{name:'TigerIQ AI Lab',phase:'V1',currentObjective:'—',truthPolicy:'No runtime data available.',workforceSummary:{}},
    jobs:[],employees:[],devices:[],providers:[],prompts:[],results:[],activity:[],
  };
}

async function refresh() {
  $('refreshBtn').disabled = true;
  state.controllerError = null;
  try { state.snapshot = await state.client.snapshot(); }
  catch (error) {
    state.controllerError = error;
    state.snapshot = state.mode === 'controller' ? emptySnapshot(error.message) : MOCK_CONTROLLER_SNAPSHOT;
  } finally { $('refreshBtn').disabled = false; render(); }
}

function renderModeBanner() {
  const banner = $('modeBanner');
  if (state.mode === 'mock') {
    banner.className='mode-banner';
    banner.innerHTML='<strong>MOCK MODE</strong><span>Toàn bộ dữ liệu dưới đây là mẫu schema. Không có RUNNING/DONE thật và không có lệnh gửi PC01.</span>';
  } else if (state.controllerError) {
    banner.className='mode-banner error';
    banner.innerHTML=`<strong>CONTROLLER DISCONNECTED</strong><span>${esc(state.controllerError.message)} · UI không fallback sang GitHub/Vercel.</span>`;
  } else {
    banner.className='mode-banner controller';
    banner.innerHTML=`<strong>CONTROLLER LIVE</strong><span>${esc(state.snapshot?.source?.label || 'Workforce Controller authoritative snapshot')} · ${fmt(state.snapshot?.generatedAt)}</span>`;
  }
}

function renderOverview(s) {
  const jobs=s.jobs||[], employees=s.employees||[];
  const active=jobs.filter(j=>['QUEUED','ASSIGNED','RUNNING','WAITING_REVIEW','WAITING_JUDGE'].includes(String(j.stage||'').toUpperCase())).length;
  const available=employees.filter(e=>['idle','busy'].includes(String(e.availability).toLowerCase()) && e.lastHeartbeatAt).length;
  $('controllerState').textContent = state.mode==='mock'?'MOCK':state.controllerError?'OFFLINE':String(s.controller?.state||'CONNECTED').toUpperCase();
  $('controllerState').className=`metric ${state.mode==='mock'||state.controllerError?'warn':'good'}`;
  $('controllerSub').textContent = s.controller?.baseUrl || s.source?.label || '—';
  $('activeJobs').textContent=String(active); $('availableEmployees').textContent=String(available);
  $('objective').textContent=s.company?.currentObjective||'—'; $('objectivePolicy').textContent=s.company?.truthPolicy||'—';
  const checks=Array.isArray(s.company?.readiness)?s.company.readiness:[];
  $('readiness').innerHTML=checks.length?checks.map(row=>`<span class="status ${statusClass(row.state)}">${esc(row.label||row.key)}: ${esc(row.state||'UNKNOWN')}</span>`).join(''):'<span class="status warn">CONTRACT_PENDING</span>';
  $('readinessNote').textContent=state.mode==='mock'?'Mock không phải PASS. Ngày mai chỉ Controller runtime được quyền chuyển các gate sang PASS.':checks.length?'Readiness phản ánh nguyên trạng snapshot Controller.':'Controller chưa cung cấp readiness trong snapshot.';
  $('overviewJobs').innerHTML=jobs.length?jobs.slice(0,5).map(renderJobItem).join(''):'<div class="empty">Controller chưa trả Jobs.</div>';
}

function renderJobItem(j){return `<div class="item"><div class="item-head"><div><div class="item-title mono">${esc(j.jobId)}</div><p>${esc(j.objective)}</p></div>${badge(j.stage)}</div><div class="chips">${mockMark(j)}<span class="chip">${esc(j.priority)}</span><span class="chip">attempt ${esc(j.attempts)}/${esc(j.maxAttempts)}</span>${j.assignedEmployeeId?`<span class="chip">${esc(j.assignedEmployeeId)}</span>`:''}</div></div>`}

function renderJobs(s){$('jobsTable').innerHTML=(s.jobs||[]).map(j=>`<tr><td class="mono">${esc(j.jobId)} ${mockMark(j)}</td><td>${badge(j.stage)}</td><td>${esc(j.objective)}</td><td>${esc(j.assignedEmployeeId||'—')}</td><td>${esc(j.attempts)}/${esc(j.maxAttempts)}</td><td>${j.blocker?`<span class="bad">${esc(j.blocker.code)}</span><br>${esc(j.blocker.message)}`:'—'}</td><td>${fmt(j.updatedAt)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">Không có Jobs từ Controller.</td></tr>'}

function renderEmployees(s){$('employeesList').innerHTML=(s.employees||[]).map(e=>`<div class="item"><div class="item-head"><div><div class="item-title">${esc(e.displayName)}</div><p class="mono">${esc(e.employeeId)} · ${esc(e.nodeId)}</p></div>${badge(e.availability)}</div><div class="chips">${mockMark(e)}<span class="chip">${esc(e.department)}</span><span class="chip">${esc(e.role)}</span><span class="chip">health ${e.healthScore??'—'}</span></div><p>Provider: ${esc(e.provider||'—')} · Model: ${esc(e.model||'—')} · Heartbeat: ${fmt(e.lastHeartbeatAt)}</p></div>`).join('')||'<div class="empty">Không có employee data.</div>';
$('devicesList').innerHTML=(s.devices||[]).map(d=>`<div class="item"><div class="item-head"><div><div class="item-title mono">${esc(d.nodeId)}</div><p>${esc(d.platform)} · ${esc(d.kind)}</p></div>${badge(d.status)}</div><div class="chips">${mockMark(d)}<span class="chip">IP ${esc(d.tailscaleIp||'—')}</span><span class="chip">port ${esc(d.controllerPort||'—')}</span><span class="chip">agent ${esc(d.agentVersion||'—')}</span></div><p>Heartbeat: ${fmt(d.lastHeartbeatAt)} · Battery: ${d.batteryPct??'—'} · Temp: ${d.temperatureC??'—'}</p></div>`).join('')||'<div class="empty">Không có node/device data.</div>'}

function renderProviders(s){$('providersGrid').innerHTML=(s.providers||[]).map(p=>`<article class="card span6"><div class="item-head"><div><h2>${esc(p.displayName)}</h2><div class="item-title mono">${esc(p.providerId)}</div></div>${badge(p.health)}</div><div class="rows"><p>Billing: ${esc(p.billingMode||'—')} · Credential: ${esc(p.credentialPresent||'—')}</p><p>Quota remaining: ${esc(p.quota?.remaining??'—')} / ${esc(p.quota?.limit??'—')} · reset ${fmt(p.quota?.resetsAt)}</p><p>Success: ${pct(p.successRate)} · p50: ${p.latencyP50Ms??'—'} ms · check ${fmt(p.lastCheckedAt)}</p></div><div class="chips">${mockMark(p)}${(p.models||[]).map(m=>`<span class="chip">${esc(m)}</span>`).join('')}</div></article>`).join('')||'<article class="card wide"><div class="empty">Controller chưa trả provider health/quota.</div></article>'}

function renderPrompts(s){$('promptList').innerHTML=(s.prompts||[]).map(p=>`<div class="item"><div class="item-head"><div><div class="item-title">${esc(p.name)}</div><p class="mono">${esc(p.promptId)} · active ${esc(p.activeVersion)}</p></div>${mockMark(p)}</div><p>${esc(p.purpose)}</p>${(p.versions||[]).map(v=>`<div class="callout" style="margin-top:8px"><div class="item-head"><b>${esc(v.version)}</b>${badge(v.status)}</div><p>${esc(v.content)}</p><div class="chips"><span class="chip">runs ${v.metrics?.runs??0}</span><span class="chip">PASS ${v.metrics?.pass??0}</span><span class="chip">FAIL ${v.metrics?.fail??0}</span><span class="chip">rate ${pct(v.metrics?.passRate)}</span></div></div>`).join('')}</div>`).join('')||'<div class="empty">Chưa có Prompt library từ Controller.</div>'}

function renderResults(s){$('resultsList').innerHTML=(s.results||[]).map(r=>`<div class="item"><div class="item-head"><div><div class="item-title mono">${esc(r.jobId)} · ${esc(r.resultId)}</div><p>${esc(r.conclusion||'Chưa có result')}</p></div>${badge(r.status)}</div><div class="detail-grid" style="margin-top:8px"><div class="callout"><b>Evidence</b><p>${badge(r.evidence?.state)} · refs ${(r.evidence?.refs||[]).length}</p>${(r.artifacts||[]).map(a=>`<div class="mono">${esc(a.kind)} · ${esc(a.ref)}</div>`).join('')}</div><div class="callout"><b>Review</b><p>${badge(r.review?.state)} · ${esc(r.review?.verdict||'—')}</p><p>${esc(r.review?.rationale||'—')}</p></div><div class="callout"><b>Judge</b><p>${badge(r.judge?.state)} · ${esc(r.judge?.verdict||'—')}</p><p>${esc(r.judge?.rationale||'—')}</p></div><div class="callout"><b>Execution</b><p>${esc(r.provider||'—')} / ${esc(r.model||'—')} · confidence ${r.confidence??'—'}</p></div></div><div class="chips">${mockMark(r)}</div></div>`).join('')||'<div class="empty">Chưa có Result/Evidence từ Controller.</div>'}

function renderRecovery(s){const rows=(s.jobs||[]).filter(j=>j.blocker||['FAILED','BLOCKED'].includes(String(j.stage||'').toUpperCase()));$('recoveryList').innerHTML=rows.map(j=>`<div class="item"><div class="item-head"><div><div class="item-title mono">${esc(j.jobId)}</div><p>${esc(j.objective)}</p></div>${badge(j.stage)}</div><p><b>Blocker:</b> ${esc(j.blocker?.code||'—')} · ${esc(j.blocker?.message||'—')}</p><p><b>Recovery:</b> ${esc(j.recovery?.strategy||'—')} · next ${fmt(j.recovery?.nextEligibleAt)}</p><div class="chips">${mockMark(j)}<span class="chip">attempt ${j.attempts}/${j.maxAttempts}</span></div><button class="btn warn retry-btn" data-job="${esc(j.jobId)}" style="margin-top:8px">Gửi retry intent</button></div>`).join('')||'<div class="empty">Không có blocker/recovery record.</div>';document.querySelectorAll('.retry-btn').forEach(b=>b.onclick=()=>retryJob(b.dataset.job))}

function renderActivity(s){$('activityList').innerHTML=(s.activity||[]).map(e=>`<div class="event"><span>${fmt(e.at)}</span><b>${esc(e.type)}</b><span>${esc(e.message)} ${e.jobId?`<span class="mono">${esc(e.jobId)}</span>`:''} ${mockMark(e)}</span></div>`).join('')||'<div class="empty">Chưa có audit event.</div>'}

function render(){const s=state.snapshot||MOCK_CONTROLLER_SNAPSHOT;renderModeBanner();renderOverview(s);renderJobs(s);renderEmployees(s);renderProviders(s);renderPrompts(s);renderResults(s);renderRecovery(s);renderActivity(s);$('goalModeNote').textContent=state.mode==='mock'?'MOCK: submit chỉ tạo draft, không gửi PC01.':'CONTROLLER: submit intent tới Workforce Controller; Controller/orchestrator quyết định công việc.'}

function showConnection(value){$('connectionResult').textContent=JSON.stringify(value,null,2)}

async function connectController(){const url=$('controllerUrl').value.trim();const token=$('controllerToken').value;try{const client=new WorkforceControllerClient({baseUrl:url,accessToken:token});state.client=client;state.mode='controller';sessionStorage.setItem('tigeriq.controller.token',token);localStorage.setItem('tigeriq.controller.url',client.baseUrl);showConnection({ok:true,mode:'controller',baseUrl:client.baseUrl,note:'No data accepted until snapshot validates authoritative Controller schema.'});await refresh()}catch(error){showConnection({ok:false,error:error.message,hint:error.hint||null})}}
async function probeController(){try{const url=$('controllerUrl').value.trim();const token=$('controllerToken').value;const client=new WorkforceControllerClient({baseUrl:url,accessToken:token});showConnection(await client.health())}catch(error){showConnection({ok:false,error:error.message,hint:error.hint||null})}}
async function useMock(){state.client=new MockControllerClient(MOCK_CONTROLLER_SNAPSHOT);state.mode='mock';state.controllerError=null;showConnection({ok:true,mode:'mock',authoritative:false});await refresh()}

async function submitGoal(event){event.preventDefault();const goal={objective:$('goalObjective').value.trim(),priority:$('goalPriority').value,deadline:$('goalDeadline').value?new Date($('goalDeadline').value).toISOString():null,constraints:$('goalConstraints').value.split('\n').map(x=>x.trim()).filter(Boolean),expectedEvidence:$('goalEvidence').value.split('\n').map(x=>x.trim()).filter(Boolean),requestedBy:'owner-web-control'};const out=$('goalResult');out.hidden=false;try{out.textContent=JSON.stringify(await state.client.submitGoal(goal),null,2);if(state.mode==='controller')await refresh()}catch(error){out.textContent=JSON.stringify({ok:false,error:error.message},null,2)}}
async function savePrompt(){const promptVersion={promptId:$('promptId').value.trim(),version:$('promptVersion').value.trim(),content:$('promptContent').value,status:'DRAFT'};const out=$('promptSaveResult');out.hidden=false;try{out.textContent=JSON.stringify(await state.client.savePromptVersion(promptVersion),null,2)}catch(error){out.textContent=JSON.stringify({ok:false,error:error.message},null,2)}}
async function retryJob(jobId){try{showConnection(await state.client.retryJob(jobId,'owner_web_retry_intent'));if(state.mode==='controller')await refresh()}catch(error){showConnection({ok:false,error:error.message,jobId})}}

function switchView(view){document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active',s.dataset.section===view));const [title,sub]=pageMeta[view]||pageMeta.overview;$('pageTitle').textContent=title;$('pageSubtitle').textContent=sub;history.replaceState(null,'',`#${view}`)}

document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$('refreshBtn').onclick=refresh;$('connectBtn').onclick=connectController;$('probeBtn').onclick=probeController;$('mockBtn').onclick=useMock;$('goalForm').onsubmit=submitGoal;$('savePromptBtn').onclick=savePrompt;$('ownerLoginBtn').onclick=ownerGoogleLogin;
const savedUrl=localStorage.getItem('tigeriq.controller.url')||'';$('controllerUrl').value=savedUrl;$('controllerToken').value=sessionStorage.getItem('tigeriq.controller.token')||'';
switchView(location.hash.slice(1) in pageMeta?location.hash.slice(1):'overview');
await Promise.all([loadOwnerAuth(),refresh()]);
