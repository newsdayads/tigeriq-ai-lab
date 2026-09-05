'use strict';
(function(root){
  const AUTO_MODES = new Set(['background_auto']);
  const FOREGROUND_MODES = new Set(['foreground_interactive']);
  const PAUSED_MODES = new Set(['paused_specialized']);
  const VALID_WORKER_STATES = new Set(['RẢNH','ĐANG_LÀM','CHỜ_ĐIỀU_KIỆN','NHƯỜNG_NV01','TẠM_DỪNG','BỊ_CHẶN','KHỞI_ĐỘNG']);
  const now = () => Date.now();
  const clone = v => JSON.parse(JSON.stringify(v));

  function uniq(xs){ return [...new Set((xs||[]).map(x=>String(x)))]; }
  function normalizeCommandAliases(xs){ return uniq(xs).filter(x=>/^\d+$/.test(x)).sort((a,b)=>Number(a)-Number(b)); }
  function normalizeEmployee(p){
    if(!p || !p.employee_id) throw new Error('EMPLOYEE_ID_REQUIRED');
    const q = clone(p);
    q.employee_id = String(q.employee_id);
    q.display_name = String(q.display_name || q.name || q.employee_id);
    q.role = String(q.role || '');
    q.mode = String(q.mode || 'background_auto');
    q.scope = q.scope && typeof q.scope==='object' ? q.scope : {resource_keys:[]};
    q.scope.resource_keys = uniq(q.scope.resource_keys || []);
    q.priority = Number.isFinite(Number(q.priority)) ? Number(q.priority) : 50;
    q.enabled = !!q.enabled;
    q.active = !!q.active;
    q.command_aliases = normalizeCommandAliases(q.command_aliases || []);
    q.primary_command = String(q.primary_command || q.command_aliases[0] || '');
    q.runtime_binding = String(q.runtime_binding || 'auto_worker');
    q.lease_ttl_ms = Math.max(30000, Number(q.lease_ttl_ms || 90000));
    q.heartbeat_ttl_ms = Math.max(10000, Number(q.heartbeat_ttl_ms || 30000));
    q.cycle_minutes = Math.max(5, Math.min(30, Number(q.cycle_minutes || 30)));
    q.weight = Math.max(0.1, Math.min(1, Number(q.weight || 1)));
    q.heavy = q.heavy !== false;
    q.review_preference = uniq(q.review_preference || []);
    return q;
  }
  function validateRegistry(reg){
    if(!reg || !Array.isArray(reg.employees)) throw new Error('REGISTRY_EMPLOYEES_REQUIRED');
    const employees = reg.employees.map(normalizeEmployee);
    const ids = new Set(), commands = new Map();
    for(const p of employees){
      if(ids.has(p.employee_id)) throw new Error('DUP_EMPLOYEE:'+p.employee_id);
      ids.add(p.employee_id);
      for(const c of p.command_aliases){
        if(commands.has(c)) throw new Error(`DUP_COMMAND:${c}:${commands.get(c)}:${p.employee_id}`);
        commands.set(c,p.employee_id);
      }
      if(AUTO_MODES.has(p.mode) && (!p.primary_command || !p.command_aliases.includes(p.primary_command))) throw new Error('AUTO_COMMAND_REQUIRED:'+p.employee_id);
    }
    return {registry_version:Number(reg.registry_version||1),source_issue:Number(reg.source_issue||335),synced_at:Number(reg.synced_at||0),employees};
  }
  function commandMap(reg){ const out={}; for(const p of validateRegistry(reg).employees) for(const c of p.command_aliases) out[c]=p.employee_id; return out; }
  function nextFreeCommand(reg){ const used=new Set(Object.keys(commandMap(reg)).map(Number)); let n=1; while(used.has(n)) n++; return String(n); }
  function autoEmployees(reg){ return validateRegistry(reg).employees.filter(p=>p.enabled && p.active && AUTO_MODES.has(p.mode)); }
  function foregroundEmployees(reg){ return validateRegistry(reg).employees.filter(p=>p.enabled && p.active && FOREGROUND_MODES.has(p.mode)); }
  function pausedEmployees(reg){ return validateRegistry(reg).employees.filter(p=>PAUSED_MODES.has(p.mode) || !p.enabled || !p.active); }

  function defaultWorkerState(profile){
    return {employee_id:profile.employee_id,display_name:profile.display_name,mode:profile.mode,state:PAUSED_MODES.has(profile.mode)?'TẠM_DỪNG':'RẢNH',paused:PAUSED_MODES.has(profile.mode)||!profile.enabled||!profile.active,
      heartbeat_at:0,current_work:null,waiting_condition:null,resource_claims:[],lastEvidence:null,last_checkpoint:null,
      runtimeMode:'IDLE',phase:'IDLE',sessionId:null,cycleId:null,cycleStartedAt:0,turns:0,baselineCommandCount:null,dispatchPendingAt:0,dispatchAttempt:0,lastDispatchAt:0,lastProgressAt:0,lastAssistantFingerprint:'',lastConsumedAssistantFingerprint:'',tailVerifyAttempts:0,expectedClose:false,navigationFailures:0,drainWaitStartedAt:0,lastProgressSignature:'',
      status:'RẢNH',statusDetail:'',tab_id:null,updated_at:now()};
  }
  function mergeWorkers(reg, workers){
    const out={};
    for(const p of validateRegistry(reg).employees){ out[p.employee_id]=Object.assign(defaultWorkerState(p), clone((workers||{})[p.employee_id]||{}), {employee_id:p.employee_id,display_name:p.display_name,mode:p.mode}); }
    return out;
  }
  function makeCycleJob(profile, seq, reason='AUTO_CONTINUE'){
    return {id:`${profile.employee_id}:cycle:${seq}`,employee_id:profile.employee_id,kind:'cycle',priority:profile.priority,resources:uniq(profile.scope.resource_keys||[]),state:'QUEUED',reason,created_at:now(),attempt:0,not_before:0};
  }
  function hasUnfinishedJob(queue, employeeId){ return (queue||[]).some(j=>j.employee_id===employeeId && ['QUEUED','RUNNING','WAITING'].includes(j.state)); }
  function ensureNearEmpty(queue, reg, seqByEmployee){
    const q=clone(queue||[]), seq=Object.assign({},seqByEmployee||{});
    for(const p of autoEmployees(reg)){
      const count=q.filter(j=>j.employee_id===p.employee_id && ['QUEUED','RUNNING','WAITING'].includes(j.state)).length;
      if(count<=0){ seq[p.employee_id]=Number(seq[p.employee_id]||0)+1; q.push(makeCycleJob(p,seq[p.employee_id],count===0?'NEAR_EMPTY_REFILL':'AUTO_CONTINUE')); }
    }
    return {queue:q,seqByEmployee:seq};
  }

  function leaseConflict(leases, employeeId, resources){
    const rs=new Set(resources||[]);
    for(const l of Object.values(leases||{})){
      if(l.employee_id===employeeId) continue;
      if(rs.has(l.resource)) return l;
    }
    return null;
  }
  function acquireLeases(leases, employeeId, resources, ttlMs, workId, at=now()){
    const out=clone(leases||{}); const conflict=leaseConflict(out,employeeId,resources);
    if(conflict) return {ok:false,leases:out,conflict};
    for(const resource of resources||[]){ out[resource]={resource,employee_id:employeeId,work_id:workId,acquired_at:at,heartbeat_at:at,expires_at:at+ttlMs}; }
    return {ok:true,leases:out};
  }
  function renewLeases(leases, employeeId, ttlMs, at=now()){
    const out=clone(leases||{}); for(const [k,l] of Object.entries(out)) if(l.employee_id===employeeId){ l.heartbeat_at=at;l.expires_at=at+ttlMs;out[k]=l; } return out;
  }
  function releaseLeases(leases, employeeId, resources=null){
    const out=clone(leases||{}); const filter=resources?new Set(resources):null;
    for(const [k,l] of Object.entries(out)) if(l.employee_id===employeeId && (!filter||filter.has(k))) delete out[k]; return out;
  }
  function reapStaleLeases(leases, at=now()){
    const out=clone(leases||{}), stale=[]; for(const [k,l] of Object.entries(out)) if(!l.expires_at || l.expires_at<at){ stale.push(l); delete out[k]; } return {leases:out,stale};
  }

  function cpuPercent(prev,next){
    if(!prev||!next||!Array.isArray(prev.processors)||!Array.isArray(next.processors)) return null;
    let dt=0,di=0;
    for(let i=0;i<Math.min(prev.processors.length,next.processors.length);i++){
      const a=prev.processors[i]?.usage||{},b=next.processors[i]?.usage||{};
      const t=Number(b.total||0)-Number(a.total||0), id=Number(b.idle||0)-Number(a.idle||0); if(t>0){dt+=t;di+=Math.max(0,id);} }
    return dt>0?Math.max(0,Math.min(100,100*(dt-di)/dt)):null;
  }
  function governorDecision(input={}){
    const cpu=Number(input.cpu_pct||0), mem=Number(input.mem_used_pct||0), owner=!!input.owner_foreground;
    const hard=cpu>=90||mem>=92, soft=cpu>=75||mem>=82;
    let heavy_slots=2,total_slots=2,level='THƯỜNG';
    if(owner){heavy_slots=0;total_slots=1;level='OWNER_FOREGROUND';}
    else if(hard){heavy_slots=0;total_slots=1;level='BỊ_HẠN_CHẾ';}
    else if(soft){heavy_slots=1;total_slots=1;level='CAO';}
    return {level,heavy_slots,total_slots,cooldown_ms:hard?30000:soft?20000:owner?15000:0};
  }
  function runningStats(workers,reg){
    const map={}; for(const p of validateRegistry(reg).employees) map[p.employee_id]=p;
    let heavy=0,total=0,weight=0;
    for(const w of Object.values(workers||{})) if(w.state==='ĐANG_LÀM') { const p=map[w.employee_id]; if(!p)continue; total++;weight+=p.weight;if(p.heavy)heavy++; }
    return {heavy,total,weight};
  }
  function selectRunnable(queue, workers, leases, reg, governor, at=now()){
    const profiles={}; for(const p of validateRegistry(reg).employees) profiles[p.employee_id]=p;
    const stats=runningStats(workers,reg); let heavy=stats.heavy,total=stats.total;
    const jobs=(queue||[]).filter(j=>j.state==='QUEUED' && Number(j.not_before||0)<=at).sort((a,b)=>Number(a.priority)-Number(b.priority)||Number(a.created_at)-Number(b.created_at));
    const selected=[]; const localLeases=clone(leases||{});
    for(const j of jobs){
      const p=profiles[j.employee_id], w=(workers||{})[j.employee_id]; if(!p||!w||!p.enabled||!p.active||!AUTO_MODES.has(p.mode)||w.paused||['BỊ_CHẶN','CHỜ_ĐIỀU_KIỆN','NHƯỜNG_NV01','TẠM_DỪNG'].includes(w.state)) continue;
      if(governor.total_slots<=total) break; if(p.heavy && governor.heavy_slots<=heavy) continue;
      if(leaseConflict(localLeases,p.employee_id,j.resources||[])) continue;
      const acq=acquireLeases(localLeases,p.employee_id,j.resources||[],p.lease_ttl_ms,j.id,at); if(!acq.ok) continue;
      Object.assign(localLeases,acq.leases); selected.push(j); total++; if(p.heavy)heavy++;
    }
    return selected;
  }
  function routeReviewer(implementerId, reg){
    const r=validateRegistry(reg), p=r.employees.find(x=>x.employee_id===implementerId); if(!p)return null;
    for(const id of p.review_preference||[]){ const q=r.employees.find(x=>x.employee_id===id); if(q&&q.enabled&&q.active&&id!==implementerId) return id; }
    const fallback=r.employees.find(x=>x.enabled&&x.active&&AUTO_MODES.has(x.mode)&&x.employee_id!==implementerId); return fallback?.employee_id||null;
  }
  function recoverQueueAfterRestart(queue, at=now()){
    return clone(queue||[]).map(j=>j.state==='RUNNING'?Object.assign(j,{state:'WAITING',not_before:at+2000,waiting_reason:'SERVICE_WORKER_RESTART'}):j);
  }
  function heartbeatFresh(worker, profile, at=now()){
    const ttl=Math.max(10000,Number(profile?.heartbeat_ttl_ms||30000));
    return !!worker && Number(worker.heartbeat_at||0)>0 && at-Number(worker.heartbeat_at)<ttl;
  }
  function routeWorkOrder(order, reg){
    const r=validateRegistry(reg), text=String(order?.scope||order?.category||order?.title||'').toLowerCase();
    const auto=r.employees.filter(x=>x.enabled&&x.active&&AUTO_MODES.has(x.mode));
    const byId=id=>auto.find(x=>x.employee_id===id)||null;
    if(/ai|api|multi[- ]?ai|provider|inference|gateway|orchestrat/.test(text)) return byId('NV04')?.employee_id||auto.find(x=>x.scope.resource_keys.some(k=>/ai|api|inference/.test(k)))?.employee_id||null;
    if(/web|vercel|ops|vận hành|automation|system|queue|website/.test(text)) return byId('NV02')?.employee_id||auto.find(x=>x.scope.resource_keys.some(k=>/web|ops|vercel|system|queue/.test(k)))?.employee_id||null;
    return null;
  }
  function applyOwnerForeground(workers,reg,owner){
    const out=clone(workers||{}), profiles={}; for(const p of validateRegistry(reg).employees)profiles[p.employee_id]=p;
    for(const w of Object.values(out)){ const p=profiles[w.employee_id]; if(!p||!AUTO_MODES.has(p.mode)) continue;
      if(owner && w.state==='ĐANG_LÀM' && p.heavy){w.state='NHƯỜNG_NV01';w.status='NHƯỜNG NV01';w.status_detail='Hoàn tất atomic step an toàn → checkpoint → nhả resource';}
      else if(!owner && w.state==='NHƯỜNG_NV01'){w.state='CHỜ_ĐIỀU_KIỆN';w.status='CHỜ TIẾP TỤC';w.waiting_condition={type:'RESOURCE_FREE',after:now()};}
    } return out;
  }

  const api={AUTO_MODES,FOREGROUND_MODES,PAUSED_MODES,VALID_WORKER_STATES,normalizeEmployee,validateRegistry,commandMap,nextFreeCommand,autoEmployees,foregroundEmployees,pausedEmployees,defaultWorkerState,mergeWorkers,makeCycleJob,hasUnfinishedJob,ensureNearEmpty,leaseConflict,acquireLeases,renewLeases,releaseLeases,reapStaleLeases,cpuPercent,governorDecision,runningStats,selectRunnable,routeReviewer,recoverQueueAfterRestart,heartbeatFresh,routeWorkOrder,applyOwnerForeground};
  root.TigerIQCore=api; if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
