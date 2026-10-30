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
   workforce:['NV03','NV04','NV09','NV06','NV14','NV15'].map(employee_id=>({employee_id,name:employee_id,assigned:true,admin_state:'READY'})),
   jobs:[],events:Array.from({length:28},(_,i)=>({seq:String(100-i),ts:recent(i+1),type:i===0?'API_DOCTOR_SCAN':'RESOURCE_SUCCESS',employee_id:'NV06',resource_id:'NV06',data:{kind:'health',...(i===0?{repairIssueNumber:3278}:{})}})),
   telemetry:[{ts,employee_id:'NV06',type:'RESOURCE_SUCCESS'}]
 };
}
function projection(stale=false){return {ok:true,projection:{generatedAt:recent(stale?7200:1),stale,verifiedGateSource:true,
 openSummary:{open:work.length,actionable:work.length,review:1,waiting:1,done:0},openWork:work,recentWork:[],workProjection:{stale},nv03MilestoneQaInboxFresh:!stale,nv03MilestoneQaInbox:[{employeeId:'NV03',proofStatus:'REVIEW_REQUEST_DISCOVERED',claimState:'NOT_CLAIMED',receiptCoverage:'COMPLETE',issueNumber:4625}],workers:[{employeeId:'NV03',kind:'ui',state:'idle',uiSessionState:'idle',heartbeatAt:recent(stale?7200:1),currentJobId:null,job:'Không có việc đang chạy',detail:'READY'},{employeeId:'NV04',kind:'ui',state:'idle',uiSessionState:'idle',heartbeatAt:recent(stale?7200:1),currentJobId:null,job:'Không có việc đang chạy',detail:'READY'}]}}}
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
  // The health feed may replace employee cards between hover and the next locator call.
  // Assert actual computed hover tint, not a transient boundingBox() that can be null
  // while the card is being rebuilt. A viewport screenshot still records the UI.
  const normalBorder=await employee.evaluate(el=>getComputedStyle(el).borderColor);
  await employee.hover();
  await expect.poll(async()=>page.locator('.employee-card.state-ready:hover').first()
    .evaluate(el=>getComputedStyle(el).borderColor).catch(()=>normalBorder),{timeout:5000})
    .not.toBe(normalBorder);
  await expect(page.locator('#techPopover')).toHaveCount(0);
  await expect(page.locator('#detailBackdrop')).not.toHaveClass(/open/);
  await testInfo.attach('api-health-worker-hover-'+width+'.png',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
  await employee.click();
  await expect(page.locator('#detailBackdrop')).toHaveClass(/open/);
  await expect(page.locator('#detailModal')).toHaveClass(/state-ready/);
  await expect.poll(()=>page.locator('#detailModal').evaluate(el=>getComputedStyle(el).borderTopColor)).toBe('rgb(59, 130, 246)');
  expect(await page.locator('#detailModal #detailTitle').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(59, 130, 246)');
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
 await expect(page.locator('#workOpenSort')).toHaveValue('activity_latest');
 await expect.poll(order).toEqual([320,310,330]);
 await expect(page.locator('#woFilters')).toContainText('Có bình luận nhật ký: 2/3');
 await expect(page.locator('#workList .work-activity')).toHaveCount(0);
 const ranks=()=>page.locator('#workList .work-row .rank').allTextContents();
 await expect.poll(ranks).toEqual(['03','02','01']);
 await page.locator('#workOpenSort').selectOption('rank_asc');
 await expect.poll(order).toEqual([330,310,320]);
 await expect.poll(ranks).toEqual(['01','02','03']);
 await page.locator('#workOpenSort').selectOption('rank_desc');
 await expect.poll(order).toEqual([320,310,330]);
 await expect.poll(ranks).toEqual(['03','02','01']);
 await page.locator('#workOpenSort').selectOption('number_asc');
 await expect.poll(order).toEqual([310,320,330]);
 await page.locator('#workOpenSort').selectOption('number_desc');
 await expect.poll(order).toEqual([330,320,310]);
 await page.locator('#workOpenSort').selectOption('activity_latest');
 await expect.poll(order).toEqual([320,310,330]);
 await page.locator('#workOpenSort').selectOption('priority');
 await expect.poll(order).toEqual([320,330,310]);
 await page.locator('#workList .work-row[data-work-number="320"]').click();
 await expect(page.locator('#workDetailAudit')).toContainText('Nhật ký GitHub gần nhất');
 await expect(page.locator('#workDetailAudit')).toContainText('[TIẾN ĐỘ] running');
 await page.keyboard.press('Escape');
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

test('System Control retains four stable work cards across FHD, QHD and 4K',async({page})=>{
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
   expect(observations[i].work).toBe(4);
 }
 await expect(page.locator('[data-system-control-root=true]')).toBeVisible();
 expect(await page.locator('[data-module-id]').count()).toBe(5);
 await expect(page.locator('.workforce-panel .panel-h h2')).toHaveCSS('color','rgb(96, 165, 250)');
 await expect(page.locator('.work-panel .panel-h h2')).toHaveCSS('color','rgb(45, 212, 191)');
});

test('same Work Center card skin in LIVE and API Health; Health hides duplicate project breadcrumb',async({page})=>{
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
 expect(healthCard.hierarchyDisplay).toBe('none');
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

test('NV03/NV04: current UI state, QA inbox, color and filter have distinct evidence',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await openFixture(page);
 const all=page.locator('.filter[data-filter="all"]');
 await expect(page.locator('.filter[data-filter="working"]')).toHaveAttribute('aria-pressed','true');
  await expect(all).toHaveAttribute('aria-pressed','false');
  await all.click();
  await expect(all).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.filter[data-filter="working"]')).toHaveText(/Đang làm/);
 await expect(page.locator('.filter[data-filter="ready"]')).toHaveText(/Rảnh/);
 const nv03=page.locator('.employee-card[data-employee="NV03"]');
 const nv04=page.locator('.employee-card[data-employee="NV04"]');
 await expect(nv03).toBeVisible();
 await expect(nv04).toBeVisible();
 await expect(nv03).toContainText('RẢNH');
 await expect(nv03).toContainText('1 yêu cầu QA chờ nhận');
 await expect(nv04).toContainText('RẢNH');
 await expect(nv04).not.toContainText('ĐANG LÀM');
 const colors=await page.locator('.filter[data-filter]').evaluateAll(nodes=>Object.fromEntries(nodes.map(el=>[el.getAttribute('data-filter'),getComputedStyle(el).color])));
 expect(colors.working).toBe('rgb(34, 197, 94)');
 expect(colors.ready).toBe('rgb(59, 130, 246)');
 expect(colors.cloud).toBe('rgb(203, 213, 225)');
 await page.locator('.filter[data-filter="ready"]').click();
 await expect(page.locator('.filter[data-filter="ready"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.employee-card[data-employee="NV03"]')).toBeVisible();
 await expect(page.locator('.employee-card[data-employee="NV04"]')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('UI generating response is WORKING only while heartbeat fresh, never a fabricated Core job',async({page})=>{
 await openFixture(page);
 const test=await page.evaluate(()=>{
   const fn=(window as any).applyLiveWorkforce;
   const row={employee_id:'NV03',status:'UNKNOWN',current_job_id:'STALE-GH',live_job:'STALE'};
   const working=fn([row],[{employeeId:'NV03',kind:'ui',state:'working',uiSessionState:'working',heartbeatAt:new Date().toISOString(),currentJobId:null,job:'Chat đang trả lời'}])[0];
   const stale=fn([row],[{employeeId:'NV03',kind:'ui',state:'working',uiSessionState:'working',heartbeatAt:new Date(Date.now()-61000).toISOString(),currentJobId:'OLD-GH',job:'Old job'}])[0];
   return {working:working.status,workingJob:working.current_job_id,workingLive:working.ui_live,stale:stale.status,staleJob:stale.current_job_id,staleLive:stale.live_job};
 });
 expect(test).toEqual({working:'UI_BUSY',workingJob:null,workingLive:true,stale:'UNKNOWN',staleJob:null,staleLive:null});
});


test('Owner P0 flat workforce default and equal work-filter controls with visible progress',async({page})=>{
 await page.setViewportSize({width:1648,height:900});
 await openFixture(page);
 await expect(page.locator('.filter[data-filter="working"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.filter[data-filter="all"]')).toHaveAttribute('aria-pressed','false');
 const buttons=page.locator('#woFilters > .wo-filter');
 await expect(buttons).toHaveCount(4);
 const widths=await buttons.evaluateAll(els=>els.map(el=>Math.round(el.getBoundingClientRect().width)));
 expect(new Set(widths).size).toBe(1);
 const priority=page.locator('#workList .priority.p2').first();
 await expect(priority).toBeVisible();
 expect(await priority.evaluate(el=>getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
 const row=page.locator('#workList .progress:not(.indeterminate)').first();
 await expect(row).toBeVisible();
 const styling=await row.locator('.progress-fill').evaluate(el=>({
   effect:getComputedStyle(el,'::before').animationName,
   seconds:getComputedStyle(el,'::before').animationDuration,
   shadow:getComputedStyle(el).textShadow}));
 expect(styling.effect).toContain('tiq-owner-flow-fast');
 expect(styling.seconds).toBe('0.95s');
 expect(styling.shadow).toBe('none');
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await row.locator('.progress-fill').evaluate(el=>getComputedStyle(el,'::before').animationName)).toBe('none');
});

test('Owner journal moves into detail and blocker NONE is hidden',async({page})=>{
 await openFixture(page);
 const rows=[{...work[0],lastActivitySource:'github_issue_comment',lastActivityAt:recent(2),lastActivitySummary:'Confirmed progress'},
   {...work[1],blocker:'NONE',waitReason:'NONE'},work[2]];
 await page.route(base+'/api/health-live-work',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,projection:{...projection().projection,openWork:rows}})}));
 await page.reload();
 await expect(page.locator('#workList .work-activity')).toHaveCount(0);
 await expect(page.locator('#workList .work-row[data-work-number="4574"] .work-quick.blocked')).toHaveCount(0);
 await page.locator('#workList .work-row[data-work-number="3278"]').click();
 await expect(page.locator('#workDetailAudit')).toContainText('Nhật ký GitHub gần nhất');
 await expect(page.locator('#workDetailAudit')).toContainText('Confirmed progress');
});


test('Owner 3 screen density: compact cards, uniform buttons and usable content at 1664 924 630',async({page})=>{
 for(const [width,height,minWork,minWorkers] of [[1664,936,4,6],[924,1040,2,4],[630,1040,2,3]] as const){
  await page.setViewportSize({width,height});
  await openFixture(page);
  const metrics=await page.evaluate(()=>{
   const w=document.querySelector('#workList')!,emp=document.querySelector('#workers')!;
   const columns=(el:Element)=>getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
   const widths=(sel:string)=>[...document.querySelectorAll(sel)].map(el=>Math.round(el.getBoundingClientRect().width));
   const wo=widths('#woFilters>.wo-filter'),wf=widths('.workforce-panel .filters .filter[data-filter]');
   const card=document.querySelector('#workList .tiq-work-card')!;
   const state=card.querySelector('.work-top .state')!;
   const title=card.querySelector('.work-title')!;
   const meta=card.querySelector('.work-hierarchy')!;
   return {workCols:columns(w),workerCols:columns(emp),wo,wf,
    titleFont:parseFloat(getComputedStyle(title).fontSize),
    stateFont:parseFloat(getComputedStyle(state).fontSize),
    metaFont:parseFloat(getComputedStyle(meta).fontSize),
    docWidth:document.documentElement.scrollWidth,windowWidth:document.documentElement.clientWidth};
  });
  expect(metrics.workCols,'work columns at '+width).toBeGreaterThanOrEqual(minWork);
  expect(metrics.workerCols,'workforce columns at '+width).toBeGreaterThanOrEqual(minWorkers);
  expect(new Set(metrics.wo).size,'work button widths at '+width).toBe(1);
  expect(new Set(metrics.wf).size,'workforce button widths at '+width).toBe(1);
  expect(metrics.wo[0],'compact work buttons at '+width).toBeLessThanOrEqual(112);
  expect(metrics.wf[0],'compact workforce buttons at '+width).toBeLessThanOrEqual(114);
  expect(metrics.titleFont).toBeGreaterThan(metrics.stateFont);
  expect(metrics.stateFont).toBe(metrics.metaFont);
  expect(metrics.docWidth,'horizontal overflow at '+width).toBeLessThanOrEqual(metrics.windowWidth);
 }
});

test('Owner work-card hover highlights the surface and detail fonts stay uniform',async({page})=>{
 await page.setViewportSize({width:924,height:980});
 await openFixture(page);
 const card=page.locator('#workList .tiq-work-card').first();
 const first=await card.locator('.work-main').evaluate(el=>getComputedStyle(el).backgroundColor);
 await card.hover();
 await expect.poll(()=>card.locator('.work-main').evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(first);
 await card.click();
 const modal=page.locator('#workDetailModal');
 await expect(modal).toBeVisible();
 const f=await modal.evaluate(el=>({
  title:parseFloat(getComputedStyle(el.querySelector('.work-detail-title')!).fontSize),
  line:parseFloat(getComputedStyle(el.querySelector('.work-detail-row')!).fontSize),
  section:parseFloat(getComputedStyle(el.querySelector('.work-detail-section h3')!).fontSize),
  kicker:parseFloat(getComputedStyle(el.querySelector('.work-detail-kicker')!).fontSize),
 }));
 expect(f.line).toBe(12);
 expect(f.section).toBe(f.line);
 expect(f.kicker).toBe(f.line);
 expect(f.title).toBeGreaterThan(f.line);
});

test('Owner mobile filter chips use compact four-across layout without oversized padding',async({page})=>{
 for(const width of [390,414,430,320]){
  await page.setViewportSize({width,height:844});
  await openFixture(page);
  const a=await page.evaluate(()=>{
   const wf=document.querySelector('.workforce-panel .filters')!;
   const wo=document.querySelector('#woFilters')!;
   const tabs=[...wf.querySelectorAll('.filter[data-filter]')] as HTMLElement[];
   const work=[...wo.querySelectorAll('.wo-filter')] as HTMLElement[];
   const box=(el:HTMLElement)=>el.getBoundingClientRect();
   return {
    wfTracks:getComputedStyle(wf).gridTemplateColumns.split(' ').filter(Boolean).length,
    workTracks:getComputedStyle(wo).gridTemplateColumns.split(' ').filter(Boolean).length,
    wfHeights:tabs.map(e=>Math.round(box(e).height)),
    workHeights:work.map(e=>Math.round(box(e).height)),
    wfWidths:tabs.map(e=>Math.round(box(e).width)),
    workWidths:work.map(e=>Math.round(box(e).width)),
    wfRows:new Set(tabs.map(e=>Math.round(box(e).top))).size,
    workRows:new Set(work.map(e=>Math.round(box(e).top))).size,
    overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth
   };
  });
  expect(a.wfTracks).toBe(width>=360?4:3);
  expect(a.workTracks).toBe(width>=360?4:2);
  expect(new Set(a.wfHeights)).toEqual(new Set([27]));
  expect(new Set(a.workHeights)).toEqual(new Set([27]));
  expect(new Set(a.wfWidths).size).toBe(1);
  expect(new Set(a.workWidths).size).toBe(1);
  expect(a.wfRows).toBe(width>=360?2:3);
  expect(a.workRows).toBe(width>=360?1:2);
  expect(a.overflow).toBe(false);
 }
});

test('Employee card click-only detail inherits verified state palette',async({page})=>{
 await page.setViewportSize({width:924,height:980});
 await openFixture(page);
 await page.locator('.filter[data-filter="all"]').click();
 await expect(page.locator('#techPopover')).toHaveCount(0);
 for(const [state,color] of [['working','rgb(34, 197, 94)'],['ready','rgb(59, 130, 246)'],['attention','rgb(251, 113, 133)']] as const){
  const card=page.locator('.employee-card.state-'+state).first();
  await expect(card).toBeVisible();
  await card.hover();
  await expect(page.locator('#detailBackdrop')).not.toHaveClass(/open/);
  await card.click();
  await expect(page.locator('#detailModal')).toHaveClass(new RegExp('state-'+state));
  expect(await page.locator('#detailModal').evaluate(el=>getComputedStyle(el).borderTopColor)).toBe(color);
  expect(await page.locator('#detailModal #detailStatus').evaluate(el=>getComputedStyle(el).color)).toBe(color);
  await page.locator('#detailClose').click();
 }
 const card=page.locator('.employee-card.state-ready').first();
 await card.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 await expect(page.locator('#detailBackdrop')).toHaveClass(/open/);
 await page.keyboard.press('Escape');
 await expect(page.locator('#detailBackdrop')).not.toHaveClass(/open/);
});
test('Stylesheets are consolidated without obsolete employee-hover inspector',async({page})=>{
 await openFixture(page);
 expect(await page.locator('style').count()).toBe(2);
 await expect(page.locator('#techPopover')).toHaveCount(0);
 const styles=await page.evaluate(()=>[...document.styleSheets].map(s=>s.href||''));
 expect(styles.some(x=>x.includes('/work-center-visual.css'))).toBe(true);
});

test('mobile work card border aligns with number and priority corner tabs', async ({page})=>{
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1">'
    +'<style>'+sharedCss+'</style><style>'+workCenterVisualCss+'</style>'
    +'<div id="workList" class="wo-list work-list tiq-work-center">'
    +'<article class="work-row tiq-work-card status-review priority-p1"><div class="work-main">'
    +'<div class="work-top"><span class="work-id">#5135</span><span class="priority p1">P1</span></div>'
    +'<div class="work-title">Kiểm tra viền thẻ</div></div></article>'
    +'<article class="work-row tiq-work-card status-waiting priority-p1"><div class="work-main">'
    +'<div class="work-top"><span class="work-id">#4456</span><span class="priority p1">P1</span></div>'
    +'<div class="work-title">Xác minh viền chờ</div></div></article></div>');
  for(const width of [375,430]){
    await page.setViewportSize({width,height:844});
    for(const card of await page.locator('#workList > .tiq-work-card').all()){
      const frame=await card.locator(':scope > .work-main').boundingBox();
      const id=await card.locator('.work-id').boundingBox();
      const priority=await card.locator('.priority').boundingBox();
      expect(frame).not.toBeNull();
      expect(id).not.toBeNull();
      expect(priority).not.toBeNull();
      if(!frame||!id||!priority)continue;
      expect(Math.abs(frame.x-id.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(frame.x+frame.width-priority.x-priority.width)).toBeLessThanOrEqual(1);
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x+frame.width).toBeLessThanOrEqual(width);
    }
  }
});

test('iPhone API Health shows one bottom-right floating reload button that reloads the document',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await openFixture(page);
 const reload=page.locator('#reloadPage');
 await expect(reload).toHaveCount(1);
 await expect(reload).toBeVisible();
 await expect(reload).toHaveAttribute('aria-label','Tải lại trang');
 await expect(reload.locator('svg')).toHaveCount(1);
 const coordinates=await reload.evaluate(button=>{
  const box=button.getBoundingClientRect();
  return {right:box.right,bottom:box.bottom,top:box.top,left:box.left,position:getComputedStyle(button).position};
 });
 expect(coordinates.position).toBe('fixed');
 expect(coordinates.right).toBeLessThanOrEqual(390);
 expect(coordinates.right).toBeGreaterThan(325);
 expect(coordinates.left).toBeGreaterThan(0);
 expect(coordinates.bottom).toBeLessThanOrEqual(844);
 expect(coordinates.top).toBeGreaterThan(700);
 await page.evaluate(()=>(window as any).TigerIQWorkCenter.mountFloatingReload());
 await expect(reload).toHaveCount(1);
 const navigation=page.waitForResponse(response=>response.url()===base+'/'&&response.request().resourceType()==='document');
 await reload.click();
 await navigation;
 await expect(page.locator('#workList .work-row')).toHaveCount(3);
 await expect(page.locator('#reloadPage')).toHaveCount(1);
});
