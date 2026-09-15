// #777 — Smart Router projection layered after unified + canonical workforce UI.
(() => {
  if (window.__tigerIqRoutingProjection) return;
  window.__tigerIqRoutingProjection = true;

  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rel = value => { if (!value) return '—'; const sec=Math.max(0,Math.floor((Date.now()-new Date(value))/1000)); if(sec<60)return `${sec}s`; if(sec<3600)return `${Math.floor(sec/60)}p`; if(sec<86400)return `${Math.floor(sec/3600)}h`; return `${Math.floor(sec/86400)}d`; };
  const profileLabel = (d, profile) => d?.routing?.profiles?.[profile] || profile || 'AUTO';

  function quotaSummary(resource) {
    const q=resource?.quota_state && typeof resource.quota_state==='object' ? resource.quota_state : {};
    if (q.known === true && Number.isFinite(Number(q.remainingRatio))) return `Còn ${Math.round(Number(q.remainingRatio)*100)}%`;
    if (q.usable === false) return q.resetAt ? `Tạm khóa · ${rel(q.resetAt)}` : 'Tạm khóa do giới hạn';
    return 'Chưa có dữ liệu';
  }

  function mountPanels() {
    const overview=document.querySelector('.page[data-view="overview"]');
    const main=overview?.querySelector('.tq-u-main');
    const side=overview?.querySelector('.tq-u-side');
    if (main && !document.getElementById('tqUTaskPerf')) {
      const taskPerf=document.createElement('section');
      taskPerf.className='tq-u-panel tq-routing-panel';
      taskPerf.innerHTML='<div class="tq-u-ph"><div><h2>◎ Hiệu suất theo loại việc</h2><small>Chỉ hiển thị dữ liệu thực từ Core</small></div><span id="tqUTaskPerfCount" class="tq-u-healthline">—</span></div><div class="table-wrap"><table class="tq-u-jobs tq-u-perf-table"><thead><tr><th>Tài nguyên</th><th>Loại việc</th><th>Đạt/Lỗi</th><th>Độ trễ TB</th><th>Thử lại/Chuyển tuyến</th></tr></thead><tbody id="tqUTaskPerf"></tbody></table></div>';
      main.append(taskPerf);
    }
    if (side && !document.getElementById('tqURouting')) {
      const routing=document.createElement('section');
      routing.className='tq-u-panel tq-routing-panel';
      routing.innerHTML='<div class="tq-u-ph"><div><h2>⇄ Định tuyến AI</h2><small>Quyết định gần nhất từ Core</small></div><span id="tqURouteProfile" class="tq-u-healthline">—</span></div><div id="tqURouting" class="tq-u-body tq-u-routing"><div class="tq-u-empty">Chưa có quyết định định tuyến thật từ Core.</div></div>';
      const first=side.firstElementChild;
      first?.insertAdjacentElement('afterend',routing) || side.prepend(routing);
    }
    const peoplePage=document.querySelector('.page[data-view="people"]');
    const peoplePanel=document.getElementById('peopleFull')?.closest('.panel');
    if (peoplePage && peoplePanel && !document.getElementById('tqUResources')) {
      const panel=document.createElement('section');
      panel.className='panel tq-u-resources-panel';
      panel.innerHTML='<div class="ph"><div><h2>Tài nguyên AI</h2><small>Resource identity riêng theo provider / model / runtime</small></div><span id="tqUResourceCount">—</span></div><div class="tq-resource-grid" id="tqUResources"></div>';
      peoplePanel.insertAdjacentElement('afterend',panel);
    }
    const recent=document.getElementById('tqURecentJobs')?.closest('table');
    const headRow=recent?.querySelector('thead tr');
    if (headRow && !headRow.querySelector('[data-routing-resource]')) {
      const headers=[...headRow.children];
      const th=document.createElement('th'); th.dataset.routingResource='1'; th.textContent='Tài nguyên';
      const providerIndex=headers.findIndex(x=>x.textContent?.trim()==='Nhà cung cấp');
      if (providerIndex>=0) headRow.insertBefore(th,headers[providerIndex]); else headRow.append(th);
    }
  }

  function resourceCard(r) {
    const ok=Number(r.calls_success_24h??r.success_count??0),fail=Number(r.calls_failure_24h??r.failure_count??0),total=ok+fail;
    const rate=total?Math.round(ok*100/total):null;
    const id=r.resource_id||`legacy:${r.employee_id||r.provider||'unknown'}`;
    const latency=Number.isFinite(Number(r.last_latency_ms))?`${Math.round(Number(r.last_latency_ms))} ms`:'—';
    return `<article class="tq-resource-card" data-provider="${safe(r.provider)}" data-status="${safe(r.status)}"><div class="tq-resource-head"><strong>${safe(r.employee_id||'—')} · ${safe(r.name||r.provider||'Resource')}</strong><span>${safe(r.status||'—')}</span></div><div class="tq-resource-id" title="${safe(id)}">${safe(id)}</div><div class="tq-resource-model">${safe(r.provider||'—')} · ${safe(r.model||'Chưa có model')}</div><div class="tq-resource-kv"><span>Hạn mức</span><b>${safe(quotaSummary(r))}</b></div><div class="tq-resource-kv"><span>Độ trễ</span><b>${safe(latency)}</b></div><div class="tq-resource-kv"><span>24h</span><b>${rate==null?'Chưa đủ dữ liệu':`${rate}% · ${ok}/${fail}`}</b></div></article>`;
  }

  function renderResources(d) {
    const box=document.getElementById('tqUResources'),count=document.getElementById('tqUResourceCount');
    if(!box||!count)return;
    const resources=d?.resources||[];
    count.textContent=`${resources.length} resource`;
    box.innerHTML=resources.map(resourceCard).join('')||'<div class="tq-u-empty">Chưa có tài nguyên AI.</div>';
  }

  function renderRouting(d) {
    const box=document.getElementById('tqURouting'),badge=document.getElementById('tqURouteProfile'); if(!box||!badge)return;
    const rows=d?.routing?.routingDecisions||[];
    const latest=rows[0];
    const decision=latest?.data?.decision||latest?.data||null;
    const profile=decision?.profile||latest?.data?.profile||'AUTO';
    badge.textContent=latest?profileLabel(d,profile):'Chưa có dữ liệu';
    if(!latest){box.innerHTML='<div class="tq-u-empty">Chưa có quyết định định tuyến thật từ Core.</div>';return;}
    const chosen=decision?.chosen||{};
    const reasons=Array.isArray(chosen.reasons)?chosen.reasons.join(' · '):'—';
    const failover=(d?.events||[]).find(e=>e.type==='ROUTING_FAILOVER');
    box.innerHTML=`<div class="tq-u-route-grid"><div><small>Loại việc</small><b>${safe(latest.task_kind||decision?.taskKind||'general')}</b></div><div><small>Hồ sơ</small><b>${safe(profileLabel(d,profile))}</b></div><div><small>Tài nguyên chọn</small><b>${safe(chosen.resourceId||latest.resource_id||'—')}</b></div><div><small>Nhà cung cấp</small><b>${safe(chosen.provider||latest.data?.provider||'—')}</b></div></div><div class="tq-u-route-reason"><small>Lý do chọn</small><span>${safe(reasons)}</span></div><div class="tq-u-route-reason"><small>Chuyển tuyến gần nhất</small><span>${failover?`${safe(failover.resource_id||failover.employee_id||'—')} · ${safe(failover.data?.kind||'không rõ')} · ${safe(rel(failover.ts))}`:'Chưa có sự kiện chuyển tuyến'}</span></div>`;
  }

  function renderTaskPerformance(d) {
    const body=document.getElementById('tqUTaskPerf'),count=document.getElementById('tqUTaskPerfCount'); if(!body||!count)return;
    const rows=d?.routing?.performanceByTask||[];
    count.textContent=`${rows.length} dòng`;
    body.innerHTML=rows.map(r=>`<tr><td title="${safe(r.resource_id)}">${safe(r.resource_id||'—')}</td><td>${safe(r.task_kind||'general')}</td><td>${safe(`${Number(r.success||0)} / ${Number(r.failure||0)}`)}</td><td>${r.avg_latency_ms==null?'—':`${safe(r.avg_latency_ms)} ms`}</td><td>${safe(`${Number(r.retries||0)} / ${Number(r.failovers||0)}`)}</td></tr>`).join('')||'<tr><td colspan="5" class="tq-u-empty">Chưa có dữ liệu hiệu suất thật theo loại việc.</td></tr>';
  }

  function renderRecentJobsWithResource(d) {
    const body=document.getElementById('tqURecentJobs'); if(!body)return;
    const jobs=(d?.jobs||[]).slice(0,12);
    body.innerHTML=jobs.map(j=>`<tr><td>${safe(String(j.id||'').slice(0,18))}</td><td class="tq-u-job-title" title="${safe(j.title)}">${safe(j.title||'—')}</td><td>${safe(j.employee_id||'—')}</td><td title="${safe(j.resource_id||'')}">${safe(j.resource_id||'—')}</td><td>${safe(j.provider||'—')}</td><td class="tq-u-state ${safe(j.status)}">${safe(j.status==='done'?'HOÀN THÀNH':j.status==='failed'?'THẤT BẠI':j.status==='running'?'ĐANG CHẠY':j.status==='queued'?'CHỜ':j.status||'—')}</td><td>${safe(rel(j.completed_at||j.started_at||j.created_at))}</td></tr>`).join('')||'<tr><td colspan="7" class="tq-u-empty">Chưa có công việc.</td></tr>';
  }

  function renderRoutingProjection(d) {
    mountPanels();
    renderResources(d);
    renderRouting(d);
    renderTaskPerformance(d);
    renderRecentJobsWithResource(d);
  }

  mountPanels();
  const priorRender=typeof render==='function'?render:null;
  if(priorRender) render=function renderWithRouting(d){priorRender(d);renderRoutingProjection(d);};
  if(window.S?.data) renderRoutingProjection(S.data);
})();
