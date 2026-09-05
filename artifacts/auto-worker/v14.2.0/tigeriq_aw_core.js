'use strict';
(function(root){
  const AUTO_MODES=new Set(['background_auto']);
  const FOREGROUND_MODES=new Set(['foreground_interactive']);
  const PAUSED_MODES=new Set(['paused_specialized']);
  const CRASH_RECOVERY_DELAYS=[5000,15000];
  const VALID_WORKER_STATES=new Set(['RẢNH','ĐANG_LÀM','CHỜ_ĐIỀU_KIỆN','NHƯỜNG_NV01','TẠM_DỪNG','BỊ_CHẶN','KHỞI_ĐỘNG']);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const uniq=xs=>[...new Set((xs||[]).map(x=>String(x)))];
  const now=()=>Date.now();
  const normalizeCommandAliases=xs=>uniq(xs).filter(x=>/^\d+$/.test(x)).sort((a,b)=>Number(a)-Number(b));

  function normalizeEmployee(p){
    if(!p||!p.employee_id) throw new Error('EMPLOYEE_ID_REQUIRED');
    const q=clone(p); q.employee_id=String(q.employee_id); q.display_name=String(q.display_name||q.name||q.employee_id); q.role=String(q.role||''); q.mode=String(q.mode||'specialized');
    q.registered=q.registered!==false; q.enabled=!!q.enabled; q.background_auto_allowed=!!q.background_auto_allowed; q.activation_state=String(q.activation_state||'INACTIVE'); q.runtime_active=!!q.runtime_active;
    q.background_order=Number.isInteger(Number(q.background_order))?Number(q.background_order):null;
    q.scope=q.scope&&typeof q.scope==='object'?q.scope:{resource_keys:[]}; q.scope.resource_keys=uniq(q.scope.resource_keys||[]);
    q.priority=Number.isFinite(Number(q.priority))?Number(q.priority):50; q.command_aliases=normalizeCommandAliases(q.command_aliases||[]); q.primary_command=String(q.primary_command||q.command_aliases[0]||'');
    q.runtime_binding=String(q.runtime_binding||'auto_worker'); q.lease_ttl_ms=Math.max(30000,Number(q.lease_ttl_ms||90000)); q.heartbeat_ttl_ms=Math.max(10000,Number(q.heartbeat_ttl_ms||30000));
    q.cycle_minutes=Math.max(5,Math.min(30,Number(q.cycle_minutes||30))); q.weight=Math.max(0.1,Math.min(1,Number(q.weight||1))); q.heavy=q.heavy!==false; q.review_preference=uniq(q.review_preference||[]);
    return q;
  }
  function isBackgroundRunnable(p){ return !!p&&p.registered&&p.enabled&&p.background_auto_allowed&&p.activation_state==='ACTIVE'&&p.runtime_active&&AUTO_MODES.has(p.mode); }
  function validateRegistry(reg){
    if(!reg||!Array.isArray(reg.employees)) throw new Error('REGISTRY_EMPLOYEES_REQUIRED');
    if(Number(reg.source_issue)!==335) throw new Error('REGISTRY_AUTHORITY_MISMATCH');
    if(Number(reg.central_issue)!==280) throw new Error('CENTRAL_AUTHORITY_MISMATCH');
    const employees=reg.employees.map(normalizeEmployee), ids=new Set(), commands=new Map();
    for(const p of employees){
      if(ids.has(p.employee_id)) throw new Error('DUP_EMPLOYEE:'+p.employee_id); ids.add(p.employee_id);
      for(const c of p.command_aliases){ if(commands.has(c)) throw new Error(`DUP_COMMAND:${c}:${commands.get(c)}:${p.employee_id}`); commands.set(c,p.employee_id); }
      if(isBackgroundRunnable(p)&&(!p.primary_command||!p.command_aliases.includes(p.primary_command))) throw new Error('AUTO_COMMAND_REQUIRED:'+p.employee_id);
    }
    return {registry_version:Number(reg.registry_version||1),authority_migration_version:Number(reg.authority_migration_version||0),source_issue:335,central_issue:280,activation_gate_issue:Number(reg.activation_gate_issue||440),synced_at:Number(reg.synced_at||0),employees};
  }
  function commandMap(reg){const out={};for(const p of validateRegistry(reg).employees)for(const c of p.command_aliases)out[c]=p.employee_id;return out;}
  function autoEmployees(reg){return validateRegistry(reg).employees.filter(isBackgroundRunnable).sort((a,b)=>(a.background_order??999)-(b.background_order??999));}
  function foregroundEmployees(reg){return validateRegistry(reg).employees.filter(p=>p.registered&&p.enabled&&p.runtime_active&&FOREGROUND_MODES.has(p.mode));}
  function pausedEmployees(reg){return validateRegistry(reg).employees.filter(p=>PAUSED_MODES.has(p.mode)||!p.enabled||!p.runtime_active);}
  function nextFreeCommand(reg){const used=new Set(Object.keys(commandMap(reg)).map(Number));let n=1;while(used.has(n))n++;return String(n);}
  function resolveCommand(command,reg,central){
    const c=String(command??'').trim(); if(!/^\d+$/.test(c)) return {ok:false,error:'COMMAND_UNREGISTERED'};
    const r=validateRegistry(reg); if(!central||Number(central.issue_number||central.issue)!==280||central.available===false) return {ok:false,error:'CENTRAL_UNAVAILABLE'};
    const p=r.employees.find(x=>x.command_aliases.includes(c)); if(!p||!p.registered) return {ok:false,error:'COMMAND_UNREGISTERED'};
    if(p.activation_state==='PAUSED') return {ok:false,error:'COMMAND_UNREGISTERED/TẠM_NGƯNG',employee_id:p.employee_id};
    if(p.employee_id==='NV05'&&p.activation_state!=='ACTIVE') return {ok:false,error:'COMMAND_PENDING_ACTIVATION',employee_id:p.employee_id};
    if(!p.enabled&&p.activation_state!=='PENDING_OWNER_ACTIVATION') return {ok:false,error:'COMMAND_UNREGISTERED',employee_id:p.employee_id};
    return {ok:true,employee_id:p.employee_id,display_name:p.display_name,mode:p.mode,background:isBackgroundRunnable(p),central_issue:280,registry_issue:335,queue_ref:central.queue_ref||central.current_priority||null,activation_state:p.activation_state};
  }
  function migrateAuthorityV2(reg){
    const r=clone(reg); r.authority_migration_version=2; r.source_issue=335; r.central_issue=280; r.activation_gate_issue=440;
    for(const p of r.employees||[]){
      if(p.employee_id==='NV02'){p.mode='background_auto';p.registered=true;p.enabled=true;p.background_auto_allowed=true;p.activation_state='ACTIVE';p.runtime_active=true;p.background_order=0;}
      if(p.employee_id==='NV03'){p.mode='paused_specialized';p.enabled=false;p.background_auto_allowed=false;p.activation_state='PAUSED';p.runtime_active=false;p.background_order=null;}
      if(p.employee_id==='NV04'){p.mode='specialized';p.registered=true;p.enabled=true;p.background_auto_allowed=true;p.activation_state='PENDING_OWNER_ACTIVATION';p.runtime_active=false;p.background_order=1;p.runtime_binding='specialized_session';}
      if(p.employee_id==='NV05'){p.mode='product_auto_pending';p.registered=true;p.enabled=false;p.background_auto_allowed=true;p.activation_state='PENDING_OWNER_ACTIVATION';p.runtime_active=false;p.background_order=2;p.runtime_binding='auto_worker_pending';}
      if(['VY','NV01'].includes(p.employee_id)){p.background_auto_allowed=false;p.background_order=null;}
    }
    return validateRegistry(r);
  }
  function activateAfterOwner(reg,token){
    if(token!=='TIGERIQ_ACTIVATION_READY gate=440 state=READY_FOR_OWNER_ACTIVATION') throw new Error('OWNER_ACTIVATION_REQUIRED');
    const r=clone(reg); for(const p of r.employees||[]) if(['NV04','NV05'].includes(p.employee_id)){p.enabled=true;p.runtime_active=true;p.activation_state='ACTIVE';p.mode='background_auto';p.runtime_binding='auto_worker';}
    return validateRegistry(r);
  }
  function windowPlacement(profileOrOrder,workArea,opt={}){
    const width=Number(opt.width||504),height=Number(opt.height||834),topGap=Number(opt.top||5),right=Number(opt.right||5),gap=Number(opt.gap||5);
    const order=typeof profileOrOrder==='number'?profileOrOrder:Number(profileOrOrder?.background_order??0); const wa={left:Number(workArea?.left||0),top:Number(workArea?.top||0),width:Number(workArea?.width||0),height:Number(workArea?.height||0)};
    const left=wa.left+wa.width-right-width-order*(width+gap), top=wa.top+topGap;
    if(width<=0||height<=0||wa.width<=0||wa.height<=0||left<wa.left||top<wa.top||left+width>wa.left+wa.width||top+height>wa.top+wa.height) return {ok:false,error:'DISPLAY_WORKAREA_INSUFFICIENT'};
    return {ok:true,left,top,width,height,right,gap,order};
  }
  function backgroundWindowPlan(reg,workArea){return autoEmployees(reg).map(p=>({employee_id:p.employee_id,...windowPlacement(p,workArea)}));}
  function closeDisposition(reason,attempt=0){
    const r=String(reason||'').toUpperCase(); if(r!=='CRASH_CLOSE') return {recover:false,reason:r||'EXPECTED_CLOSE'};
    if(attempt>=CRASH_RECOVERY_DELAYS.length) return {recover:false,reason:'CRASH_RECOVERY_EXHAUSTED'};
    return {recover:true,reason:'CRASH_CLOSE',delay_ms:CRASH_RECOVERY_DELAYS[attempt],next_attempt:attempt+1};
  }
  function shouldRecoverClose(reason){return closeDisposition(reason,0).recover;}
  function defaultWorkerState(profile){return {employee_id:profile.employee_id,display_name:profile.display_name,mode:profile.mode,state:PAUSED_MODES.has(profile.mode)?'TẠM_DỪNG':'RẢNH',paused:PAUSED_MODES.has(profile.mode)||!profile.enabled||!profile.runtime_active,heartbeat_at:0,current_work:null,waiting_condition:null,resource_claims:[],lastEvidence:null,last_checkpoint:null,runtimeMode:'IDLE',phase:'IDLE',sessionId:null,cycleId:null,cycleStartedAt:0,turns:0,baselineCommandCount:null,dispatchPendingAt:0,dispatchAttempt:0,lastDispatchAt:0,lastProgressAt:0,lastAssistantFingerprint:'',lastConsumedAssistantFingerprint:'',tailVerifyAttempts:0,expectedClose:false,navigationFailures:0,drainWaitStartedAt:0,lastProgressSignature:'',status:'RẢNH',statusDetail:'',tab_id:null,updated_at:now()};}
  function mergeWorkers(reg,workers){const out={};for(const p of validateRegistry(reg).employees)out[p.employee_id]=Object.assign(defaultWorkerState(p),clone((workers||{})[p.employee_id]||{}),{employee_id:p.employee_id,display_name:p.display_name,mode:p.mode,paused:!isBackgroundRunnable(p)&&!FOREGROUND_MODES.has(p.mode)});return out;}
  function makeCycleJob(profile,seq,reason='AUTO_CONTINUE'){return {id:`${profile.employee_id}:cycle:${seq}`,employee_id:profile.employee_id,kind:'cycle',priority:profile.priority,resources:uniq(profile.scope.resource_keys||[]),state:'QUEUED',reason,created_at:now(),attempt:0,not_before:0};}
  function hasUnfinishedJob(queue,employeeId){return(queue||[]).some(j=>j.employee_id===employeeId&&['QUEUED','RUNNING','WAITING'].includes(j.state));}
  function ensureNearEmpty(queue,reg,seqByEmployee){const q=clone(queue||[]),seq=Object.assign({},seqByEmployee||{});for(const p of autoEmployees(reg)){const count=q.filter(j=>j.employee_id===p.employee_id&&['QUEUED','RUNNING','WAITING'].includes(j.state)).length;if(count===0){seq[p.employee_id]=Number(seq[p.employee_id]||0)+1;q.push(makeCycleJob(p,seq[p.employee_id],'NEAR_EMPTY_REFILL'));}}return{queue:q,seqByEmployee:seq};}
  function leaseConflict(leases,employeeId,resources){const rs=new Set(resources||[]);for(const l of Object.values(leases||{})){if(l.employee_id===employeeId)continue;if(rs.has(l.resource))return l;}return null;}
  function acquireLeases(leases,employeeId,resources,ttlMs,workId,at=now()){const out=clone(leases||{}),conflict=leaseConflict(out,employeeId,resources);if(conflict)return{ok:false,leases:out,conflict};for(const resource of resources||[])out[resource]={resource,employee_id:employeeId,work_id:workId,acquired_at:at,heartbeat_at:at,expires_at:at+ttlMs};return{ok:true,leases:out};}
  function renewLeases(leases,employeeId,ttlMs,at=now()){const out=clone(leases||{});for(const[k,l]of Object.entries(out))if(l.employee_id===employeeId){l.heartbeat_at=at;l.expires_at=at+ttlMs;out[k]=l;}return out;}
  function releaseLeases(leases,employeeId,resources=null){const out=clone(leases||{}),filter=resources?new Set(resources):null;for(const[k,l]of Object.entries(out))if(l.employee_id===employeeId&&(!filter||filter.has(k)))delete out[k];return out;}
  function reapStaleLeases(leases,at=now()){const out=clone(leases||{}),stale=[];for(const[k,l]of Object.entries(out))if(!l.expires_at||l.expires_at<at){stale.push(l);delete out[k];}return{leases:out,stale};}
  function cpuPercent(prev,next){if(!prev||!next||!Array.isArray(prev.processors)||!Array.isArray(next.processors))return null;let dt=0,di=0;for(let i=0;i<Math.min(prev.processors.length,next.processors.length);i++){const a=prev.processors[i]?.usage||{},b=next.processors[i]?.usage||{},t=Number(b.total||0)-Number(a.total||0),id=Number(b.idle||0)-Number(a.idle||0);if(t>0){dt+=t;di+=Math.max(0,id);}}return dt>0?Math.max(0,Math.min(100,100*(dt-di)/dt)):null;}
  function governorDecision(input={}){const cpu=Number(input.cpu_pct||0),mem=Number(input.mem_used_pct||0),owner=!!input.owner_foreground,hard=cpu>=90||mem>=92,soft=cpu>=75||mem>=82;let heavy_slots=2,total_slots=2,level='THƯỜNG';if(owner){heavy_slots=0;total_slots=1;level='OWNER_FOREGROUND';}else if(hard){heavy_slots=0;total_slots=1;level='BỊ_HẠN_CHẾ';}else if(soft){heavy_slots=1;total_slots=1;level='CAO';}return{level,heavy_slots,total_slots,cooldown_ms:hard?30000:soft?20000:owner?15000:0};}
  function runningStats(workers,reg){const map={};for(const p of validateRegistry(reg).employees)map[p.employee_id]=p;let heavy=0,total=0,weight=0;for(const w of Object.values(workers||{}))if(w.state==='ĐANG_LÀM'){const p=map[w.employee_id];if(!p)continue;total++;weight+=p.weight;if(p.heavy)heavy++;}return{heavy,total,weight};}
  function selectRunnable(queue,workers,leases,reg,governor,at=now()){const profiles={};for(const p of validateRegistry(reg).employees)profiles[p.employee_id]=p;const stats=runningStats(workers,reg);let heavy=stats.heavy,total=stats.total;const jobs=(queue||[]).filter(j=>j.state==='QUEUED'&&Number(j.not_before||0)<=at).sort((a,b)=>Number(a.priority)-Number(b.priority)||Number(a.created_at)-Number(b.created_at)),selected=[],localLeases=clone(leases||{});for(const j of jobs){const p=profiles[j.employee_id],w=(workers||{})[j.employee_id];if(!p||!w||!isBackgroundRunnable(p)||w.paused||['BỊ_CHẶN','CHỜ_ĐIỀU_KIỆN','NHƯỜNG_NV01','TẠM_DỪNG'].includes(w.state))continue;if(governor.total_slots<=total)break;if(p.heavy&&governor.heavy_slots<=heavy)continue;if(leaseConflict(localLeases,p.employee_id,j.resources||[]))continue;const acq=acquireLeases(localLeases,p.employee_id,j.resources||[],p.lease_ttl_ms,j.id,at);if(!acq.ok)continue;Object.assign(localLeases,acq.leases);selected.push(j);total++;if(p.heavy)heavy++;}return selected;}
  function routeReviewer(implementerId,reg){const r=validateRegistry(reg),p=r.employees.find(x=>x.employee_id===implementerId);if(!p)return null;for(const id of p.review_preference||[]){const q=r.employees.find(x=>x.employee_id===id);if(q&&q.registered&&q.enabled&&q.runtime_active&&id!==implementerId)return id;}const fallback=r.employees.find(x=>isBackgroundRunnable(x)&&x.employee_id!==implementerId);return fallback?.employee_id||null;}
  function recoverQueueAfterRestart(queue,at=now()){return clone(queue||[]).map(j=>j.state==='RUNNING'?Object.assign(j,{state:'WAITING',not_before:at+2000,waiting_reason:'SERVICE_WORKER_RESTART'}):j);}
  function heartbeatFresh(worker,profile,at=now()){const ttl=Math.max(10000,Number(profile?.heartbeat_ttl_ms||30000));return!!worker&&Number(worker.heartbeat_at||0)>0&&at-Number(worker.heartbeat_at)<ttl;}
  function routeWorkOrder(order,reg){const r=validateRegistry(reg),keys=new Set(uniq(order?.resource_keys||order?.resources||[]));if(!keys.size)return null;const candidates=r.employees.filter(isBackgroundRunnable).filter(p=>p.scope.resource_keys.some(k=>keys.has(k)));candidates.sort((a,b)=>a.priority-b.priority);return candidates[0]?.employee_id||null;}
  function applyOwnerForeground(workers,reg,owner){const out=clone(workers||{}),profiles={};for(const p of validateRegistry(reg).employees)profiles[p.employee_id]=p;for(const w of Object.values(out)){const p=profiles[w.employee_id];if(!p||!isBackgroundRunnable(p))continue;if(owner&&w.state==='ĐANG_LÀM'&&p.heavy){w.state='NHƯỜNG_NV01';w.status='NHƯỜNG NV01';w.status_detail='Hoàn tất atomic step an toàn → checkpoint → nhả resource';}else if(!owner&&w.state==='NHƯỜNG_NV01'){w.state='CHỜ_ĐIỀU_KIỆN';w.status='CHỜ TIẾP TỤC';w.waiting_condition={type:'RESOURCE_FREE',after:now()};}}return out;}
  function archiveCloseGate(evidence){const e=evidence||{};if(e.archived!==true||e.verified!==true)return{ok:false,error:'BỊ_CHẶN_LƯU_TRỮ',keep_window_open:true};return{ok:true,keep_window_open:false};}
  const api={AUTO_MODES,FOREGROUND_MODES,PAUSED_MODES,VALID_WORKER_STATES,CRASH_RECOVERY_DELAYS,normalizeEmployee,validateRegistry,isBackgroundRunnable,commandMap,nextFreeCommand,autoEmployees,foregroundEmployees,pausedEmployees,resolveCommand,migrateAuthorityV2,activateAfterOwner,windowPlacement,backgroundWindowPlan,closeDisposition,shouldRecoverClose,defaultWorkerState,mergeWorkers,makeCycleJob,hasUnfinishedJob,ensureNearEmpty,leaseConflict,acquireLeases,renewLeases,releaseLeases,reapStaleLeases,cpuPercent,governorDecision,runningStats,selectRunnable,routeReviewer,recoverQueueAfterRestart,heartbeatFresh,routeWorkOrder,applyOwnerForeground,archiveCloseGate};
  root.TigerIQCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
