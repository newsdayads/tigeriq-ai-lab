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
  await expect(page.locator('.wo-filter.all')).toContainText('TẤT CẢ');
  await expect(page.locator('.wo-filter.all')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#opsFreshnessRows .ops-age')).toHaveCount(4);
  const css=await page.locator('body').evaluate(el=>{const s=getComputedStyle(el);return {surface:s.getPropertyValue('--tiq-surface').trim(),ready:s.getPropertyValue('--tiq-ready').trim(),working:s.getPropertyValue('--tiq-working').trim()}});
  expect(css).toEqual({surface:'#111C2E',ready:'#3B82F6',working:'#22C55E'});
  await page.locator('.filter[data-filter=all]').click();
  const employee=page.locator('.employee-card.state-ready').first();
  await expect(employee).toBeVisible();
  const normal=await employee.screenshot({animations:'disabled'});
  await employee.hover();
  const hover=await employee.screenshot({animations:'disabled'});
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
 expect(healthCard.width).toBeGreaterThanOrEqual(260);
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
