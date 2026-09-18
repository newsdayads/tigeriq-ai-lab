// OWNER_DIRECT #767 — Web Control is the single Owner UI; API Health is the visual/function reference.
(() => {
  if (window.__tigerIqUnifiedWebControlV2) return;
  window.__tigerIqUnifiedWebControlV2 = true;

  const STATUS = {IDLE:'RẢNH',BUSY:'ĐANG LÀM',READY:'SẴN SÀNG',WAIT_KEY:'CHỜ KEY',RATE_LIMITED:'HẾT HẠN MỨC',OFFLINE:'NGOẠI TUYẾN',ERROR:'LỖI',DISABLED:'TẮT',ONLINE:'ONLINE'};
  const PROVIDER_MARK = {ollama:'🦙',groq:'⚡',gemini:'✦',openrouter:'⬡',mistral:'M',cloudflare:'☁',huggingface:'🤗',vercel:'▲',watsonx:'◉',cohere:'C',nvidia:'N'};
  const PROVIDER_COLOR = {ollama:'#fff',groq:'#ff5533',gemini:'#8e75b2',openrouter:'#dbeafe',mistral:'#fa520f',cloudflare:'#f38020',huggingface:'#ffd21e',vercel:'#fff',watsonx:'#4da3ff',cohere:'#7bdcb5',nvidia:'#76b900'};
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => value ? new Date(value).toLocaleTimeString('vi-VN',{hour12:false}) : '—';
  const rel = value => { if(!value)return '—'; const sec=Math.max(0,Math.floor((Date.now()-new Date(value))/1000)); if(sec<60)return `${sec}s`; if(sec<3600)return `${Math.floor(sec/60)}p`; if(sec<86400)return `${Math.floor(sec/3600)}h`; return `${Math.floor(sec/86400)}d`; };
  const healthJobs = d => d?.jobs || [];

  function installLiveBar(){
    const topbar=document.querySelector('.topbar');
    if(!topbar||document.getElementById('tqULiveBar'))return;
    const bar=document.createElement('div');
    bar.id='tqULiveBar'; bar.className='tq-u-livebar';
    bar.innerHTML='<span class="tq-u-live"><span class="dot pulse"></span>LIVE · 2s</span><span id="tqULiveSync" class="tq-u-sync">Đang đồng bộ…</span>';
    const health=document.getElementById('topHealth');
    topbar.insertBefore(bar,health||null);
  }

  function installQuickFilters(){
    const controls=document.querySelector('.board-controls');
    if(!controls||document.getElementById('tqQuickFilters'))return;
    const quick=document.createElement('div'); quick.id='tqQuickFilters'; quick.className='tq-quick-filters';
    quick.innerHTML='<button class="tq-filter on" data-q="all">Tất cả</button><button class="tq-filter" data-q="local">Local</button><button class="tq-filter" data-q="cloud">Cloud API</button><button class="tq-filter" data-q="problem">Có vấn đề</button>';
    controls.prepend(quick);
    quick.addEventListener('click',e=>{
      const btn=e.target.closest('.tq-filter'); if(!btn)return;
      quick.querySelectorAll('.tq-filter').forEach(x=>x.classList.remove('on')); btn.classList.add('on');
      const provider=document.getElementById('providerFilter'), state=document.getElementById('stateFilter');
      if(btn.dataset.q==='all'){provider.value='all';state.value='all';}
      if(btn.dataset.q==='local'){provider.value='local';state.value='all';}
      if(btn.dataset.q==='cloud'){provider.value='cloud';state.value='all';}
      if(btn.dataset.q==='problem'){provider.value='all';state.value='problem';}
      provider.dispatchEvent(new Event('change',{bubbles:true})); state.dispatchEvent(new Event('change',{bubbles:true}));
    });
  }

  function mountUnifiedOverview(){
    installLiveBar(); installQuickFilters();
    const overview=document.querySelector('.page[data-view="overview"]');
    if(!overview||overview.querySelector('.tq-u-overview'))return;
    const metrics=document.getElementById('metrics'), oldGrid=overview.querySelector('.grid-top'), board=overview.querySelector('.board');
    const pipeline=document.getElementById('pipeline')?.closest('.panel'), objective=document.getElementById('objectivePreview')?.closest('.panel'), events=document.getElementById('eventsPreview')?.closest('.panel');
    const architecture=overview.querySelector('.org')?.closest('.panel');
    if(!metrics||!oldGrid||!board||!pipeline||!objective||!events)return;
    const grid=document.createElement('div'); grid.className='tq-u-overview';
    const main=document.createElement('div'); main.className='tq-u-main';
    const side=document.createElement('aside'); side.className='tq-u-side';
    const activity=document.createElement('section'); activity.className='tq-u-panel';
    activity.innerHTML='<div class="tq-u-ph"><div><h2>⚡ Đang chạy / Vừa hoàn tất</h2><small>Hoạt động thật của campaign và NV API từ TigerIQ Core</small></div><span id="tqUActivityState" class="tq-u-sync">—</span></div><div id="tqUActivityBody" class="body"></div>';
    const recent=document.createElement('section'); recent.className='tq-u-panel';
    recent.innerHTML='<div class="tq-u-ph"><div><h2>▤ Công việc gần nhất</h2><small>Công việc thật từ hàng đợi TigerIQ Core</small></div><span id="tqUJobCount" class="tq-u-sync">—</span></div><div class="table-wrap"><table class="tq-u-jobs"><thead><tr><th>Job</th><th>Công việc</th><th>NV</th><th>Nhà cung cấp</th><th>Trạng thái</th><th>Thời gian</th></tr></thead><tbody id="tqURecentJobs"></tbody></table></div>';
    const perf=document.createElement('section'); perf.className='tq-u-panel';
    perf.innerHTML='<div class="tq-u-ph"><div><h2>⌁ Hiệu suất API</h2><small>Độ trễ thật trong 24 giờ gần nhất</small></div><span id="tqUChartCount" class="tq-u-sync">—</span></div><div class="body"><div id="tqUChart" class="tq-u-chart"><div class="tq-u-chart-empty">Đang tải telemetry…</div></div><div id="tqULegend" class="tq-u-legend"></div></div>';
    main.append(activity,board,recent); side.append(perf,pipeline,objective,events); grid.append(main,side); metrics.insertAdjacentElement('afterend',grid);
    if(architecture){const peoplePage=document.querySelector('.page[data-view="people"]'); architecture.classList.add('tq-u-architecture'); if(peoplePage)peoplePage.appendChild(architecture);}
    oldGrid.remove();
  }

  function richWorkerCard(r){
    const ok=Number(r.calls_success_24h??r.success_count??0), fail=Number(r.calls_failure_24h??r.failure_count??0), total=ok+fail, rate=total?Math.round(ok*100/total):null;
    const latency=Number.isFinite(Number(r.last_latency_ms))?`${(Number(r.last_latency_ms)/1000).toFixed(1)}s`:'—';
    const cooldown=r.cooldown_until&&new Date(r.cooldown_until)>new Date()?Math.max(1,Math.ceil((new Date(r.cooldown_until)-Date.now())/60000)):null;
    const extra=cooldown?`Thử lại ~${cooldown}p`:r.last_error?`Lỗi cuối: ${safe(r.last_error)}`:'';
    const provider=String(r.provider||'').toLowerCase(), mark=PROVIDER_MARK[provider]||String(r.name||'?').slice(0,1).toUpperCase(), brand=PROVIDER_COLOR[provider]||'#fff';
    return `<article class="worker" data-provider="${safe(provider)}" data-status="${safe(r.status)}"><div class="tq-worker-head"><div class="tq-worker-id">${safe(r.employee_id)}</div><div class="tq-statusline ${safe(r.status)}"><span class="dot ${r.status==='BUSY'?'pulse':''}"></span><span class="tq-spark"><i></i><i></i><i></i><i></i><i></i></span></div></div><div class="tq-provider-row"><div class="tq-logo" style="--brand:${safe(brand)}">${safe(mark)}</div><div class="tq-provider-copy"><div class="tq-u-provider">${safe(r.name)}</div><div class="tq-u-model">${safe(r.provider)} • ${safe(r.model||'—')}</div></div></div><span class="status ${CLASS?.[r.status]||'gray'}">${safe(STATUS[r.status]||r.status)}</span><div class="kv"><span>Job hiện tại</span><b>${r.current_job_id?safe(String(r.current_job_id).slice(0,14)):'—'}</b></div><div class="kv"><span>Lần cuối</span><b>${safe(fmt(r.last_seen_at))}</b></div><div class="kv"><span>Độ trễ TB</span><b>${safe(latency)}</b></div>${extra?`<div class="kv"><span>Trạng thái</span><b title="${safe(extra)}">${safe(extra)}</b></div>`:''}<div class="tq-u-success"><span>Tỷ lệ thành công</span><b>${rate==null?'Chưa đủ dữ liệu':`${rate}% · ${ok}✓/${fail}✕`}</b></div>${rate==null?'':`<div class="tq-u-bar"><i style="width:${Math.max(0,Math.min(100,rate))}%"></i></div>`}</article>`;
  }

  function renderUnifiedMetrics(d){
    const rs=d?.resources||[], js=healthJobs(d);
    const healthy=rs.filter(x=>['IDLE','BUSY'].includes(x.status)).length, ready=rs.filter(x=>x.status==='READY').length, busy=rs.filter(x=>x.status==='BUSY').length;
    const alerts=rs.filter(x=>['RATE_LIMITED','ERROR','OFFLINE'].includes(x.status)).length, wait=rs.filter(x=>x.status==='WAIT_KEY').length;
    const running=js.filter(x=>x.status==='running').length, done=js.filter(x=>x.status==='done').length, failed=js.filter(x=>x.status==='failed').length, total=done+failed;
    const success=total?`${Math.round(done*1000/total)/10}%`:'—'; const lats=rs.map(x=>Number(x.last_latency_ms)).filter(Number.isFinite); const avg=lats.length?`${(lats.reduce((a,b)=>a+b,0)/lats.length/1000).toFixed(1)}s`:'—';
    const rows=[['API/NV online',`${healthy}/${rs.length}`,`${ready} sẵn sàng · ${wait} chờ key`,''],['NV đang bận',busy,`${busy} công việc trực tiếp`,''],['Cảnh báo',alerts,alerts?'Cần chú ý':'Không có',alerts?'bad':''],['Chờ cấu hình key',wait,wait?'Cần thiết lập':'Đã đủ',wait?'warn':''],['Jobs đang chạy',running,`${js.filter(x=>x.status==='queued').length} đang chờ`,''],['Tỷ lệ thành công',success,total?'Theo dữ liệu job':'Chưa đủ dữ liệu',''],['Độ trễ trung bình',avg,lats.length?'Tài nguyên đã đo':'Chưa đủ dữ liệu',''],['Uptime',`${((d?.core?.uptimeSec||0)/3600).toFixed(1)}h`,`PID ${d?.core?.pid??'—'}`,'']];
    const el=document.getElementById('metrics'); if(el)el.innerHTML=rows.map(x=>`<div class="metric ${x[3]}"><div class="k">${safe(x[0])}</div><div class="v">${safe(x[1])}</div><div class="s">${safe(x[2])}</div></div>`).join('');
  }

  function renderPerformance(d){
    const box=document.getElementById('tqUChart'), count=document.getElementById('tqUChartCount'), legend=document.getElementById('tqULegend'); if(!box||!count||!legend)return;
    const pts=(d?.telemetry||[]).filter(x=>Number.isFinite(Number(x.latency_ms))).slice(-500); count.textContent=`${pts.length} mẫu`;
    if(pts.length<2){box.innerHTML='<div class="tq-u-chart-empty">Chưa đủ dữ liệu telemetry thật để vẽ biểu đồ.<br>Cần ít nhất 2 lần gọi API thành công.</div>';legend.innerHTML='';return;}
    const vals=pts.map(x=>Number(x.latency_ms)),max=Math.max(...vals,1),sorted=[...vals].sort((a,b)=>a-b),p95=sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)],avg=Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
    const xy=vals.map((v,i)=>`${i*600/(vals.length-1)},${140-(v/max)*115}`).join(' '),p95y=140-(p95/max)*115;
    box.innerHTML=`<svg viewBox="0 0 600 150" preserveAspectRatio="none"><polyline fill="none" stroke="#38bdf8" stroke-width="3" points="${xy}"/><line x1="0" y1="${p95y}" x2="600" y2="${p95y}" stroke="#a855f7" stroke-width="2" stroke-dasharray="7 6"/></svg><div class="tq-u-tooltip">P95 ${(p95/1000).toFixed(1)}s<br>TB ${(avg/1000).toFixed(1)}s</div>`; legend.innerHTML='<span>● Độ trễ thực tế</span><span style="color:#c084fc">— P95</span>';
  }

  function renderActivity(d){
    const box=document.getElementById('tqUActivityBody'),state=document.getElementById('tqUActivityState'); if(!box||!state)return;
    const js=healthJobs(d), os=d?.objectives||[], byId=new Map(os.map(o=>[o.id,o]));
    const active=js.filter(j=>j.status==='running'||j.status==='queued').slice(0,4);
    if(active.length){
      const o=byId.get(active[0].objective_id)||os.find(x=>x.status==='active');
      const campaign=o?.metadata?.campaign, phase=campaign?.phases?.length?Math.min(Number(campaign.currentPhase||0)+1,campaign.phases.length):null;
      state.textContent=`ĐANG CHẠY · ${active.length} việc`;
      box.innerHTML=`<div style="display:grid;gap:8px"><div style="padding:10px 12px;border:1px solid #21689f;border-radius:10px;background:#0a213d"><b style="color:#62d8ff">${safe(o?.objective||'TigerIQ đang xử lý')}</b><div style="margin-top:5px;color:#8fa8c6">${phase?`Giai đoạn ${phase}/${campaign.phases.length} · ${safe(campaign.phases[phase-1]?.title||'')}`:'Mục tiêu đang hoạt động'}</div></div>${active.map(j=>`<div style="display:grid;grid-template-columns:110px minmax(0,1fr) 130px;gap:10px;align-items:center;padding:9px 12px;border-bottom:1px solid #173a60"><b>${safe(j.employee_id||'Đang phân công')}</b><span>${safe(j.title||'—')}</span><span style="text-align:right;color:${j.status==='running'?'#43d2ff':'#ffbc42'}">${j.status==='running'?'ĐANG CHẠY':'ĐANG CHỜ'} · ${safe(j.provider||'—')}</span></div>`).join('')}</div>`;
      return;
    }
    const o=os.find(x=>x.status==='completed');
    if(!o){state.textContent='RẢNH';box.innerHTML='<div class="tq-u-chart-empty">Chưa có mục tiêu vừa hoàn tất.</div>';return;}
    const related=js.filter(j=>j.objective_id===o.id), done=related.filter(j=>j.status==='done'), workers=[...new Set(done.map(j=>j.employee_id).filter(Boolean))];
    state.textContent='VỪA HOÀN TẤT';
    box.innerHTML=`<div style="padding:11px 12px;border:1px solid #176a55;border-radius:10px;background:#09281f"><div style="display:flex;justify-content:space-between;gap:12px"><b style="color:#69e6ac">✓ ${safe(o.objective||'Mục tiêu hoàn tất')}</b><span style="color:#8fa8c6">${safe(rel(o.updated_at))} trước</span></div><div style="margin-top:7px;color:#b7cbe1">${safe(o.summary||'Đã hoàn tất theo Core.')}</div><div style="margin-top:8px;color:#8fa8c6">${done.length} việc hoàn tất · NV: ${safe(workers.join(', ')||'—')} · Cập nhật ${safe(fmt(o.updated_at))}</div></div>`;
  }

  function renderRecentJobs(d){
    const body=document.getElementById('tqURecentJobs'),count=document.getElementById('tqUJobCount'); if(!body||!count)return; const js=healthJobs(d).slice(0,12); count.textContent=`${js.length} bản ghi gần nhất`;
    body.innerHTML=js.map(j=>`<tr><td>${safe(String(j.id||'').slice(0,18))}</td><td class="tq-u-job-title" title="${safe(j.title)}">${safe(j.title||'—')}</td><td>${safe(j.employee_id||'—')}</td><td>${safe(j.provider||'—')}</td><td class="tq-u-state ${safe(j.status)}">${safe(j.status==='done'?'HOÀN THÀNH':j.status==='failed'?'THẤT BẠI':j.status==='running'?'ĐANG CHẠY':j.status==='queued'?'CHỜ':j.status||'—')}</td><td>${safe(fmt(j.completed_at||j.started_at||j.created_at))}</td></tr>`).join('')||'<tr><td colspan="6" class="tq-u-empty">Chưa có công việc.</td></tr>';
  }

  const eventLabel=t=>({RESOURCE_PROBE_FAIL:'Kiểm tra API thất bại',RESOURCE_PROBE_OK:'API hoạt động trở lại',RESOURCE_FAILURE:'API xử lý lỗi',RESOURCE_SUCCESS:'API xử lý thành công',JOB_DONE:'Công việc hoàn tất',JOB_FAILED:'Công việc thất bại',JOB_CREATED:'Đã tạo công việc',MANAGER_ERROR:'AI Manager gặp lỗi',OBJECTIVE_CREATED:'Đã tạo mục tiêu',OBJECTIVE_COMPLETE:'Mục tiêu hoàn tất',OBJECTIVE_BLOCKED:'Mục tiêu bị chặn'}[t]||String(t||'').replaceAll('_',' '));
  function compactEvents(d){
    const out=[]; for(const e of (d?.events||[])){const key=[e.type,e.employee_id||'',e.job_id||'',e.data?.kind||''].join('|'),hit=out.find(x=>x._key===key);if(hit){hit._count++;continue;}out.push({...e,_key:key,_count:1});if(out.length>=20)break;}
    const preview=document.getElementById('eventsPreview'),full=document.getElementById('historyFull'); const row=e=>`<div class="event"><span class="ico">${/FAIL|ERROR/.test(e.type)?'!':/DONE|SUCCESS|PROBE_OK|COMPLETE/.test(e.type)?'✓':'i'}</span><div><b>${safe(eventLabel(e.type))}${e._count>1?` ×${e._count}`:''}</b><small>${safe(e.employee_id||e.job_id||'TigerIQ Core')} • ${safe(fmt(e.ts))}</small></div><time>${safe(rel(e.ts))}</time></div>`;
    if(preview)preview.innerHTML=out.slice(0,10).map(row).join('')||'<div class="placeholder">Chưa có sự kiện.</div>'; if(full)full.innerHTML=out.map(row).join('')||'<div class="placeholder">Chưa có sự kiện.</div>';
  }

  function updateLiveSync(){const el=document.getElementById('tqULiveSync');if(!el)return;if(!window.S?.lastOk){el.textContent='Đang đồng bộ…';return;}const age=Math.max(0,Math.floor((Date.now()-S.lastOk)/1000));el.textContent=age>6?`Dữ liệu cũ · ${age}s`:`Đồng bộ ${new Date(S.lastOk).toLocaleTimeString('vi-VN',{hour12:false})} · ${age}s`;el.style.color=age>6?'#ff9aa4':'#9db7d6';}

  mountUnifiedOverview();
  if(typeof workerCard==='function')workerCard=richWorkerCard;
  if(typeof renderMetrics==='function')renderMetrics=renderUnifiedMetrics;
  const priorRender=typeof render==='function'?render:null;
  if(priorRender){render=function renderUnified(d){priorRender(d);mountUnifiedOverview();renderUnifiedMetrics(d);renderPerformance(d);renderActivity(d);renderRecentJobs(d);compactEvents(d);updateLiveSync();};}
  if(window.S?.data){if(typeof renderWorkers==='function')renderWorkers(S.data);renderUnifiedMetrics(S.data);renderPerformance(S.data);renderActivity(S.data);renderRecentJobs(S.data);compactEvents(S.data);}
  setInterval(updateLiveSync,1000);
})();
