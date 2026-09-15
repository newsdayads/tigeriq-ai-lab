// OWNER_DIRECT #767 + #777 — single Web Control projection over Core truth; API Health remains a temporary prototype source only.
(() => {
  if (window.__tigerIqUnifiedWebControl) return;
  window.__tigerIqUnifiedWebControl = true;

  const STATUS = {IDLE:'RẢNH',BUSY:'ĐANG LÀM',READY:'SẴN SÀNG',WAIT_KEY:'CHỜ KEY',RATE_LIMITED:'HẾT HẠN MỨC',OFFLINE:'NGOẠI TUYẾN',ERROR:'LỖI',DISABLED:'TẮT',ONLINE:'ONLINE'};
  const activeJobStates = new Set(['queued','running','review','waiting_ci','blocked']);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rel = value => { if (!value) return '—'; const sec=Math.max(0,Math.floor((Date.now()-new Date(value))/1000)); if(sec<60)return `${sec}s`; if(sec<3600)return `${Math.floor(sec/60)}p`; if(sec<86400)return `${Math.floor(sec/3600)}h`; return `${Math.floor(sec/86400)}d`; };
  const jobsOf = d => d?.codingLane?.jobs?.length ? d.codingLane.jobs : (d?.jobs || []);
  const profileLabel = (d, profile) => d?.routing?.profiles?.[profile] || profile || 'Tự động';

  function quotaSummary(r) {
    const q=r?.quota_state && typeof r.quota_state==='object' ? r.quota_state : {};
    if (q.known === true && Number.isFinite(Number(q.remainingRatio))) return `Hạn mức còn ${Math.round(Number(q.remainingRatio)*100)}%`;
    if (q.usable === false) return q.resetAt ? `Tạm khóa · phục hồi ${rel(q.resetAt)}` : 'Tạm khóa do giới hạn';
    return 'Hạn mức chưa có dữ liệu';
  }

  function mountUnifiedOverview() {
    const overview = document.querySelector('.page[data-view="overview"]');
    if (!overview || overview.querySelector('.tq-u-overview')) return;
    const metrics = document.getElementById('metrics');
    const oldGrid = overview.querySelector('.grid-top');
    const board = overview.querySelector('.board');
    const pipeline = document.getElementById('pipeline')?.closest('.panel');
    const objective = document.getElementById('objectivePreview')?.closest('.panel');
    const events = document.getElementById('eventsPreview')?.closest('.panel');
    const architecture = overview.querySelector('.org')?.closest('.panel');
    if (!metrics || !oldGrid || !board || !pipeline || !objective || !events) return;

    const grid = document.createElement('div');
    grid.className = 'tq-u-overview';
    const main = document.createElement('div'); main.className = 'tq-u-main';
    const side = document.createElement('aside'); side.className = 'tq-u-side';

    const recent = document.createElement('section');
    recent.className = 'tq-u-panel';
    recent.innerHTML = '<div class="tq-u-ph"><div><h2>▤ Công việc gần nhất</h2><small>Ưu tiên việc đang chạy trước lịch sử hoàn tất</small></div><span id="tqUJobCount" class="tq-u-healthline">—</span></div><div class="table-wrap"><table class="tq-u-jobs"><thead><tr><th>Công việc</th><th>NV</th><th>Tài nguyên</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead><tbody id="tqURecentJobs"></tbody></table></div>';

    const perf = document.createElement('section');
    perf.className = 'tq-u-panel';
    perf.innerHTML = '<div class="tq-u-ph"><div><h2>⌁ Hiệu suất API</h2><small>Độ trễ thật từ Core</small></div><span id="tqUChartCount" class="tq-u-healthline">—</span></div><div class="tq-u-body"><div id="tqUChart" class="tq-u-chart"><div class="tq-u-chart-empty">Đang chờ dữ liệu…</div></div><div id="tqULegend" class="tq-u-legend"></div></div>';

    const routing = document.createElement('section');
    routing.className = 'tq-u-panel';
    routing.innerHTML = '<div class="tq-u-ph"><div><h2>⇄ Định tuyến AI</h2><small>Quyết định gần nhất từ Core</small></div><span id="tqURouteProfile" class="tq-u-healthline">—</span></div><div id="tqURouting" class="tq-u-body tq-u-routing"><div class="tq-u-empty">Chưa có quyết định định tuyến.</div></div>';

    const taskPerf = document.createElement('section');
    taskPerf.className = 'tq-u-panel';
    taskPerf.innerHTML = '<div class="tq-u-ph"><div><h2>◎ Hiệu suất theo loại việc</h2><small>Chỉ hiển thị thống kê có sự kiện thật</small></div><span id="tqUTaskPerfCount" class="tq-u-healthline">—</span></div><div class="table-wrap"><table class="tq-u-jobs tq-u-perf-table"><thead><tr><th>Tài nguyên</th><th>Loại việc</th><th>Đạt/Lỗi</th><th>Độ trễ TB</th><th>Thử lại/Chuyển tuyến</th></tr></thead><tbody id="tqUTaskPerf"></tbody></table></div>';

    main.append(board, recent, taskPerf);
    side.append(perf, routing, pipeline, objective, events);
    grid.append(main, side);
    metrics.insertAdjacentElement('afterend', grid);

    if (architecture) {
      const peoplePage = document.querySelector('.page[data-view="people"]');
      architecture.classList.add('tq-u-architecture');
      if (peoplePage) peoplePage.appendChild(architecture);
    }
    oldGrid.remove();
  }

  function mountResourcePanel() {
    const peoplePage = document.querySelector('.page[data-view="people"]');
    const peoplePanel = document.getElementById('peopleFull')?.closest('.panel');
    if (!peoplePage || !peoplePanel || document.getElementById('tqUResources')) return;
    const subtitle = peoplePanel.querySelector('.ph small');
    if (subtitle) subtitle.textContent = 'Danh sách NV canonical theo Registry';
    const panel = document.createElement('section');
    panel.className = 'panel tq-u-resources-panel';
    panel.style.marginTop = '12px';
    panel.innerHTML = '<div class="ph"><div><h2>Tài nguyên AI</h2><small>Resource identity riêng theo provider / model / runtime</small></div><span id="tqUResourceCount">—</span></div><div class="workers" id="tqUResources"></div>';
    peoplePanel.insertAdjacentElement('afterend', panel);
  }

  function richResourceCard(r) {
    const ok = Number(r.calls_success_24h || 0);
    const fail = Number(r.calls_failure_24h || 0);
    const total = ok + fail;
    const rate = total ? Math.round(ok * 100 / total) : null;
    const latency = Number.isFinite(Number(r.last_latency_ms)) ? `${Math.round(Number(r.last_latency_ms))} ms` : '—';
    const cooldownMs = r.cooldown_until ? new Date(r.cooldown_until).getTime() - Date.now() : 0;
    const cooldown = cooldownMs > 0 ? `<div class="tq-u-error">Thử lại sau ~${Math.max(1,Math.ceil(cooldownMs/60000))} phút</div>` : '';
    const err = r.last_error ? `<div class="tq-u-error" title="${safe(r.last_error)}">Lỗi cuối: ${safe(r.last_error)}</div>` : '';
    const resourceId = r.resource_id || `legacy:${r.employee_id || r.provider || 'unknown'}`;
    return `<article class="worker" data-provider="${safe(r.provider)}" data-status="${safe(r.status)}"><div class="worker-head"><span class="worker-id">${safe(r.employee_id || '—')} — ${safe(r.name)}</span><span class="${CLASS?.[r.status] || 'gray'}">●</span></div><div class="tq-u-resource-id" title="${safe(resourceId)}">${safe(resourceId)}</div><div class="tq-u-provider">${safe(r.provider || '—')}</div><div class="tq-u-model" title="${safe(r.model || '')}">${safe(r.model || 'Chưa có model')}</div><div class="status ${CLASS?.[r.status] || 'gray'}"><span class="dot"></span>${safe(STATUS[r.status] || r.status)}</div><div class="kv"><span>Job hiện tại</span><span>${safe(r.current_job_id || '—')}</span></div><div class="kv"><span>Lần cuối</span><span>${safe(rel(r.last_seen_at))}</span></div><div class="kv"><span>Độ trễ</span><span>${safe(latency)}</span></div><div class="kv"><span>Hạn mức</span><span title="${safe(r.quota_state?.sourceConfidence || 'low')}">${safe(quotaSummary(r))}</span></div><div class="tq-u-success"><span>24h</span><b>${rate == null ? 'Chưa đủ dữ liệu' : `${rate}% · ${ok} đạt/${fail} lỗi`}</b></div>${rate == null ? '' : `<div class="tq-u-bar"><i style="width:${Math.max(0,Math.min(100,rate))}%"></i></div>`}${cooldown}${err}</article>`;
  }

  function canonicalEmployees(d) {
    const priority = {BUSY:0,ERROR:1,RATE_LIMITED:2,WAIT_KEY:3,OFFLINE:4,READY:5,IDLE:6,ONLINE:7,DISABLED:8};
    const rows = new Map();
    for (const resource of (d?.resources || [])) {
      if (!resource.employee_id) continue;
      const current = rows.get(resource.employee_id);
      const nextRank = priority[resource.status] ?? 99;
      const currentRank = current ? (priority[current.status] ?? 99) : 999;
      if (!current || nextRank < currentRank) rows.set(resource.employee_id, resource);
    }
    return [...rows.values()];
  }

  function renderCanonicalWorkers(d) {
    const employees = canonicalEmployees(d);
    const html = employees.map(workerCard).join('') || '<div class="placeholder">Chưa có dữ liệu nhân sự.</div>';
    const overview = document.getElementById('workers');
    const full = document.getElementById('peopleFull');
    const strip = document.getElementById('resourceStrip');
    if (overview) overview.innerHTML = html;
    if (full) full.innerHTML = html;
    if (strip) strip.innerHTML = (d?.resources || []).map(miniResource).join('');
    if (typeof applyWorkerFilter === 'function') applyWorkerFilter();
  }

  function renderResources(d) {
    mountResourcePanel();
    const box = document.getElementById('tqUResources');
    const count = document.getElementById('tqUResourceCount');
    if (!box || !count) return;
    const resources = d?.resources || [];
    count.textContent = `${resources.length} resource`;
    box.innerHTML = resources.map(richResourceCard).join('') || '<div class="placeholder">Chưa có tài nguyên AI.</div>';
  }

  function renderUnifiedMetrics(d) {
    const resources = d?.resources || [];
    const jobs = jobsOf(d);
    const online = resources.filter(r => ['IDLE','BUSY','READY','ONLINE'].includes(r.status)).length;
    const busy = resources.filter(r => r.status === 'BUSY').length;
    const warnings = resources.filter(r => ['ERROR','OFFLINE','RATE_LIMITED','WAIT_KEY'].includes(r.status)).length + jobs.filter(j => ['failed','blocked'].includes(j.status)).length;
    const running = jobs.filter(j => activeJobStates.has(j.status)).length;
    const done = jobs.filter(j => j.status === 'done').length;
    const failed = jobs.filter(j => ['failed','blocked'].includes(j.status)).length;
    const completed = done + failed;
    const success = completed ? `${Math.round(done * 1000 / completed) / 10}%` : '—';
    const lats = resources.map(r => Number(r.last_latency_ms)).filter(Number.isFinite);
    const avg = lats.length ? `${Math.round(lats.reduce((a,b)=>a+b,0)/lats.length)} ms` : '—';
    const webOk = typeof latestWebHealth !== 'undefined' && latestWebHealth?.ok === true;
    const rows = [
      ['Core', d?.core?.pid ? 'ONLINE':'OFFLINE', d?.core?.pid ? `PID ${d.core.pid}`:'Không có PID', d?.core?.pid ? '' : 'bad'],
      ['Web Control', webOk ? 'ONLINE':'CHECK', webOk ? 'Giao diện quản lý chính':'Đang kiểm tra', webOk ? '' : 'warn'],
      ['NV/API online', `${online}/${resources.length}`, resources.length ? `${Math.round(online*100/resources.length)}% sẵn sàng`:'Chưa có dữ liệu', ''],
      ['Đang bận', busy, busy ? 'Có công việc trực tiếp':'Không có việc', busy ? 'warn':''],
      ['Cảnh báo', warnings, warnings ? 'Cần chú ý':'Không có cảnh báo', warnings ? 'bad':''],
      ['Jobs đang chạy', running, `${jobs.filter(j=>j.status==='queued').length} đang chờ`, ''],
      ['Tỷ lệ thành công', success, 'Theo job đã kết thúc', ''],
      ['Độ trễ trung bình', avg, lats.length ? `${lats.length} tài nguyên đã đo`:'Chưa đủ dữ liệu', ''],
      ['Uptime', `${Math.floor((d?.core?.uptimeSec||0)/3600)}h`, `${Math.floor((d?.core?.uptimeSec||0)/86400)} ngày`, '']
    ];
    const el=document.getElementById('metrics');
    if (el) el.innerHTML=rows.map(x=>`<div class="metric ${x[3]}"><div class="k">${safe(x[0])}</div><div class="v">${safe(x[1])}</div><div class="s">● ${safe(x[2])}</div></div>`).join('');
  }

  function renderPerformance(d) {
    const box=document.getElementById('tqUChart'); const count=document.getElementById('tqUChartCount'); const legend=document.getElementById('tqULegend');
    if (!box || !count || !legend) return;
    const pts=(d?.telemetry || []).filter(x=>Number.isFinite(Number(x.latency_ms))).slice(-500);
    count.textContent=`${pts.length} mẫu`;
    if (pts.length<2) { box.innerHTML='<div class="tq-u-chart-empty">Chưa đủ dữ liệu thật để vẽ biểu đồ.</div>'; legend.innerHTML=''; return; }
    const vals=pts.map(x=>Number(x.latency_ms)); const max=Math.max(...vals,1); const sorted=[...vals].sort((a,b)=>a-b); const p95=sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]; const avg=Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
    const xy=vals.map((v,i)=>`${i*600/(vals.length-1)},${170-(v/max)*140}`).join(' '); const p95y=170-(p95/max)*140;
    box.innerHTML=`<svg viewBox="0 0 600 185" preserveAspectRatio="none" aria-label="Biểu đồ độ trễ API"><polyline fill="none" stroke="#38bdf8" stroke-width="3" points="${xy}"/><line x1="0" y1="${p95y}" x2="600" y2="${p95y}" stroke="#a855f7" stroke-width="2" stroke-dasharray="7 6"/></svg><div class="tq-u-tooltip">P95 ${Math.round(p95)} ms<br>TB ${avg} ms</div>`;
    legend.innerHTML='<span>● Độ trễ thực tế</span><span style="color:#c084fc">— P95</span>';
  }

  function renderRouting(d) {
    const box=document.getElementById('tqURouting'); const badge=document.getElementById('tqURouteProfile'); if(!box||!badge)return;
    const rows=d?.routing?.routingDecisions || [];
    const latest=rows[0];
    const decision=latest?.data?.decision || latest?.data || null;
    const profile=decision?.profile || latest?.data?.profile || 'AUTO';
    badge.textContent=latest ? profileLabel(d,profile) : 'Chưa có dữ liệu';
    const failover=(d?.events || []).find(e=>e.type==='ROUTING_FAILOVER');
    if(!latest){box.innerHTML='<div class="tq-u-empty">Chưa có quyết định định tuyến thật từ Core.</div>';return;}
    const chosen=decision?.chosen || {};
    const reasons=Array.isArray(chosen.reasons)?chosen.reasons.join(' · '):'—';
    box.innerHTML=`<div class="tq-u-route-grid"><div><small>Loại việc</small><b>${safe(latest.task_kind || decision?.taskKind || 'general')}</b></div><div><small>Hồ sơ</small><b>${safe(profileLabel(d,profile))}</b></div><div><small>Tài nguyên chọn</small><b>${safe(chosen.resourceId || latest.resource_id || '—')}</b></div><div><small>Nhà cung cấp</small><b>${safe(chosen.provider || latest.data?.provider || '—')}</b></div></div><div class="tq-u-route-reason"><small>Lý do chọn</small><span>${safe(reasons)}</span></div><div class="tq-u-route-reason"><small>Chuyển tuyến gần nhất</small><span>${failover ? `${safe(failover.resource_id || failover.employee_id || '—')} · ${safe(failover.data?.kind || 'không rõ')} · ${safe(rel(failover.ts))}` : 'Chưa có sự kiện chuyển tuyến'}</span></div>`;
  }

  function renderTaskPerformance(d) {
    const body=document.getElementById('tqUTaskPerf'); const count=document.getElementById('tqUTaskPerfCount'); if(!body||!count)return;
    const rows=d?.routing?.performanceByTask || [];
    count.textContent=`${rows.length} dòng`;
    body.innerHTML=rows.map(r=>`<tr><td title="${safe(r.resource_id)}">${safe(r.resource_id || '—')}</td><td>${safe(r.task_kind || 'general')}</td><td>${safe(`${Number(r.success||0)} / ${Number(r.failure||0)}`)}</td><td>${r.avg_latency_ms == null ? '—' : `${safe(r.avg_latency_ms)} ms`}</td><td>${safe(`${Number(r.retries||0)} / ${Number(r.failovers||0)}`)}</td></tr>`).join('') || '<tr><td colspan="5" class="tq-u-empty">Chưa có dữ liệu hiệu suất thật theo loại việc.</td></tr>';
  }

  function renderRecentJobs(d) {
    const body=document.getElementById('tqURecentJobs'); const count=document.getElementById('tqUJobCount'); if(!body||!count)return;
    const jobs=[...jobsOf(d)].sort((a,b)=>{const aa=activeJobStates.has(a.status)?0:1, bb=activeJobStates.has(b.status)?0:1; if(aa!==bb)return aa-bb; return new Date(b.updated_at||b.completed_at||b.started_at||b.created_at||0)-new Date(a.updated_at||a.completed_at||a.started_at||a.created_at||0)}).slice(0,8);
    count.textContent=`${jobs.length} việc`;
    body.innerHTML=jobs.map(j=>`<tr><td class="tq-u-job-title" title="${safe(j.title)}">${safe(j.title || j.id)}</td><td>${safe(j.employee_id || '—')}</td><td title="${safe(j.resource_id || '')}">${safe(j.resource_id || '—')}</td><td class="tq-u-state ${safe(j.status)}">${safe(j.status || '—')}</td><td>${safe(rel(j.updated_at||j.completed_at||j.started_at||j.created_at))}</td></tr>`).join('') || '<tr><td colspan="5" class="tq-u-empty">Không có công việc gần đây.</td></tr>';
  }

  function compactEvents(d) {
    const source=d?.events || []; const seen=new Map(); const out=[];
    for (const e of source) { const key=[e.type,e.resource_id||e.employee_id||'',e.job_id||'',e.data?.kind||''].join('|'); if(seen.has(key)){seen.get(key)._count++;continue;} const copy={...e,_count:1}; seen.set(key,copy); out.push(copy); if(out.length>=20) break; }
    const preview=document.getElementById('eventsPreview'); const full=document.getElementById('historyFull');
    const row=e=>`<div class="event"><span class="ico">${/FAIL|ERROR/.test(e.type)?'!':/DONE|SUCCESS|OK|COMPLETE/.test(e.type)?'✓':'•'}</span><div><b>${safe(e.type)}${e._count>1?` ×${e._count}`:''}</b><small>${safe(e.resource_id||e.employee_id||e.job_id||e.objective_id||'TigerIQ Core')}</small></div><time>${safe(rel(e.ts))}</time></div>`;
    if(preview) preview.innerHTML=out.slice(0,10).map(row).join('')||'<div class="placeholder">Chưa có sự kiện.</div>';
    if(full) full.innerHTML=out.map(row).join('')||'<div class="placeholder">Chưa có sự kiện.</div>';
  }

  mountUnifiedOverview();
  mountResourcePanel();
  if (typeof renderWorkers === 'function') renderWorkers = renderCanonicalWorkers;
  if (typeof renderMetrics === 'function') renderMetrics = renderUnifiedMetrics;
  const priorRender = typeof render === 'function' ? render : null;
  if (priorRender) {
    render = function renderUnified(d) {
      priorRender(d);
      mountUnifiedOverview();
      renderUnifiedMetrics(d);
      renderResources(d);
      renderPerformance(d);
      renderRouting(d);
      renderTaskPerformance(d);
      renderRecentJobs(d);
      compactEvents(d);
    };
  }
  if (window.S?.data) {
    if (typeof renderWorkers === 'function') renderWorkers(S.data);
    renderUnifiedMetrics(S.data); renderResources(S.data); renderPerformance(S.data); renderRouting(S.data); renderTaskPerformance(S.data); renderRecentJobs(S.data); compactEvents(S.data);
  }
})();