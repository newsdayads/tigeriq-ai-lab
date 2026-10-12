/* TigerIQ Work Center V1 — one read-only UI/semantic module for LIVE, API Health and Web Control. */
(function(root){
'use strict';
const LABELS={OPEN:'CHƯA LÀM',UNKNOWN:'CHƯA XÁC MINH',OWNER_GATE:'CHỜ ANH SƠN',WORKING:'ĐANG LÀM',REVIEW:'RÀ SOÁT',VERIFY:'XÁC MINH',QUEUED:'SẴN SÀNG',WAITING:'CHỜ',BLOCKED:'BỊ CHẶN',PAUSED:'TẠM DỪNG',GOAL:'MỤC TIÊU',SYSTEM:'HỆ THỐNG',DONE:'HOÀN TẤT',CLOSED_UNVERIFIED:'ĐÓNG KHÁC'};
const COLORS={OPEN:'#64748B',UNKNOWN:'#64748B',OWNER_GATE:'#A78BFA',WORKING:'#10B981',REVIEW:'#3B82F6',VERIFY:'#14B8A6',QUEUED:'#F59E0B',WAITING:'#F59E0B',BLOCKED:'#F43F5E',PAUSED:'#64748B',DONE:'#06B6D4',GOAL:'#64748B',SYSTEM:'#64748B',CLOSED_UNVERIFIED:'#94A3B8'};
const ALIASES={'ĐANG XỬ LÝ':'WORKING','ĐANG LÀM':'WORKING','RÀ SOÁT':'REVIEW','ĐANG RÀ SOÁT':'REVIEW','XÁC MINH':'VERIFY','ĐANG XÁC MINH':'VERIFY','CHỜ':'WAITING','ĐANG CHỜ':'WAITING','BỊ CHẶN':'BLOCKED','HOÀN TẤT':'DONE','CHƯA LÀM':'OPEN','SẴN SÀNG':'QUEUED','TẠM DỪNG':'PAUSED','CHỜ ANH SƠN':'OWNER_GATE','CHỜ ANH SƠN DUYỆT':'OWNER_GATE','MỞ':'OPEN'};
const lastSignatures=new Map();
const activeHistory=new WeakMap();
function txt(x){return String(x==null?'':x)}
function esc(x){return txt(x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function time(value){const ms=Date.parse(value||'');return Number.isFinite(ms)?ms:null}
function fmt(value){const ms=time(value);return ms===null?'Chưa xác minh':new Date(ms).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}
function status(row){const raw=txt(row&&row.status||'UNKNOWN').toUpperCase().trim();return ALIASES[raw]||raw}
function completion(row){
 if(!row||status(row)!=='DONE')return false;
 if(row.completionVerified===true)return true;
 const t=row.lifecycleTiming||{};
 if(t.finishVerified!==true||!t.finishedAt)return false;
 return row.lifecycleContract&&row.lifecycleContract.valid===true&&row.progressChecklistVerified===true&&Number(row.progressDone)>0&&Number(row.progressDone)===Number(row.progressTotal);
}
function viewStatus(row){return status(row)==='DONE'&&!completion(row)?'VERIFY':status(row)}
function priority(row){const p=txt(row&& (row.effectivePriority||row.priority)||'META').toUpperCase();return /^P[0-5]$/.test(p)?p:'META'}
function title(row){let t=txt(row&&row.title||'Chưa có tên việc').replace(/^\s*#?\d+\s*[-–—:]?\s*/,'').trim();while(/^\[[^\]]+\]\s*/.test(t))t=t.replace(/^\[[^\]]+\]\s*/,'');return t||'Chưa có tên việc'}
function person(row){const verified=txt(row&&row.activeWorker||'').toUpperCase();if(row&&row.activeLease===true&&row.heartbeatFresh===true&&/^NV\d{2}$/.test(verified))return verified;
 const ex=txt(row&&row.assignedExecutor||'').toUpperCase();if(row&&row.assignedExecutorVerified===true&&/^NV\d{2}$/.test(ex))return ex;
 const raw=txt(row&&(row.assignee||row.employeeId)||'').toUpperCase();if(/^NV\d{2}$/.test(raw))return raw+' · khai báo';
 return 'CHƯA XÁC MINH';
}
function progress(row,opt){
 const o=opt||{},s=viewStatus(row),percent=Number(row&&row.progressPercent);
 const fresh=o.fresh!==false,verifiedSource=['explicit_verified','checklist_verified','github_gates_verified'].includes(txt(row&&row.progressSource));
 if(!fresh||!Number.isFinite(percent)||percent<0||percent>100)return{verified:false,percent:null};
 if(s==='DONE'&&completion(row)&&percent===100)return{verified:true,percent:100};
 if(s!=='DONE'&&percent<100&&verifiedSource&&o.sourceGate!==false&&row&&row.progressChecklistVerified!==false)return{verified:true,percent:Math.round(percent)};
 return{verified:false,percent:null};
}
function rowsFor(data,filter){
 const o=Array.isArray(data&&data.openWork)?data.openWork:[].concat(data&&data.activeWork||[],data&&data.nextQueue||[]);
 const done=Array.isArray(data&&data.recentWork)?data.recentWork:[];
 const work=x=>x&&x.workKind==='WORK'&&status(x)!=='SYSTEM';
 const ready=x=>['OPEN','WAITING','QUEUED'].includes(status(x))&&(status(x)==='QUEUED'||x.executionEligibility==='READY');
 const f=filter||'action';
 const ended=done.filter(x=>work(x)&&(completion(x)||status(x)==='CLOSED_UNVERIFIED'));
 if(f==='all'){
  const seen=new Set(o.filter(work).map(x=>Number(x.number)).filter(n=>Number.isInteger(n)&&n>0));
  return o.filter(work).concat(ended.filter(x=>!seen.has(Number(x.number))));
 }
 if(f==='working')return o.filter(x=>work(x)&&status(x)==='WORKING'&&x.activeLease===true&&x.heartbeatFresh===true);
 if(f==='waitblocked')return o.filter(x=>work(x)&&['WAITING','BLOCKED','OWNER_GATE','REVIEW','VERIFY','PAUSED'].includes(status(x)));
 if(f==='closed')return ended;
 if(f==='done')return done.filter(completion);
 if(f==='archived')return done.filter(x=>status(x)==='CLOSED_UNVERIFIED'&&!completion(x));
 if(f==='owner')return o.filter(x=>status(x)==='OWNER_GATE');
 if(f==='running')return o.filter(x=>status(x)==='WORKING'&&x.activeLease===true&&x.heartbeatFresh===true);
 if(f==='review')return o.filter(x=>['REVIEW','VERIFY'].includes(status(x)));
 if(f==='verify')return o.filter(x=>status(x)==='VERIFY');
 if(f==='ready')return o.filter(x=>work(x)&&ready(x));
 if(f==='waiting')return o.filter(x=>status(x)==='WAITING'&&!ready(x));
 if(f==='waitgroup')return o.filter(x=>status(x)==='OWNER_GATE'||status(x)==='WAITING'&&!ready(x));
 if(f==='blocked')return o.filter(x=>status(x)==='BLOCKED');
 if(f==='paused')return o.filter(x=>status(x)==='PAUSED');
 if(f==='unstarted')return o.filter(x=>work(x)&&status(x)==='OPEN'&&!ready(x));
 if(f==='system')return o.filter(x=>x.workKind==='SYSTEM'||status(x)==='SYSTEM');
 if(f==='goal')return o.filter(x=>x.workKind==='GOAL'||status(x)==='GOAL');
 return o.filter(work);
}
function badgeIcon(s){
 const d={DONE:'M20 6 9 17l-5-5',WORKING:'M3 12h4l3-8 4 16 3-8h4',BLOCKED:'M12 9v4m0 4h.01',REVIEW:'M21 21l-4.35-4.35M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14',WAITING:'M12 7v5l4 2',QUEUED:'M12 7v5l4 2'};return '<svg class="live-status-icon" role="img" aria-label="'+esc(LABELS[s]||s)+'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="'+(d[s]||'M12 4v16M4 12h16')+'"/></svg>';
}
function renderCards(container,rows,options){
 if(!container)return;
 const opt=options||{},data=Array.isArray(rows)?rows:[];
 if(!data.length){if(container.children.length!==1||!container.firstElementChild.classList.contains('empty'))container.innerHTML='<div class="empty">Không có công việc được xác minh trong nhóm này.</div>';return}
 const fragment=[];
 data.forEach((row,index)=>{
  const s=viewStatus(row),p=priority(row),pr=progress(row,opt),number=Number(row.number)||0;
  const el=document.createElement('article');el.className='work-row tiq-work-card status-'+s.toLowerCase()+' priority-'+p.toLowerCase()+(opt.compact?' tiq-compact':'');
  el.style.setProperty('--status-color',COLORS[s]||COLORS.UNKNOWN);el.setAttribute('data-work-number',txt(number));el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label','Mở chi tiết công việc '+number+' '+title(row));
  const project=txt(row.projectName||'Chưa phân dự án'),stream=txt(row.workstreamName||row.workPackageName||'Chưa phân nhánh');
  const blocker=txt(row.blocker||row.waitReason||'').trim();
  const summary=blocker?'Bị chặn: '+blocker:txt(row.nextStep||row.currentStep||'').trim();
  const count=Number(row.progressTotal),done=Number(row.progressDone);
  const checked=Number.isInteger(count)&&count>0&&Number.isInteger(done)&&done>=0&&done<=count;
  const gate=row.progressSource==='github_gates_verified'?'cổng GitHub':'bước';
  const steps=checked?(row.progressChecklistVerified===true&&opt.fresh!==false
    ?'<div class="work-step-summary"><span>'+done+'/'+count+' '+gate+' đã xác minh</span><span class="step-remaining">Còn '+(count-done)+' bước</span></div>'
    :'<div class="work-step-summary unverified">Có '+count+' bước theo GitHub · chưa xác minh</div>')
   :Array.isArray(row.executionSteps)&&row.executionSteps.length?'<div class="work-step-summary unverified">Có '+row.executionSteps.length+' bước theo GitHub · chưa xác minh</div>':'';
  const activeWithoutPercent=['WORKING','REVIEW','VERIFY'].includes(s);
  const bar=pr.verified?'<div class="progress"><div class="progress-track"><div class="progress-fill" style="width:'+pr.percent+'%"></div></div><span class="progress-text">'+pr.percent+'%</span></div>':activeWithoutPercent
    ?'<div class="progress indeterminate"><div class="progress-track"><div class="progress-fill"></div></div><span class="progress-text">Chưa đủ dữ liệu để tính %</span></div>':'';
  const t=row.lifecycleTiming||{},started=t.startVerified?fmt(t.startedAt):'Chưa xác minh',ended=completion(row)&&t.finishVerified?fmt(t.finishedAt):'Chưa nghiệm thu';
  const isRunning=s==='WORKING'&&row.activeLease===true&&row.heartbeatFresh===true&&opt.fresh!==false;
  if(isRunning)el.classList.add('progress-running');
  const parent=Number(row.parentNumber);
  const parentLine=Number.isSafeInteger(parent)&&parent>0?'<div class="work-parent">↳ Công việc cha #'+parent+'</div>':'';
  const showNext=!blocker&&Boolean(row.nextStep);
  const stripped=showNext?summary.replace(/^(?:bước\s+tiếp(?:\s+theo)?|next(?:\s+step)?)\s*[:：–—-]\s*/i,''):summary;
  const arrow='<svg class="next-step-icon" role="img" aria-label="Bước tiếp theo" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="m13 5 7 7-7 7"/></svg>';
  const signature=JSON.stringify([s,p,person(row),pr.percent,summary,project,stream,row.parentNumber,steps,bar,started,ended,opt.compact]);
  const past=lastSignatures.get(number);lastSignatures.set(number,signature);
  if(past&&past!==signature)el.classList.add('recently-updated');
  el.innerHTML='<div class="work-main"><div class="work-top"><span class="rank">'+txt(index+1).padStart(2,'0')+'</span><span class="work-id">#'+esc(number)+'</span><span class="priority '+p.toLowerCase()+'">'+esc(p)+'</span><span class="work-nv">'+esc(person(row))+'</span><span class="state '+s.toLowerCase()+'">'+badgeIcon(s)+esc(s==='VERIFY'&&status(row)==='DONE'?'CHỜ NGHIỆM THU':LABELS[s]||s)+'</span></div>'
   +'<div class="work-hierarchy">'+esc(project)+' <span aria-hidden="true">›</span> '+esc(stream)+'</div>'+parentLine
   +'<div class="work-title">'+esc(title(row))+'</div>'
   +(summary?'<div class="work-quick '+(blocker?'blocked':'next')+'">'+(showNext?arrow:'')+'<span>'+esc(stripped)+'</span></div>':'')
   +(steps||bar?'<div class="work-progress-bottom">'+steps+bar+'</div>':'')
   +'<div class="tiq-work-times"><span>Bắt đầu: '+esc(started)+'</span><span>Kết thúc: '+esc(ended)+'</span></div></div>';
  const open=()=>{if(typeof opt.onOpen==='function')opt.onOpen(row,el);else openModal(row,opt)};
  el.addEventListener('click',open);el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open()}});
  const original=container.querySelector('.work-row[data-work-number="'+number+'"]');
  if(original&&original.dataset.signature===signature){fragment.push(original);return;}
  el.dataset.signature=signature;
  fragment.push(el);
 });
 for(let i=0;i<fragment.length;i++){
  const item=fragment[i],current=container.children[i];
  if(current===item)continue;
  container.insertBefore(item,current||null);
 }
 while(container.children.length>fragment.length)container.lastElementChild.remove();
}
function auditMarkup(row,events){
 const timing=row&&row.lifecycleTiming||{};
 const start=timing.startVerified===true?fmt(timing.startedAt):'Chưa có biên nhận';
 const end=completion(row)?fmt(timing.finishedAt):'Chưa nghiệm thu';
 const elapsed=timing.startVerified&&completion(row)&&time(timing.finishedAt)>=time(timing.startedAt)?Math.round((time(timing.finishedAt)-time(timing.startedAt))/60000)+' phút':'Chưa xác minh';
 let html='<div class="tiq-audit-grid"><div><small>Bắt đầu thật</small><strong>'+esc(start)+'</strong></div><div><small>Kết thúc thật</small><strong>'+esc(end)+'</strong></div><div><small>Thời lượng</small><strong>'+esc(elapsed)+'</strong></div><div><small>Nhân sự / quyền giữ việc</small><strong>'+esc(person(row))+'</strong></div></div>';
 const list=Array.isArray(events)?events:[];
 html+='<h4>NHẬT KÝ HOẠT ĐỘNG ('+list.length+')</h4>';
 if(!list.length)return html+'<p class="tiq-audit-empty">Chưa có sự kiện gắn biên nhận được xác minh. Không suy diễn từ trạng thái hoặc thời gian cập nhật GitHub.</p>';
 html+='<ol class="tiq-audit-timeline">';
 for(const e of list.slice(0,60)){
  const link=typeof e.url==='string'&&/^https:\/\/(?:github\.com|api\.github\.com)\//.test(e.url)?'<a href="'+esc(e.url)+'" target="_blank" rel="noopener">Bằng chứng ↗</a>':'';
  html+='<li><time>'+esc(fmt(e.at))+'</time><b>'+esc(e.action||'Cập nhật')+'</b><div>'+esc(e.detail||'')+'</div><small>Ghi nhận: '+esc(e.author||'Chưa xác minh')+(e.executor?' · Thực thi: '+esc(e.executor):'')+'</small>'+link+'</li>';
 }
 return html+'</ol>';
}
function renderAudit(container,row,options){
 if(!container)return Promise.resolve();
 const opt=options||{};
 let events=Array.isArray(row&&row.auditEvents)?row.auditEvents:[];
 container.innerHTML=auditMarkup(row,events);
 const id=Number(row&&row.number);if(!Number.isSafeInteger(id)||id<1||!opt.historyEndpoint||typeof fetch!=='function')return Promise.resolve();
 const stamp={id};activeHistory.set(container,stamp);
 const separator=opt.historyEndpoint.includes('?')?'&':'?';
 return fetch(opt.historyEndpoint+separator+'number='+id,{cache:'no-store'})
  .then(r=>{if(!r.ok)throw Error('HISTORY_HTTP_'+r.status);return r.json()})
  .then(data=>{if(activeHistory.get(container)!==stamp)return;if(data&&data.ok&&Number(data.issueNumber)===id){const merged=Object.assign({},row,{lifecycleTiming:data.timing||row.lifecycleTiming,completionVerified:data.completionVerified===true});container.innerHTML=auditMarkup(merged,Array.isArray(data.events)?data.events:events)}else container.insertAdjacentHTML('beforeend','<p class="tiq-audit-empty">Nhật ký từ nguồn chưa được xác minh.</p>')})
  .catch(()=>{if(activeHistory.get(container)===stamp)container.insertAdjacentHTML('beforeend','<p class="tiq-audit-empty">Không đọc được nhật ký nguồn; giữ nguyên dữ liệu hiện có.</p>')});
}
function openModal(row,opt){
 if(typeof document==='undefined')return;
 let backdrop=document.getElementById('tiq-work-center-overlay');
 if(!backdrop){backdrop=document.createElement('div');backdrop.id='tiq-work-center-overlay';backdrop.className='tiq-work-overlay';backdrop.innerHTML='<section class="tiq-work-modal" role="dialog" aria-modal="true" aria-labelledby="tiq-modal-title"><header><h2 id="tiq-modal-title"></h2><button type="button" class="tiq-modal-close" aria-label="Đóng">×</button></header><div class="tiq-modal-content"></div></section>';document.body.append(backdrop);backdrop.querySelector('.tiq-modal-close').addEventListener('click',()=>backdrop.classList.remove('open'));backdrop.addEventListener('click',e=>{if(e.target===backdrop)backdrop.classList.remove('open')});}
 backdrop.querySelector('#tiq-modal-title').textContent=title(row);backdrop.classList.add('open');const audit=backdrop.querySelector('.tiq-modal-content');renderAudit(audit,row,opt);backdrop.querySelector('.tiq-modal-close').focus();
}
function mountFloatingReload(){
 if(typeof document==='undefined')return;
 const old=document.getElementById('reloadPage');if(old&&old.dataset.floatingMounted==='true')return;
 const button=old||document.createElement('button');
 button.id='reloadPage';button.type='button';button.classList.add('tiq-floating-reload');button.dataset.floatingMounted='true';button.setAttribute('aria-label','Tải lại trang');button.title='Tải lại trang';
 if(!button.querySelector('svg'))button.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 6"/><path d="M20 4v7h-7"/></svg>';
 if(!old)button.addEventListener('click',()=>root.location.reload());
 document.body.append(button);return button;
}
const API=Object.freeze({version:'1.0.0',status,viewStatus,completion,priority,title,person,progress,rowsFor,renderCards,renderAudit,openModal,mountFloatingReload,fmt});
root.TigerIQWorkCenter=API;
})(typeof window==='undefined'?globalThis:window);
