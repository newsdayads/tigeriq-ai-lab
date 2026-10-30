import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {runInNewContext} from 'node:vm';

describe('#3918 API Health shared Work UI contract',()=>{
  const dashboard=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const live=readFileSync(new URL('../command-center.html',import.meta.url),'utf8');
  const livePublic=readFileSync(new URL('../public/command-center.html',import.meta.url),'utf8');
  const shared=readFileSync(new URL('../public/work-ui.css',import.meta.url),'utf8');
  const visual=readFileSync(new URL('../public/work-center-visual.css',import.meta.url),'utf8');
  const workCenter=readFileSync(new URL('../public/work-center.js',import.meta.url),'utf8');

  it('keeps verbose GitHub provenance and journal inside work details, not overview cards',()=>{
    const overview=workCenter.slice(workCenter.indexOf('function renderCards('),workCenter.indexOf('function auditMarkup('));
    const detail=workCenter.slice(workCenter.indexOf('function auditMarkup('),workCenter.indexOf('function renderAudit('));
    expect(overview).not.toContain('tiq-truth-source');
    expect(overview).not.toContain('Nhật ký GitHub');
    expect(overview).not.toContain('bước theo GitHub · chưa xác minh');
    expect(detail).toContain('NGUỒN GITHUB VÀ CORE');
    expect(detail).toContain('Nhật ký GitHub gần nhất');
    expect(detail).toContain('CHƯA XÁC MINH JOB SỐNG');
    expect(dashboard).toContain("TigerIQWorkCenter.renderAudit(document.getElementById('workDetailAudit')");
  });

  it('links the same approved card CSS last on Live, Health, Web Control',()=>{
    expect(dashboard).toContain('href="/work-center-visual.css"');
    expect(live).toContain('href="/work-center-visual.css"');
    expect(livePublic).toContain('href="/work-center-visual.css"');
    expect(core).toContain("url.pathname==='/work-center-visual.css'");
    expect(dashboard).toContain('TigerIQWorkCenter.renderCards(workList,rows,{compact:false,');
    expect(visual).toContain('grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr))');
    expect(visual).toContain('.tiq-work-card.status-done{--status-color:#06B6D4!important}');
  });

  it('uses one shared Work UI stylesheet on Live and API Health',()=>{
    expect(dashboard).toContain('href="/work-ui.css"');
    expect(live).toContain('href="/work-ui.css"');
    expect(livePublic).toContain('href="/work-ui.css"');
    expect(shared).toContain('.work-row,.wo-card');
    expect(shared).toContain('.work-title,.wo-title');
    expect(shared).toContain('.work-summary,.wo-current');
    expect(core).toContain("url.pathname==='/work-ui.css'");
    expect(core).toContain("url.pathname==='/api/live-status'");
    expect(core).toContain('async function liveStatusSnapshot()');
    expect(core).toContain("../../public/work-ui.css");
  });

  it('keeps API Health compact with two workforce rows and no dead top navigation',()=>{
    expect(dashboard).toContain('<body class="api-health">');
    expect(shared).toContain('.api-health .nav{display:none!important}');
    expect(shared).toContain('--employee-row-h:132px');
    expect(shared).toContain('max-height:calc(var(--employee-row-h) * 2 + var(--employee-gap) + 20px)');
    expect(shared).toContain('overflow-y:auto!important');
    expect(shared).toContain('.api-health .wo-list,.api-health .work-list{display:grid;gap:10px;grid-template-columns:repeat(2,minmax(0,1fr))');
    expect(dashboard).toContain('id="workList" class="wo-list work-list tiq-work-center"');
    expect(dashboard).toContain('TigerIQWorkCenter.renderCards(workList,rows');
    expect(workCenter).toContain('class="work-top"');
    expect(workCenter).toContain('class="work-title"');
    expect(workCenter).toContain('class="work-hierarchy"');
    expect(dashboard).not.toContain('.wo-card{');
    expect(dashboard).not.toContain('class="wo-card');
    expect(dashboard).toContain('function healthWorkProof(row,status)');
    expect(dashboard).toContain('function healthWorkQuick(row,status)');
    expect(dashboard).not.toContain('<div class="work-facts"><div><b>Vừa xong:</b>');
    expect(dashboard).toContain("while(/^\\[[^\\]]+\\]\\s*/.test(t))");
    expect(workCenter).toContain("'RÀ SOÁT':'REVIEW'");
    expect(workCenter).toContain("'ĐANG XỬ LÝ':'WORKING'");
    expect(workCenter).toContain("'ĐANG CHỜ':'WAITING'");
    expect(shared).toContain('/* #3918 visual parity R2');
    expect(shared).toContain('.work-row.status-review,.work-row.status-waiting,.work-row.status-verify');
    expect(shared).toContain('.work-row .state.review,.work-row .state.waiting,.work-row .state.verify');
    expect(shared).toContain('/* #3918 vivid API Health Work-card pass');
    expect(shared).toContain('.api-health .work-row.status-review');
    expect(shared).toContain('.api-health .work-row .state.review');
    expect(shared).toContain('@keyframes tiq-status-pulse');
    expect(shared).toContain('/* #3918 three-card work grid */');
    expect(shared).toContain('grid-template-columns:repeat(3,minmax(0,1fr))');
    expect(dashboard).toContain('function woProgress(x,s)');
    expect(workCenter).toContain('sourceGate!==false');
    expect(dashboard).toContain("kind:'checks'");
    expect(dashboard).toContain("kind:'stage'");
  });

  it('orders side panels performance then recent activity then alerts and uppercases headings',()=>{
    const perf=dashboard.indexOf('HIỆU SUẤT API 24 GIỜ');
    const activity=dashboard.indexOf('HOẠT ĐỘNG GẦN ĐÂY');
    const alerts=dashboard.indexOf('CẢNH BÁO HIỆN TẠI');
    expect(perf).toBeGreaterThan(-1);
    expect(activity).toBeGreaterThan(perf);
    expect(alerts).toBeGreaterThan(activity);
    expect(dashboard).toContain('TOÀN BỘ NHÂN SỰ / TÀI NGUYÊN AI');
    expect(dashboard).toContain('DANH SÁCH CÔNG VIỆC');
  });

  it('adds live motion without forcing animation for reduced-motion users',()=>{
    expect(shared).toContain('@keyframes tiq-work-live');
    expect(shared).toContain('@keyframes tiq-event-in');
    expect(shared).toContain('@media(prefers-reduced-motion:reduce)');
    expect(dashboard).toContain("let lastActivitySignature=''");
    expect(dashboard).toContain("classList.add('recent-activity')");
    expect(dashboard).toContain('class="sync-status"');
    expect(dashboard).toContain('brand-product">API HEALTH');
    expect(dashboard).not.toContain('id="clock"');
    expect(dashboard).toContain("topLive.querySelector('b').textContent='LIVE'");
    expect(dashboard).toContain("topLive.classList.add('offline')");
    expect(shared).toContain('/* #3918 4K Health layout pass */');
    expect(shared).toContain('grid-template-columns:repeat(5,minmax(0,1fr))');
    expect(shared).toContain('grid-template-columns:repeat(4,minmax(0,1fr))');
    expect(shared).toContain('.api-health .layout{grid-template-columns:minmax(0,3.55fr) minmax(285px,.82fr)');
    expect(shared).toContain('.api-health .side .panel-h h2{font-size:14px}');
    expect(shared).toContain('/* #3918 window-responsive density pass');
    expect(shared).toContain('@media(min-width:1450px)');
    expect(shared).toContain('.api-health .workers{grid-template-columns:repeat(5,minmax(0,1fr))!important}');
    expect(shared).toContain('.api-health .wo-list,.api-health .work-list{grid-template-columns:repeat(4,minmax(0,1fr))!important}');
    expect(shared).toContain('@media(min-width:1200px) and (max-width:1449px)');
    expect(shared).toContain('@media(min-width:900px) and (max-width:1199px)');
    expect(shared).toContain('/* #3918 Work-card detail parity with LIVE');
    expect(shared).toContain('.api-health .work-row.status-review .work-title');
    expect(shared).toContain('.work-detail-backdrop');
    expect(shared).toContain('.work-detail-modal');
    expect(dashboard).toContain('id="workDetailBackdrop"');
    expect(dashboard).toContain('id="workDetailGithub"');
    expect(dashboard).toContain('function openWorkDetail(row,trigger)');
    expect(workCenter).toContain('data-work-number');
    expect(dashboard).not.toContain('target="_blank" rel="noopener"><div class="work-main"');
    expect(shared).toContain('/* #3918 live-system activity pass */');
    expect(shared).toContain('.api-health .workforce-panel .panel-h h2');
    expect(shared).toContain('.api-health .work-panel .panel-h h2');
    expect(shared).toContain('.api-health .api-perf-panel .panel-h h2');
    expect(shared).toContain('.api-health .activity-panel .panel-h h2');
    expect(shared).toContain('.api-health .employee-live-line');
    expect(shared).toContain('@keyframes tiq-heartbeat');
    expect(shared).toContain('@keyframes tiq-worker-change');
    expect(shared).toContain('@keyframes tiq-page-scan');
    expect(dashboard).toContain('id="topLiveMeta"');
    expect(dashboard).toContain('id="workforceMeta"');
    expect(dashboard).toContain('id="activityMeta"');
    expect(dashboard).toContain('function refreshLiveUi()');
    expect(dashboard).toContain('function loadLiveStatus()');
    expect(dashboard).toContain("fetch('/api/live-status',{cache:'no-store'})");
    expect(dashboard).toContain('setInterval(load,5000)');
    expect(dashboard).toContain('setInterval(loadLiveStatus,1000)');
    expect(dashboard).toContain('lastCoreSuccessAt=Date.now()');
    expect(dashboard).toContain("mode=age<=5?'LIVE':age<=10?'DEGRADED':'OFFLINE'");
    expect(dashboard).toContain('employee-live-line');
    expect(dashboard).toContain('lastWorkerSignatures=new Map()');
    expect(dashboard).toContain('event cuối');
    expect(dashboard).toContain('event/phút');
    expect(shared).toContain('/* #3918 clipping audit fix */');
    expect(shared).toContain('--employee-row-h:156px');
    expect(shared).toContain('grid-auto-rows:minmax(var(--employee-row-h),auto)!important');
    expect(shared).toContain('height:auto!important;min-height:var(--employee-row-h)!important');
    expect(shared).toContain('.api-health .employee-task{display:block;white-space:normal;overflow:visible');
    expect(shared).toContain('.api-health .employee-task{display:block;white-space:normal;overflow:visible');
    expect(shared).toContain('/* #3918 final visual audit cleanup */');
    expect(shared).toContain('/* #3918 final viewport-fit + responsive rail */');
    expect(shared).toContain('overflow-x:hidden!important');
    expect(shared).toContain('grid-template-columns:minmax(0,1fr) minmax(270px,300px)!important');
    expect(shared).toContain('@media(min-width:1450px) and (max-width:1799px)');
    expect(shared).toContain('.api-health .work-next{');
    expect(shared).toContain('height:auto!important;');
    expect(shared).toContain('.api-health .metrics-lower .metric{');
  });

  it('#4383 keeps Work motion truthful and state-specific',()=>{
    expect(shared).toContain('/* #4383 truthful Work-card live motion V2 */');
    expect(shared).toContain('@keyframes tiq-work-card-working');
    expect(shared).toContain('@keyframes tiq-work-card-review');
    expect(shared).toContain('@keyframes tiq-work-card-waiting');
    expect(shared).toContain('@keyframes tiq-work-card-attention');
    expect(shared).toContain('@keyframes tiq-verified-progress-flow');
    expect(shared).toContain('.api-health .progress.stage-working .progress-fill');
    expect(shared).toContain('.api-health .progress.stage-waiting .progress-fill');
    expect(shared).toContain('.api-health .progress.stage-queued .progress-fill');
    expect(shared).toContain('.api-health .work-row.status-queued,');
    expect(shared).toContain('.api-health .work-row.status-open{');
    expect(shared).toContain('animation:none;');
    expect(shared).toContain('@media(prefers-reduced-motion:reduce)');
    expect(dashboard).toContain("p.pct===null?");
    expect(dashboard).toContain("class=\"progress stage stage-");
    expect(dashboard).toContain("style=\"width:${prog.pct}%\"");
    expect(dashboard).toContain("mode=age<=5?'LIVE':age<=10?'DEGRADED':'OFFLINE'");
  });


  it('#4413 bounds GitHub work-order projection fetch',()=>{
    const start=core.indexOf('async function githubWorkOrders()');
    const end=core.indexOf('let apiHealthProjectionCache',start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const segment=core.slice(start,end);
    expect(segment).toContain('await fetchJson(u,');
    expect(segment).toContain('},5000)');
    expect(segment).not.toContain('await fetch(u,');
  });


  it('P0 Health v3 reuses LIVE glow/contrast with scoped selectors, no runtime changes',()=>{
    expect(shared).toContain('TIGERIQ_HEALTH_LIVE_PARITY_V3');
    expect(shared).toContain('.api-health .topbar{');
    expect(shared).toContain('.api-health .workforce-panel .panel-h{');
    expect(shared).toContain('.api-health .worker.employee-card::before{');
    expect(shared).toContain('.api-health .work-row::before{');
    expect(shared).toContain('.api-health .worker.employee-card.state-working{--health-card-accent:var(--health-card-working)');
    expect(shared).toContain('@media(prefers-reduced-motion:reduce)');
    expect(shared).toContain('animation:none!important');
    expect(dashboard).toContain('setInterval(load,5000)');
    expect(dashboard).toContain('setInterval(loadLiveStatus,1000)');
    expect(dashboard).toContain("fetch('/api/live-status',{cache:'no-store'})");
  });


  it('P0 Health renders the LIVE work-list structure, eleven filters and verified GitHub gates',()=>{
    expect(dashboard).toContain("fetch('/api/health-live-work',{cache:'no-store'})");
    expect(core).toContain("url.pathname==='/api/health-live-work'");
    expect(core).toContain('async function apiHealthLiveWorkProjection()');
    expect(core).toContain("source:'LIVE_VERIFIED_GATES'");
    expect(core).toContain("source:'PC01_FALLBACK'");
    expect(core).toContain("const upstream=await fetchJson('https://tigeriq-ai-lab.vercel.app/api/live-status',{},14000)");
    expect(core).toContain('const pending=Promise.resolve().then(refreshApiHealthLiveWork)');
    expect(core).toContain('void pending.then(finish,finish)');
    expect(core).toContain('Date.parse(upstream.generatedAt)<previousTime');
    expect(core).toContain('healthLiveResultFresh(healthLiveWorkCache.result)');
    expect(core).toContain('verifiedGateSource:false');
    expect(core).toContain('source:\'PC01_FALLBACK\'');
    for(const token of ["['review','RÀ SOÁT']","['verify','XÁC MINH']","['ready','SẴN SÀNG']","['waiting','ĐANG CHỜ']","['blocked','BỊ CHẶN']","['paused','TẠM DỪNG']"]){
      expect(dashboard).toContain(token);
    }
    expect(dashboard).toContain('workProjection?.verifiedGateSource===true');
    expect(dashboard).toContain("source==='github_gates_verified'");
    expect(dashboard).toContain("row?.progressChecklistVerified===true");
    expect(dashboard).toContain('class="work-step-summary"');
    expect(dashboard).toContain('class="work-progress-bottom"');
    expect(workCenter).toContain('class="work-id"');
    expect(workCenter).toContain('class="work-hierarchy"');
    expect(dashboard).toContain('function healthWorkQuick(row,status)');
    expect(dashboard).toContain('function healthWorkIcon(status)');
    expect(dashboard).toContain('function openWorkDetail(row,trigger)');
    expect(shared).toContain('TIGERIQ_HEALTH_WORKLIST_LIVE_PARITY_P0');
    expect(shared).toContain('TIGERIQ_HEALTH_WORKLIST_COMPACT_P0');
    expect(shared).toContain('grid-auto-rows:max-content!important');
    expect(shared).toContain('align-items:start!important');
    expect(shared).toContain('.health-live-work-card .work-progress-bottom{');
    expect(shared).toContain('margin-top:8px!important');
    expect(shared).toContain('min-height:0!important');

    expect(shared).toContain('grid-template-columns:repeat(5,minmax(0,1fr))!important');
    expect(shared).toContain('.api-health .work-panel .health-live-work-card>.work-id');
    expect(shared).toContain('.api-health .work-panel .health-live-work-card .work-main');
    expect(shared).toContain('.api-health .work-panel .health-live-work-card .work-progress-bottom');
    expect(shared).toContain('@media(prefers-reduced-motion:reduce)');
  });

  it('round-trips legacy CP437 Vietnamese without changing valid text',()=>{
    const sandbox={TextDecoder};sandbox.window=sandbox;
    runInNewContext(workCenter,sandbox);
    const readable=sandbox.TigerIQWorkCenter.readableText;
    expect(readable('Chß╗ë nghiß╗çm thu to├án viß╗çc khi ho├án tß║Ñt')).toBe('Chỉ nghiệm thu toàn việc khi hoàn tất');
    expect(readable('R01ΓÇôR09')).toBe('R01–R09');
    expect(readable('Đã xác minh công việc')).toBe('Đã xác minh công việc');
    expect(readable('GITHUB · CORE')).toBe('GITHUB · CORE');
  });

  it('fixes legacy CP437 Vietnamese text, consistent card font and hides unverified start/end',()=>{
    expect(workCenter).toContain('function readableText(value)');
    expect(workCenter).toContain('CP437_REVERSE');
    expect(workCenter).toContain('const timingLine=(started||ended)');
    expect(workCenter).toContain("if(start)fields.push");
    expect(workCenter).toContain("if(end)fields.push");
    expect(dashboard).toContain('TigerIQWorkCenter.readableText');
    expect(shared).toContain('uniform readable card typography');
    expect(shared).toContain('font-size:14px!important');
    expect(shared).toContain('word-break:break-word!important');
  });

  it('renders two distinct DeXCam lists and hides raw markdown and blocker codes',()=>{
    expect(dashboard).toContain('id="workDetailExecutionSection"');
    expect(dashboard).toContain('QUY TRÌNH THỰC THI · KHÔNG TÍNH %');
    expect(dashboard).toContain('MỐC NGHIỆM THU');
    expect(dashboard).toContain("row?.executionPlanSource==='GITHUB_EXECUTION_ORDER'");
    expect(dashboard).toContain('function workDetailReadableBlocker(value)');
    expect(dashboard).toContain('workDetailBlocker.textContent=workDetailReadableBlocker');
    expect(dashboard).toContain('workDetailPlainText(value)');
    expect(dashboard).toContain('class="work-detail-step-source"');
  });

  it('renders four desktop work cards, hides duplicate project breadcrumbs and wraps steps on iPhone',()=>{
    expect(visual).toContain('OWNER_WORK_CARDS_4COL_IPHONE_20261030');
    expect(visual).toContain('grid-template-columns:repeat(4,minmax(0,1fr))!important');
    expect(visual).toContain('body.api-health #workList.tiq-work-center>.tiq-work-card[data-project-theme] .work-hierarchy');
    expect(visual).toContain('display:none!important;');
    expect(visual).toContain('.card-live-action-box>div:not(.action-header):not(.card-stepper-strip)');
    expect(visual).toContain('overflow-wrap:anywhere!important;word-break:break-word!important');
    expect(visual).toContain('@media(max-width:599px)');
    expect(visual).toContain('grid-template-columns:minmax(0,1fr)!important');
    expect(visual).toContain('@media(orientation:landscape) and (min-width:640px) and (max-width:1199px)');
    expect(live).toContain('name="viewport"');
    expect(dashboard).toContain('name="viewport"');
  });

});
