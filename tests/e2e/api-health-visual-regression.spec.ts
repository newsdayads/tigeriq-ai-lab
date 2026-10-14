import {test,expect,type Page,type Route} from '@playwright/test';
import {readFileSync} from 'node:fs';

test.use({channel:'chrome'});
const dashboard=readFileSync(new URL('../../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
const sharedCss=readFileSync(new URL('../../public/work-ui.css',import.meta.url),'utf8');
const workCenterJs=readFileSync(new URL('../../public/work-center.js',import.meta.url),'utf8');
const workCenterVisualCss=readFileSync(new URL('../../public/work-center-visual.css',import.meta.url),'utf8');
const base='https://api-health.tigeriq.test';
const recent=(seconds=1)=>new Date(Date.now()-seconds*1000).toISOString();
const ahead=(seconds=3600)=>new Date(Date.now()+seconds*1000).toISOString();

const work=[
 {number:3278,title:'Verified API work',url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/3278',workKind:'WORK',status:'RÀ SOÁT',priority:'P1',projectName:'Nền tảng TigerIQ',workstreamName:'Auto-RCA',jobId:'GH-3278',progressSource:'github_gates_verified',progressPercent:50,progressTotal:2,progressDone:1,progressChecklistVerified:true,currentStep:'Đã kiểm tra CI',nextStep:'Reviewer xác nhận'},
 {number:4574,title:'Work ready to execute',workKind:'WORK',status:'ĐANG CHỜ',executionEligibility:'READY',priority:'P2',projectName:'TigerIQ News',workstreamName:'Publisher',currentStep:'Sẵn sàng',nextStep:'Chờ người thực hiện'},
 {number:2054,title:'Blocked implementation',workKind:'WORK',status:'BỊ CHẶN',priority:'P0',blocker:'Thiếu quyền ngoài hệ thống'}
];
function fixtureStatus(stale=false){
 const ts=recent(stale?7200:1);
 return {ok:true,core:{time:ts,uptimeSec:200,pid:123},integrations:{},
   resources:[
    {employee_id:'NV09',resource_id:'NV09',name:'Local AI',provider:'ollama',model:'qwen',status:'BUSY',last_seen_at:ts,updated_at:ts,calls_success_24h:12,calls_failure_24h:0,last_latency_ms:100},
    {employee_id:'NV06',resource_id:'NV06',name:'OpenClaw',provider:'openclaw',model:'operator',status:'IDLE',last_seen_at:ts,updated_at:ts,calls_success_24h:11,calls_failure_24h:0,last_latency_ms:20},
    {employee_id:'NV14',resource_id:'NV14',name:'Mistral',provider:'mistral',model:'small',status:'RATE_LIMITED',cooldown_until:ahead(),last_seen_at:ts,last_latency_ms:900},
    {employee_id:'NV15',resource_id:'NV15',name:'Cloudflare',provider:'cloudflare',status:'ERROR',last_error:'Provider unavailable',last_seen_at:ts,last_latency_ms:300}
   ],
   workforce:['NV09','NV06','NV14','NV15'].map(employee_id=>({employee_id,name:employee_id,assigned:true,admin_state:'READY'})),
   jobs:[],events:Array.from({length:28},(_,i)=>({seq:String(100-i),ts:recent(i+1),type:i===0?'API_DOCTOR_SCAN':'RESOURCE_SUCCESS',employee_id:'NV06',resource_id:'NV06',data:{kind:'health',...(i===0?{repairIssueNumber:3278}:{})}})),
   telemetry:[{ts,employee_id:'NV06',type:'RESOURCE_SUCCESS'}]
 };
}
function projection(stale=false){return {ok:true,projection:{generatedAt:recent(stale?7200:1),stale,verifiedGateSource:true,
 openSummary:{open:work.length,actionable:work.length,review:1,waiting:1,done:0},openWork:work,recentWork:[],workers:[]}}}
async function openFixture(page:Page,stale=false){
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({status:204,body:''}));
 await page.route(base+'/**',async(r:Route)=>{
  const path=new URL(r.request().url()).pathname;
  if(path==='/')return r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:dashboard});
  if(path==='/work-ui.css')return r.fulfill({status:200,contentType:'text/css',body:sharedCss});
  if(path==='/work-center.js')return r.fulfill({status:200,contentType:'text/javascript',body:workCenterJs});
  if(path==='/work-center-visual.css')return r.fulfill({status:200,contentType:'text/css',body:workCenterVisualCss});
  if(path==='/api/status')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixtureStatus(stale))});
  if(path==='/api/health-live-work')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(projection(stale))});
  if(path==='/api/live-status')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,resources:[]})});
  return r.fulfill({status:204,body:''});
 });
 await page.goto(base+'/');
 await expect(page.locator('.work-row')).toHaveCount(3);
}

for(const width of [390,1024,1648]){
 test('API Health visual contract: cards, hover, modal at '+width+'px',async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});
  const jsErrors:string[]=[];page.on('pageerror',e=>jsErrors.push(e.message));
  await openFixture(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await expect(page.locator('.wo-filter.action')).toContainText('CÒN MỞ');
  await expect(page.locator('.wo-filter.action')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#opsFreshnessRows .ops-age')).toHaveCount(4);
  const css=await page.locator('body').evaluate(el=>{const s=getComputedStyle(el);return {surface:s.getPropertyValue('--tiq-surface').trim(),ready:s.getPropertyValue('--tiq-ready').trim(),working:s.getPropertyValue('--tiq-working').trim()}});
  expect(css).toEqual({surface:'#111C2E',ready:'#3B82F6',working:'#22C55E'});
  await page.locator('.filter[data-filter=all]').click();
  const employee=page.locator('.employee-card.state-ready').first();
  await expect(employee).toBeVisible();
  // API Health refreshes employee cards asynchronously. An element screenshot
  // waits for fonts/stability and can retain a detached node even after toBeVisible.
  // Capture its bounded screen region with Page.screenshot instead (no stale handle)
  // while independently requiring the actual ready card to be hovered.
  const normalBounds=await employee.boundingBox();
  expect(normalBounds).not.toBeNull();
  const normal=await page.screenshot({clip:normalBounds!,animations:'disabled'});
  await employee.hover();
  await expect.poll(async()=>page.locator('.employee-card.state-ready').first().evaluate(el=>el.matches(':hover')),{timeout:5000}).toBe(true);
  const hoverBounds=await employee.boundingBox();
  expect(hoverBounds).not.toBeNull();
  const hover=await page.screenshot({clip:hoverBounds!,animations:'disabled'});
  expect(hover.equals(normal),'Hover must visibly tint the status card').toBe(false);
  const popup=page.locator('#techPopover');
  await expect(popup).toHaveClass(/open/);
  await expect.poll(async()=>page.evaluate(()=>{
    const surface=document.querySelector('#techPopover');
    const employee=document.querySelector('.employee-card.state-ready');
    if(!surface||!employee)return false;
    const surfaceBorder=getComputedStyle(surface).borderColor;
    const employeeBorder=getComputedStyle(employee).borderColor;
    return Boolean(surfaceBorder&&employeeBorder&&surfaceBorder===employeeBorder);
  }),{timeout:5000}).toBe(true);
  await testInfo.attach('api-health-worker-hover-'+width+'.png',{body:hover,contentType:'image/png'});
  await employee.click();
  await expect(page.locator('#detailBackdrop')).toHaveClass(/open/);
  await expect.poll(async()=>page.evaluate(()=>{
    const surface=document.querySelector('#detailModal');
    const employee=document.querySelector('.employee-card.state-ready');
    if(!surface||!employee)return false;
    const surfaceBorder=getComputedStyle(surface).borderColor;
    const employeeBorder=getComputedStyle(employee).borderColor;
    return Boolean(surfaceBorder&&employeeBorder&&surfaceBorder===employeeBorder);
  }),{timeout:5000}).toBe(true);
  await testInfo.attach('api-health-employee-modal-'+width+'.png',{body:await page.locator('#detailModal').screenshot({animations:'disabled'}),contentType:'image/png'});
  await page.locator('#detailClose').click();
  const card=page.locator('.work-row').filter({hasText:'#3278'}).first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('#workDetailProgress')).toContainText('50%');
  await expect(page.locator('#workDetailGithub')).toHaveAttribute('href',/github\.com\/newsdayads\/tigeriq-ai-lab\/issues\/3278/);
  const controls=await page.locator('.work-detail-actions > *').evaluateAll(nodes=>nodes.filter(e=>getComputedStyle(e).display!=='none').map(e=>Math.round(e.getBoundingClientRect().width)));
  expect(controls).toHaveLength(3);
  if(width>700)expect(Math.max(...controls)-Math.min(...controls)).toBeLessThanOrEqual(2);
  await page.locator('#workDetailGithub').hover();
  expect(await page.locator('#workDetailGithub').evaluate(e=>getComputedStyle(e).textDecorationLine)).toBe('none');
  await testInfo.attach('api-health-work-modal-'+width+'.png',{body:await page.locator('#workDetailModal').screenshot({animations:'disabled'}),contentType:'image/png'});
  await page.keyboard.press('Escape');
  await expect(page.locator('#workDetailBackdrop')).not.toHaveClass(/open/);
  expect(jsErrors).toEqual([]);
 });
}

test('API Health mobile sorts newly verified finishes first and lets Owner switch to closure time',async({page})=>{
 await page.setViewportSize({width:390,height:880});
 await openFixture(page);
 const history=[
  {number:601,workKind:'WORK',status:'CLOSED_UNVERIFIED',completionVerified:false,closedAt:'2026-10-13T12:00:00Z',priority:'P1',title:'Just closed, unverified'},
  {number:602,workKind:'WORK',status:'DONE',completionVerified:true,completedAt:'2026-10-13T10:00:00Z',lifecycleTiming:{finishVerified:true,finishedAt:'2026-10-11T10:00:00Z'},priority:'P1',title:'Older verified finish'},
  {number:603,workKind:'WORK',status:'DONE',completionVerified:true,completedAt:'2026-10-12T11:00:00Z',lifecycleTiming:{finishVerified:true,finishedAt:'2026-10-12T10:59:00Z'},priority:'P1',title:'Latest verified finish'}
 ];
 await page.route(base+'/api/health-live-work',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({ok:true,projection:{...projection().projection,recentWork:history}})
 }));
 await page.reload();
 await expect(page.locator('.wo-filter.action')).toContainText('CÒN MỞ');
 await expect(page.locator('#workList .work-row')).toHaveCount(3);
 await page.locator('.wo-filter.closed').click();
 await expect(page.locator('#workClosedSort')).toBeVisible();
 const order=async()=>page.locator('#workList .work-row').evaluateAll(nodes=>nodes.map(n=>Number((n as HTMLElement).dataset.workNumber)));
 await expect.poll(order).toEqual([603,602,601]);
 await page.locator('#workClosedSort').selectOption('closed');
 await expect.poll(order).toEqual([601,602,603]);
 await page.locator('.wo-filter.action').click();
 await expect(page.locator('#workClosedSort')).toHaveCount(0);
 await expect.poll(order).toEqual([3278,4574,2054]);
});


test('five-point Owner acceptance: all open sort choices, labels and semantic tabs on iPhone',async({page})=>{
 await page.setViewportSize({width:393,height:852});
 await openFixture(page);
 const statuses=[
  {...work[0],number:330,updatedAt:'2026-10-13T20:00:00Z'},
  {...work[1],number:310,lastActivitySource:'github_issue_comment',lastActivityAt:'2026-10-12T12:00:00Z',lastActivitySummary:'[KẾT QUẢ] checking'},
  {...work[2],number:320,lastActivitySource:'github_issue_comment',lastActivityAt:'2026-10-13T12:00:00Z',lastActivitySummary:'[TIẾN ĐỘ] running'},
 ];
 await page.route(base+'/api/health-live-work',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({ok:true,projection:{...projection().projection,openWork:statuses}})
 }));
 await page.reload();
 const order=()=>page.locator('#workList .work-row').evaluateAll(nodes=>nodes.map(n=>Number((n as HTMLElement).dataset.workNumber)));
 await expect(page.locator('.wo-filter.action')).toContainText('CÒN MỞ');
 await expect(page.locator('.brand')).toContainText('TigerIQ AI');
 await expect(page.locator('#workOpenSort')).toHaveValue('priority');
 await expect.poll(order).toEqual([320,330,310]);
 await expect(page.locator('#woFilters')).toContainText('Có bình luận nhật ký: 2/3');
 await expect(page.locator('#workList .work-activity')).toHaveCount(2);
 await page.locator('#workOpenSort').selectOption('number_asc');
 await expect.poll(order).toEqual([310,320,330]);
 await page.locator('#workOpenSort').selectOption('number_desc');
 await expect.poll(order).toEqual([330,320,310]);
 await page.locator('#workOpenSort').selectOption('activity_latest');
 await expect.poll(order).toEqual([320,310,330]);
 await page.locator('#workOpenSort').selectOption('priority');
 await expect.poll(order).toEqual([330,310,320]);
 const semantic=await page.locator('.wo-filter').evaluateAll(buttons=>buttons.map(el=>{
   const style=getComputedStyle(el);return {label:el.textContent?.trim(),selected:el.getAttribute('aria-pressed'),text:style.color,border:style.borderColor,background:style.backgroundColor};
 }));
 expect(semantic.map(x=>x.selected)).toEqual(['true','false','false','false']);
 expect(new Set(semantic.map(x=>x.text)).size).toBeGreaterThan(2);
 expect(semantic[0].background).not.toBe(semantic[1].background);
 const header=await page.locator('.work-panel .panel-h h2').evaluate(el=>getComputedStyle(el).color);
 expect(header).toBe('rgb(45, 212, 191)');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
});

test('Owner visual fix: workforce header never overlaps filters, work cards align, list scrolls with document',async({page})=>{
 await page.setViewportSize({width:844,height:390});
 await openFixture(page);
 await expect(page.locator('.brand')).toContainText('TigerIQ AI');
 for(const [width,height] of [[390,844],[844,390],[1024,1366],[1920,1080]]){
  await page.setViewportSize({width,height});
  const r=await page.evaluate(()=>{
   const heading=document.querySelector('.workforce-panel .panel-h h2')!.getBoundingClientRect();
   const filters=document.querySelector('.workforce-panel .filters')!.getBoundingClientRect();
   return {heading:{left:heading.left,right:heading.right,top:heading.top,bottom:heading.bottom},
    filters:{left:filters.left,right:filters.right,top:filters.top,bottom:filters.bottom},
    overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
  });
  const separated=r.filters.left>=r.heading.right-1||r.filters.top>=r.heading.bottom-1;
  expect(separated,'header '+width+'x'+height).toBe(true);
  expect(r.overflow,'overflow '+width+'x'+height).toBe(false);
 }
 await page.setViewportSize({width:844,height:390});
 const positions=await page.locator('#workList .work-row').evaluateAll(nodes=>nodes.map(n=>({
   top:Math.round(n.getBoundingClientRect().top),bottom:Math.round(n.getBoundingClientRect().bottom)
 })));
 expect(new Set(positions.map(x=>x.top)).size).toBe(1);
 expect(new Set(positions.map(x=>x.bottom)).size).toBe(1);
 const many=Array.from({length:30},(_,i)=>({...work[i%work.length],number:7500+i,title:'Activity card '+i}));
 await page.route(base+'/api/health-live-work',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({ok:true,projection:{...projection().projection,openWork:many}})
 }));
 await page.reload();
 await expect(page.locator('#workList .work-row')).toHaveCount(30);
 const list=await page.locator('#workList').evaluate(el=>({
   height:el.getBoundingClientRect().height,overflowY:getComputedStyle(el).overflowY,
   maxHeight:getComputedStyle(el).maxHeight}));
 expect(list.maxHeight).toBe('none');
 expect(list.overflowY).toBe('visible');
 expect(list.height).toBeGreaterThan(1000);
});

test('System Control whole-page breakpoints: iPhone, tablet, FHD, QHD, UHD stay usable',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await openFixture(page);
 for(const [width,height] of [[390,844],[393,852],[430,932],[768,1024],[820,1180],[1024,1366],[844,390],[852,393],[932,430],[1920,1080],[2560,1440],[3840,2160]]){
  await page.setViewportSize({width,height});
  const metrics=await page.evaluate(()=>{
   const workCard=document.querySelector('#workList .work-row')!.getBoundingClientRect();
   const worker=document.querySelector('#workers .employee-card')!.getBoundingClientRect();
   return {overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
      workWidth:Math.round(workCard.width),workerWidth:Math.round(worker.width),
      filterVisible:!!document.querySelector('#workOpenSort')};
  });
  expect(metrics.overflow,'viewport '+width+'x'+height).toBe(false);
  expect(metrics.filterVisible,'viewport '+width+'x'+height).toBe(true);
  expect(metrics.workWidth,'viewport '+width+'x'+height).toBeGreaterThan(75);
  expect(metrics.workerWidth,'viewport '+width+'x'+height).toBeGreaterThan(75);
 }
});

test('TigerIQ System Control: landscape 4 workforce / 3 work and compact 2+1 monitoring panels',async({page})=>{
 for(const [width,height] of [[844,390],[852,393],[932,430]]){
   await page.setViewportSize({width,height});
   await openFixture(page);
   const structure=await page.evaluate(()=>{
     const tracks=(selector:string)=>getComputedStyle(document.querySelector(selector)!).gridTemplateColumns.split(' ').filter(Boolean).length;
     const bounds=(selector:string)=>Math.ceil(document.querySelector(selector)!.getBoundingClientRect().height);
     return {workers:tracks('#workers'),work:tracks('#workList'),side:tracks('.side'),
       cardHeight:bounds('#workList .work-row'),employeeHeight:bounds('#workers .employee-card'),
       alertGridColumn:getComputedStyle(document.querySelector('.side>.alert-panel')!).gridColumnStart,
       viewportWidth:document.documentElement.clientWidth,
       docWidth:document.documentElement.scrollWidth};
   });
   expect(structure.workers,'landscape '+width+' workforce').toBe(4);
   expect(structure.work,'landscape '+width+' work items').toBe(3);
   expect(structure.side,'landscape '+width+' side cards').toBe(2);
   expect(structure.cardHeight,'landscape '+width+' card height').toBeLessThan(280);
   expect(structure.employeeHeight,'landscape '+width+' employee height').toBeLessThan(160);
   expect(structure.docWidth,'landscape '+width+' overflow').toBeLessThanOrEqual(structure.viewportWidth);
 }
});

test('System Control grows card count, never card scale, across FHD, QHD and 4K',async({page})=>{
 const observations=[];
 for(const [width,height] of [[1920,1080],[2560,1440],[3840,2160]]){
   await page.setViewportSize({width,height});
   await openFixture(page);
   const a=await page.evaluate(()=>{
     const cols=(selector:string)=>getComputedStyle(document.querySelector(selector)!).gridTemplateColumns.split(' ').filter(Boolean).length;
     const cardWidth=(selector:string)=>Math.round(document.querySelector(selector)!.getBoundingClientRect().width);
     return {people:cols('#workers'),work:cols('#workList'),
       peopleCard:cardWidth('#workers .employee-card'),workCard:cardWidth('#workList .work-row'),
       viewportWidth:document.documentElement.clientWidth,docWidth:document.documentElement.scrollWidth};
   });
   expect(a.docWidth,'desktop '+width+' overflow').toBeLessThanOrEqual(a.viewportWidth);
   expect(a.peopleCard,'desktop '+width+' people card').toBeLessThan(310);
   expect(a.workCard,'desktop '+width+' work card').toBeLessThan(370);
   observations.push(a);
 }
 for(let i=1;i<observations.length;i++){
   expect(observations[i].people).toBeGreaterThan(observations[i-1].people);
   expect(observations[i].work).toBeGreaterThan(observations[i-1].work);
 }
 await expect(page.locator('[data-system-control-root=true]')).toBeVisible();
 expect(await page.locator('[data-module-id]').count()).toBe(5);
 await expect(page.locator('.workforce-panel .panel-h h2')).toHaveCSS('color','rgb(96, 165, 250)');
 await expect(page.locator('.work-panel .panel-h h2')).toHaveCSS('color','rgb(45, 212, 191)');
});

test('same Work Center card skin in LIVE and API Health; Health never shrinks to 5 microcards',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await openFixture(page);
 const evidence=async()=>page.locator('#workList .tiq-work-card[data-work-number="3278"]').evaluate((el)=>{
   const main=el.querySelector('.work-main');
   const number=el.querySelector('.work-id');
   const pri=el.querySelector('.priority');
   const title=el.querySelector('.work-title');
   const hierarchy=el.querySelector('.work-hierarchy');
   if(!main||!number||!pri||!title||!hierarchy)throw Error('INCOMPLETE_CARD');
   const a=el.getBoundingClientRect(),b=number.getBoundingClientRect();
   return {
    width:Math.round(a.width),height:Math.round(a.height),
    mainBg:getComputedStyle(main).backgroundColor,
    mainBorder:getComputedStyle(main).borderColor,
    titleFont:getComputedStyle(title).fontSize,
    titleColor:getComputedStyle(title).color,
    idPosition:getComputedStyle(number).position,
    idTopDelta:Math.round(b.top-a.top),
    priorityColor:getComputedStyle(pri).backgroundColor,
    hierarchyDisplay:getComputedStyle(hierarchy).display,
   };
 });
 const healthCard=await evidence();
 expect(healthCard.width).toBeGreaterThanOrEqual(240); // Owner compact-density layout, still readable
 expect(healthCard.height).toBeGreaterThanOrEqual(180);
 expect(healthCard.idPosition).toBe('absolute');
 expect(Math.abs(healthCard.idTopDelta)).toBeLessThanOrEqual(3);
 expect(healthCard.hierarchyDisplay).not.toBe('none');
 expect(healthCard.mainBorder).toBe('rgb(59, 130, 246)');
 await page.route('https://tigeriq.test/**',async r=>{
   const url=new URL(r.request().url());
   const liveHtml=readFileSync(new URL('../../command-center.html',import.meta.url),'utf8');
   if(url.pathname==='/command-center')return r.fulfill({status:200,contentType:'text/html',body:liveHtml});
   if(url.pathname==='/work-center.js')return r.fulfill({status:200,contentType:'text/javascript',body:workCenterJs});
   if(url.pathname==='/work-ui.css')return r.fulfill({status:200,contentType:'text/css',body:sharedCss});
   if(url.pathname==='/work-center-visual.css')return r.fulfill({status:200,contentType:'text/css',body:workCenterVisualCss});
   if(url.pathname==='/api/live-status')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
     ok:true,liveConnected:true,generatedAt:recent(),
     workProjection:{mode:'verified',stale:false,verifiedAt:recent()},
     openSummary:{actionable:3,open:3,review:1,blocked:1,waiting:1,running:0,done:0},
     openWork:work,activeWork:[],nextQueue:[],recentWork:[],workers:[]
   })});
   return r.fulfill({status:204,body:''});
 });
 await page.goto('https://tigeriq.test/command-center');
 await expect(page.locator('#workList .tiq-work-card[data-work-number="3278"]')).toBeVisible();
 const liveCard=await evidence();
 expect(healthCard.mainBg).toBe(liveCard.mainBg);
 expect(healthCard.mainBorder).toBe(liveCard.mainBorder);
 expect(healthCard.titleFont).toBe(liveCard.titleFont);
 expect(healthCard.titleColor).toBe(liveCard.titleColor);
 expect(healthCard.priorityColor).toBe(liveCard.priorityColor);
 expect(liveCard.hierarchyDisplay).not.toBe('none');
 expect(Math.abs(liveCard.idTopDelta)).toBeLessThanOrEqual(3);
});

test('Ops monitoring: verified source-age, active severity, event history and evidence',async({page})=>{
 await openFixture(page,true);
 await expect(page.locator('#opsFreshnessSummary')).toContainText(/Dữ liệu cũ|Nguồn mất kết nối/);
 await page.locator('#opsFreshness summary').click();
 await expect(page.locator('.ops-age')).toHaveCount(4);
 await expect(page.locator('.ops-age[data-level=offline]').first()).toBeVisible();
 await page.locator('[data-alert-severity=critical]').click();
 await expect(page.locator('#currentAlerts .event')).toHaveCount(1);
 await page.locator('[data-alert-severity=warning]').click();
 await expect(page.locator('#currentAlerts .event')).toHaveCount(1);
 await page.locator('[data-alert-severity=all]').click();
 await expect(page.locator('#currentAlerts .event')).toHaveCount(2);
 await expect(page.locator('.ops-event-clickable')).toHaveCount(16);
 await page.locator('#opsEventMore').click();
 await expect(page.locator('.ops-event-clickable')).toHaveCount(28);
 await page.locator('.ops-event-clickable').first().click();
 await expect(page.locator('#opsEvidenceBackdrop')).toBeVisible();
 await expect(page.locator('#opsEvidenceBody')).toContainText('Core events · /api/status');
 await expect(page.locator('#opsEvidenceGithub')).toHaveAttribute('href',/issues\/3278/);
 await page.locator('#opsEvidenceClose').click();
 await expect(page.locator('#opsEvidenceBackdrop')).toBeHidden();
});
