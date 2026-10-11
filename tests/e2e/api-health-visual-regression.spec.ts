import {test,expect,type Page,type Route} from '@playwright/test';
import {readFileSync} from 'node:fs';

test.use({channel:'chrome'});
const dashboard=readFileSync(new URL('../../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
const sharedCss=readFileSync(new URL('../../public/work-ui.css',import.meta.url),'utf8');
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
  await expect(page.locator('.wo-filter.action')).toContainText('TẤT CẢ');
  await expect(page.locator('.wo-filter.action')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#opsFreshnessRows .ops-age')).toHaveCount(4);
  const css=await page.locator('body').evaluate(el=>{const s=getComputedStyle(el);return {surface:s.getPropertyValue('--tiq-surface').trim(),ready:s.getPropertyValue('--tiq-ready').trim(),working:s.getPropertyValue('--tiq-working').trim()}});
  expect(css).toEqual({surface:'#111C2E',ready:'#3B82F6',working:'#22C55E'});
  await page.locator('.filter[data-filter=all]').click();
  const employee=page.locator('.employee-card.state-ready').first();
  await expect(employee).toBeVisible();
  // Worker cards are replaced by 1-second live polling; screenshot a viewport clip, not a stale DOM node.
  await employee.scrollIntoViewIfNeeded();
  const cardBox=await employee.boundingBox();
  expect(cardBox,'Expected a visible worker card for the hover screenshot').not.toBeNull();
  const normalColor=await employee.evaluate(e=>getComputedStyle(e).backgroundColor);
  const normal=await page.screenshot({clip:cardBox!,animations:'disabled'});
  await employee.hover();
  await expect.poll(()=>employee.evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe(normalColor);
  const hover=await page.screenshot({clip:cardBox!,animations:'disabled'});
  expect(hover.equals(normal),'Hover must visibly tint the status card').toBe(false);
  const popup=page.locator('#techPopover');
  await expect(popup).toHaveClass(/open/);
  // The worker grid is replaced by live polling: never snapshot a border color from a detached card.
  // Resolve the same ready-state CSS token in the browser and verify three independent surfaces.
  const readyBorder=await page.evaluate(()=>{
    const probe=document.createElement('span');
    probe.style.border='1px solid var(--tiq-ready)';
    document.body.appendChild(probe);
    try{return getComputedStyle(probe).borderTopColor;}
    finally{probe.remove();}
  });
  expect(readyBorder).toBe('rgb(59, 130, 246)');
  await expect.poll(()=>employee.evaluate(e=>getComputedStyle(e).borderTopColor)).toBe(readyBorder);
  await expect(popup).toHaveCSS('border-top-color',readyBorder);
  await testInfo.attach('api-health-worker-hover-'+width+'.png',{body:hover,contentType:'image/png'});
  await employee.click();
  await expect(page.locator('#detailBackdrop')).toHaveClass(/open/);
  await expect(page.locator('#detailModal')).toHaveCSS('border-top-color',readyBorder);
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
