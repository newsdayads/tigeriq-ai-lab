// #772 — canonical Workforce/Registry cards enriched by Core runtime truth.
(() => {
  if (window.__tigerIqWorkforceCards) return;
  window.__tigerIqWorkforceCards = true;

  const LABEL = {
    IDLE:'RẢNH', BUSY:'ĐANG LÀM', READY:'SẴN SÀNG', ONLINE:'ONLINE', WAIT_KEY:'CHỜ KEY',
    RATE_LIMITED:'HẾT HẠN MỨC', OFFLINE:'NGOẠI TUYẾN', ERROR:'LỖI',
    AUTH_ERROR:'LỖI AUTH', CONFIG_ERROR:'LỖI CẤU HÌNH', CONTRACT_ERROR:'LỖI RESPONSE', STALE_ERROR:'LỖI CŨ',
    MANUAL:'THEO NHU CẦU', PAUSED:'TẠM DỪNG', NO_API:'KHÔNG CÓ API', DISABLED:'TẮT',
    RETIRED:'ĐÃ NGỪNG', UNASSIGNED:'CHƯA CẤP'
  };
  const safe = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const slots = () => Array.from({length:20},(_,i)=>`NV${String(i+1).padStart(2,'0')}`);
  const STATUS_ORDER = window.TigerIqHealthModel?.STATUS_ORDER || {BUSY:0,READY:1,IDLE:1,ONLINE:1,MANUAL:2,NO_API:2,RATE_LIMITED:3,AUTH_ERROR:4,CONFIG_ERROR:4,CONTRACT_ERROR:4,ERROR:4,WAIT_KEY:5,STALE_ERROR:6,OFFLINE:7,DISABLED:8,PAUSED:8,RETIRED:8,UNASSIGNED:9};
  const HEALTH_FRESH_MS=30*60*1000;
  const employeeNumber = id => Number(String(id||'').replace(/\D/g,'')) || 999;
  const ageMs=(value,now=Date.now())=>{const ts=Date.parse(String(value||''));return Number.isFinite(ts)?Math.max(0,now-ts):Infinity;};
  const quotaText=r=>{
    const summary=window.TigerIqHealthModel?.quotaSummary?.(r);
    if(summary)return `Quota: ${summary.replace(/^Quota\s*/,'')}`;
    const q=r?.quota_state||r?.quotaState;if(!q||typeof q!=='object')return 'Quota: chưa có dữ liệu provider';
    const finite=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Math.max(0,Number(value)):null);
    const requestRemaining=finite(q.requestRemaining??q.request_remaining),requestLimit=finite(q.requestLimit??q.request_limit);
    const tokenRemaining=finite(q.tokenRemaining??q.token_remaining),tokenLimit=finite(q.tokenLimit??q.token_limit);
    const ratioRaw=finite(q.remainingRatio??q.remaining_ratio),remainingRatio=ratioRaw===null?null:Math.min(1,ratioRaw);
    const resetAt=q.resetAt??q.reset_at??null;
    const hasConcrete=[requestRemaining,requestLimit,tokenRemaining,tokenLimit,remainingRatio].some(v=>v!==null)||Boolean(resetAt);
    if(q.known===false&&!hasConcrete)return 'Quota: provider chưa trả số dư';
    const parts=[];if(requestRemaining!==null)parts.push(`Request ${requestRemaining}${requestLimit!==null?'/'+requestLimit:''}`);if(tokenRemaining!==null)parts.push(`Token ${tokenRemaining}${tokenLimit!==null?'/'+tokenLimit:''}`);if(remainingRatio!==null)parts.push(`Còn ${Math.round(remainingRatio*100)}%`);if(resetAt)parts.push(`reset ${resetAt}`);
    return `Quota: ${parts.length?parts.join(' · '):(q.usable===false?'không khả dụng':'có thể sử dụng')}`;
  };

  function runtimeTruth(r,now=Date.now()){
    if(window.TigerIqHealthModel?.resourceHealthTruth)return window.TigerIqHealthModel.resourceHealthTruth(r,now);
    const raw=String(r?.status||'').toUpperCase();
    const error=String(r?.last_error||'').toLowerCase();
    const seenAge=ageMs(r?.last_seen_at,now);
    const errorAge=ageMs(r?.last_error_at||r?.lastErrorAt,now);
    const rateAge=ageMs(r?.last_429_at||r?.last429At||r?.last_error_at||r?.lastErrorAt,now);
    const fresh=seenAge<=HEALTH_FRESH_MS;
    const cooldown=Date.parse(String(r?.cooldown_until||''));
    const cooling=Number.isFinite(cooldown)&&cooldown>now;
    if(['BUSY','IDLE','READY','ONLINE'].includes(raw)){
      return {status:raw,current:true,historical:Boolean(error),detail:error?`Lỗi trước đó: ${error} · ${Number.isFinite(errorAge)?Math.round(errorAge/60000)+'p trước':'không rõ thời điểm'}`:'Đang khỏe'};
    }
    if(raw==='RATE_LIMITED'){
      if(cooling||(fresh&&/rate|429|quota/.test(error)))return {status:'RATE_LIMITED',current:true,historical:false,detail:cooling?`Rate limit hiện hành · thử lại ${Math.max(1,Math.ceil((cooldown-now)/60000))}p`:'Rate limit vừa ghi nhận'};
      return {status:'STALE_ERROR',current:false,historical:true,detail:`Rate limit cũ · ${Number.isFinite(rateAge)?Math.round(rateAge/60000)+'p trước':Number.isFinite(seenAge)?'telemetry '+Math.round(seenAge/60000)+'p trước':'không rõ thời điểm'}`};
    }
    if(raw==='ERROR'){
      if(!fresh)return {status:'STALE_ERROR',current:false,historical:true,detail:`Lỗi cũ: ${error||'unknown'} · ${Number.isFinite(errorAge)?Math.round(errorAge/60000)+'p trước':Number.isFinite(seenAge)?'telemetry '+Math.round(seenAge/60000)+'p trước':'không rõ thời điểm'}`};
      if(/auth|401|403/.test(error))return {status:'AUTH_ERROR',current:true,historical:false,detail:'Lỗi xác thực hiện hành'};
      if(/config|configuration/.test(error))return {status:'CONFIG_ERROR',current:true,historical:false,detail:'Lỗi cấu hình hiện hành'};
      if(/invalid_response|schema|empty_response|unexpected_response/.test(error))return {status:'CONTRACT_ERROR',current:true,historical:false,detail:'Lỗi response/contract hiện hành'};
    }
    return {status:raw||'OFFLINE',current:true,historical:false,detail:error?`Lỗi hiện tại: ${error}`:raw||'OFFLINE'};
  }

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
      const truth=runtime?runtimeTruth(runtime):null;
      return {...person,runtime,status:truth?.status||manualStatus(person),healthTruth:truth,role:shortRole(person,runtime)};
    }).sort((a,b)=>(STATUS_ORDER[a.status]??99)-(STATUS_ORDER[b.status]??99)||employeeNumber(a.employee_id)-employeeNumber(b.employee_id));
  }

  function techTitle(person) {
    const r=person.runtime;
    const lines=[`${person.employee_id} — ${person.name}`,`Vai trò: ${person.role}`,`Quản trị: ${person.admin_state||'—'}`];
    if(r){
      const ok=Number(r.calls_success_24h||0),fail=Number(r.calls_failure_24h||0),total=ok+fail;
      const allOk=Number(r.success_count||0),allFail=Number(r.failure_count||0);
      const rate=total?`${Math.round(ok*100/total)}%`:'—';
      const truth=person.healthTruth||runtimeTruth(r);
      lines.push(`Provider: ${r.provider||'—'}`,`Model: ${r.model||'—'}`,`Trạng thái thật: ${LABEL[truth.status]||truth.status}`,truth.detail,`Độ trễ: ${Number.isFinite(Number(r.last_latency_ms))?`${Math.round(Number(r.last_latency_ms))} ms`:'—'}`,`Usage 24h: ${rate} · ${ok} thành công / ${fail} lỗi`,`Tổng lịch sử: ${allOk} thành công / ${allFail} lỗi`,quotaText(r),`Cooldown: ${r.cooldown_until||'—'}`,`Lần cuối: ${r.last_seen_at||'—'}`);
      if(r.runtime_source_employee_id) lines.push(`Runtime legacy: ${r.runtime_source_employee_id} → ${person.employee_id}`);
    } else lines.push('Runtime/API: không có');
    return lines.join('\n');
  }

  function statusClass(status){
    if(['IDLE','READY','ONLINE','MANUAL'].includes(status)) return 'green';
    if(['BUSY'].includes(status)) return 'blue';
    if(['WAIT_KEY','RATE_LIMITED','PAUSED'].includes(status)) return 'amber';
    if(['AUTH_ERROR','CONFIG_ERROR','CONTRACT_ERROR','ERROR','OFFLINE'].includes(status)) return 'red';
    if(status==='STALE_ERROR') return 'gray';
    return 'gray';
  }

  function matchesFilter(person) {
    const provider=document.getElementById('providerFilter')?.value||'all';
    const state=document.getElementById('stateFilter')?.value||'all';
    const search=(document.querySelector('.board-controls input')?.value||'').trim().toLowerCase();
    const status=person.status;
    const p=String(person.runtime?.provider||'').toLowerCase();
    const isProblem=['AUTH_ERROR','CONFIG_ERROR','CONTRACT_ERROR','ERROR','OFFLINE','RATE_LIMITED','WAIT_KEY'].includes(status);
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
