// #772 — canonical Workforce/Registry cards enriched by Core runtime truth.
(() => {
  if (window.__tigerIqWorkforceCards) return;
  window.__tigerIqWorkforceCards = true;

  const LABEL = {
    IDLE:'RẢNH', BUSY:'ĐANG LÀM', READY:'SẴN SÀNG', WAIT_KEY:'CHỜ KEY',
    RATE_LIMITED:'HẾT HẠN MỨC', OFFLINE:'NGOẠI TUYẾN', ERROR:'LỖI',
    MANUAL:'THEO NHU CẦU', PAUSED:'TẠM DỪNG', NO_API:'THEO NHU CẦU', DISABLED:'TẮT',
    RETIRED:'ĐÃ NGỪNG', UNASSIGNED:'CHƯA CẤP'
  };
  const safe = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const slots = () => Array.from({length:20},(_,i)=>`NV${String(i+1).padStart(2,'0')}`);
  const STATUS_ORDER = {BUSY:0,READY:1,IDLE:1,MANUAL:2,NO_API:2,RATE_LIMITED:3,WAIT_KEY:4,ERROR:5,OFFLINE:6,DISABLED:7,PAUSED:7,RETIRED:7,UNASSIGNED:8};
  const employeeNumber = id => Number(String(id||'').replace(/\D/g,'')) || 999;

  function manualStatus(person) {
    const admin=String(person.admin_state||'').toUpperCase();
    if(person.retired || admin.includes('RETIRED')) return 'RETIRED';
    if(admin.includes('OWNER_STOPPED') || admin.includes('DISABLED') || admin.includes('DO_NOT_ROUTE')) return 'DISABLED';
    if(!person.assigned || admin.includes('UNASSIGNED')) return 'UNASSIGNED';
    if(admin.includes('PAUSED')) return 'PAUSED';
    if(admin.includes('MANUAL') || admin.includes('PRIMARY_UI') || admin.includes('SUPPORT_UI') || admin.includes('DEEP_RESEARCH')) return 'MANUAL';
    return 'NO_API';
  }

  function shortRole(person,runtime) {
    if(runtime?.provider) return `${runtime.provider}${runtime.model ? ` · ${runtime.model}` : ''}`;
    const id=person.employee_id;
    if(id==='NV01') return 'Thủ công · Điều phối phụ';
    if(id==='NV02') return 'Chrome · Thực thi chính';
    if(id==='NV03') return 'Chrome · Review hỗ trợ';
    if(id==='NV04') return 'Gemini Pro · Research/Review';
    if(id==='NV06') return 'Automation · OpenClaw';
    if(id==='NV10') return 'Local AI · Core resource';
    if(person.retired) return 'Mã nhân sự đã ngừng';
    if(!person.assigned) return 'Chưa có nhân sự được cấp';
    return String(person.admin_state||'Không có API').split('/')[0].trim();
  }

  function mergeWorkforce(d) {
    const roster=Array.isArray(d?.workforce) ? d.workforce : [];
    const rosterMap=new Map(roster.map(x=>[x.employee_id,x]));
    const runtimeMap=new Map((d?.resources||[]).map(x=>[x.employee_id,x]));
    return slots().map(id=>{
      const person=rosterMap.get(id)||{employee_id:id,name:'Chưa cấp',admin_state:'UNASSIGNED',assigned:false,retired:false};
      const runtime=runtimeMap.get(id)||null;
      return {...person,runtime,status:runtime?.status||manualStatus(person),role:shortRole(person,runtime)};
    }).sort((a,b)=>(STATUS_ORDER[a.status]??99)-(STATUS_ORDER[b.status]??99)||employeeNumber(a.employee_id)-employeeNumber(b.employee_id));
  }

  function techTitle(person) {
    const r=person.runtime;
    const lines=[`${person.employee_id} — ${person.name}`,`Vai trò: ${person.role}`,`Quản trị: ${person.admin_state||'—'}`];
    if(r){
      const ok=Number(r.calls_success_24h||0),fail=Number(r.calls_failure_24h||0),total=ok+fail;
      const rate=total?`${Math.round(ok*100/total)}%`:'—';
      lines.push(`Provider: ${r.provider||'—'}`,`Model: ${r.model||'—'}`,`Độ trễ: ${Number.isFinite(Number(r.last_latency_ms))?`${Math.round(Number(r.last_latency_ms))} ms`:'—'}`,`Thành công 24h: ${rate} (${ok}/${fail})`,`Lỗi cuối: ${r.last_error||'—'}`,`Cooldown: ${r.cooldown_until||'—'}`,`Lần cuối: ${r.last_seen_at||'—'}`);
      if(r.runtime_source_employee_id) lines.push(`Runtime legacy: ${r.runtime_source_employee_id} → ${person.employee_id}`);
    } else lines.push('Runtime/API: không có');
    return lines.join('\n');
  }

  function statusClass(status){
    if(['IDLE','READY','MANUAL'].includes(status)) return 'green';
    if(['BUSY'].includes(status)) return 'blue';
    if(['WAIT_KEY','RATE_LIMITED','PAUSED'].includes(status)) return 'amber';
    if(['ERROR','OFFLINE'].includes(status)) return 'red';
    return 'gray';
  }

  function matchesFilter(person) {
    const provider=document.getElementById('providerFilter')?.value||'all';
    const state=document.getElementById('stateFilter')?.value||'all';
    const search=(document.querySelector('.board-controls input')?.value||'').trim().toLowerCase();
    const status=person.status;
    const p=String(person.runtime?.provider||'').toLowerCase();
    const isProblem=['ERROR','OFFLINE','RATE_LIMITED','WAIT_KEY'].includes(status);
    if(provider==='local' && p!=='ollama') return false;
    if(provider==='cloud' && (!p || p==='ollama')) return false;
    if(provider!=='all' && !['local','cloud'].includes(provider) && p!==provider.toLowerCase()) return false;
    if(state==='working' && status!=='BUSY') return false;
    if(state==='problem' && !isProblem) return false;
    if(!['all','problem','working'].includes(state) && status!==state) return false;
    if(search && !`${person.employee_id} ${person.name} ${person.role} ${p}`.toLowerCase().includes(search)) return false;
    return true;
  }

  function sourceBadge(sourceType) {
    const type = String(sourceType || 'Local').toUpperCase();
    const label = type === 'AUTOMATION' ? 'Automation' : type === 'API' ? 'API' : type === 'UI' ? 'UI' : 'Local';
    return `<span class="source-badge source-${label.toLowerCase()}">${label}</span>`;
  }
  function card(person) {
    const cls=statusClass(person.status);
    const sourceType = person.runtime?.source_type || person.source_type || 'Local';
    return `<article class="worker workforce-card ${cls}" data-employee="${safe(person.employee_id)}" data-status="${safe(person.status)}" data-provider="${safe(person.runtime?.provider||'none')}" title="${safe(techTitle(person))}" tabindex="0"><div class="workforce-card-head"><strong>${safe(person.employee_id)} · ${safe(person.name)}</strong>${sourceBadge(sourceType)}<span class="workforce-badge ${cls}"><span class="dot"></span>${safe(LABEL[person.status]||person.status)}</span></div><div class="workforce-card-role">${safe(person.role)}</div></article>`;
  }

  function renderWorkforceCards(d) {
    const host=document.querySelector('.workers');
    if(!host) return;
    const workforce=mergeWorkforce(d).filter(matchesFilter);
    host.classList.add('workforce-strip');
    host.innerHTML=workforce.map(card).join('') || '<div class="tq-u-empty">Không có nhân sự khớp bộ lọc.</div>';
    host.dataset.totalWorkforce=String(mergeWorkforce(d).length);
  }

  function attachFilterRefresh(){
    const rerender=()=>{ try{ if(typeof S!=='undefined' && S?.data) renderWorkforceCards(S.data); }catch{} };
    ['providerFilter','stateFilter'].forEach(id=>document.getElementById(id)?.addEventListener('change',rerender));
    document.querySelector('.board-controls input')?.addEventListener('input',rerender);
    document.getElementById('tqQuickFilters')?.addEventListener('click',()=>queueMicrotask(rerender));
  }

  try { renderWorkers = renderWorkforceCards; } catch {}
  window.renderWorkers = renderWorkforceCards;
  attachFilterRefresh();
  try { if(typeof S!=='undefined' && S?.data) renderWorkforceCards(S.data); } catch {}
})();
