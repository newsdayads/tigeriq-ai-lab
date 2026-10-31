import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';

test.use({ channel: 'chrome' });

const liveHtml = fs.readFileSync(new URL('../../command-center.html', import.meta.url), 'utf8');
const sharedWorkJs=fs.readFileSync(new URL('../../public/work-center.js',import.meta.url),'utf8');
const sharedWorkCss=fs.readFileSync(new URL('../../public/work-ui.css',import.meta.url),'utf8');
const workCenterVisualCss=fs.readFileSync(new URL('../../public/work-center-visual.css',import.meta.url),'utf8');
const projectsHtml = fs.readFileSync(new URL('../../projects.html', import.meta.url), 'utf8');

const snapshot = {
  ok:true, liveConnected:true, generatedAt:'2026-10-06T09:30:00.000Z',
  workProjection:{mode:'verified',stale:false,verifiedAt:'2026-10-06T09:30:00.000Z'},
  completionProgress:{source:'terminal_completion',percent:50,completedItems:1,scopeItems:2},
  openSummary:{running:2,owner:0,review:1,waiting:1,system:0,done:1},
  projectPortfolio:[
    {id:'alpha',name:'Alpha',order:10,kind:'project',counts:{working:1,review:1,blocked:0,waiting:0,done:0},workstreams:[{id:'build',name:'Xây dựng',order:10,itemCount:2}]},
    {id:'beta',name:'Beta',order:20,kind:'project',counts:{working:1,review:0,blocked:1,waiting:0,done:0},workstreams:[{id:'release',name:'Phát hành',order:10,itemCount:2}]}
  ],
  openWork:[
    {number:111,title:'[P1] Xây giao diện công việc',status:'ĐANG XỬ LÝ',workKind:'WORK',priority:'P1',employeeId:'NV03',assignee:'NV03',currentStep:'Dựng thẻ công việc',nextStep:'Kiểm tra mobile',progressPercent:70,progressSource:'explicit_verified',projectId:'alpha',projectName:'Alpha',workstreamId:'build',workstreamName:'Xây dựng',jobId:'ALPHA-111'},
    {number:112,title:'[P1][REVIEW] Rà soát giao diện',status:'RÀ SOÁT',workKind:'WORK',priority:'P1',employeeId:'NV12',nextStep:'Kiểm tra toàn bộ dữ liệu hiện hành trên mobile dọc và mobile ngang trước khi đóng công việc',projectId:'alpha',projectName:'Alpha',workstreamId:'build',workstreamName:'Xây dựng',jobId:'ALPHA-112'},
    {number:500,title:'[P1] Phát hành Beta',status:'ĐANG XỬ LÝ',workKind:'WORK',priority:'P1',employeeId:'NV06',projectId:'beta',projectName:'Beta',workstreamId:'release',workstreamName:'Phát hành',jobId:'BETA-500'},
    {number:501,title:'[P1] Beta bị chặn',status:'BỊ CHẶN',workKind:'WORK',priority:'P1',employeeId:'NV06',blocker:'Thiếu bằng chứng',projectId:'beta',projectName:'Beta',workstreamId:'release',workstreamName:'Phát hành',jobId:'BETA-501'}
  ],
  activeWork:[{number:111,title:'[P1] Xây giao diện công việc',status:'ĐANG XỬ LÝ',workKind:'WORK',priority:'P1',employeeId:'NV03',assignee:'NV03',currentStep:'Dựng thẻ công việc',nextStep:'Kiểm tra mobile',progressPercent:70,progressSource:'explicit_verified',projectId:'alpha',projectName:'Alpha',workstreamId:'build',workstreamName:'Xây dựng',jobId:'ALPHA-111'}],
  nextQueue:[],recentWork:[],workers:[{employeeId:'NV03',state:'working',status:'ĐANG LÀM'}]
};

async function routeTiger(page:Page,payload:Record<string,unknown>=snapshot,workforce:()=>Record<string,unknown>=()=>payload){
  await page.route('https://tigeriq.test/**',async(route:Route)=>{
    const url=route.request().url();
    if(url.includes('/api/live-status?scope=workforce')){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(workforce())});return}
    if(url.endsWith('/api/live-status')){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});return}
    if(url.endsWith('/projects')){await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:projectsHtml});return}
    if(url.endsWith('/work-center.js')){await route.fulfill({status:200,contentType:'text/javascript',body:sharedWorkJs});return}
    if(url.endsWith('/work-ui.css')){await route.fulfill({status:200,contentType:'text/css',body:sharedWorkCss});return}
    if(url.endsWith('/work-center-visual.css')){await route.fulfill({status:200,contentType:'text/css',body:workCenterVisualCss});return}
    if(url.endsWith('/command-center')){await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:liveHtml});return}
    await route.fulfill({status:204,body:''});
  });
}

async function openLive(page:Page){await routeTiger(page);await page.goto('https://tigeriq.test/command-center');await expect(page.locator('#workList')).toBeVisible()}

test('a single ended filter preserves both closeout outcomes',async({page})=>{
 const archived={number:4691,title:'[P2] Nút tải lại cũ',priority:'P2',status:'CLOSED_UNVERIFIED',workKind:'WORK',completionVerified:false,progressPercent:null,progressSource:'closed_unverified'};
 const verified={number:4690,title:'[P2] Đã nghiệm thu',priority:'P2',status:'DONE',workKind:'WORK',completionVerified:true,progressPercent:100,progressSource:'terminal'};
 await routeTiger(page,{...snapshot,recentWork:[archived,verified],openSummary:{...snapshot.openSummary,done:1,archived:1}});
 await page.goto('https://tigeriq.test/command-center');
 await expect(page.locator('.filters .filter')).toHaveCount(4);
 await page.locator('.filter[data-filter="closed"]').click();
 await expect(page.locator('#closedCount')).toHaveText('2');
 await expect(page.locator('.work-row')).toHaveCount(2);
 const row=page.locator('.work-row[data-work-number="4691"]');
 await expect(row).toContainText('ĐÓNG KHÁC');
 await expect(row.locator('.progress-text')).toHaveCount(0);
 await expect(page.locator('.work-row[data-work-number="4690"]')).toContainText('HOÀN TẤT');
});

test('LIVE shows the work list immediately and keeps project surfaces out of layout',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openLive(page);
  await expect(page.locator('#missionControl')).toBeHidden();
  await expect(page.locator('#projectDrilldown')).toBeHidden();
  await expect(page.locator('#nowRunning')).toBeHidden();
  await expect(page.locator('#apiWorkforce')).toBeHidden();
  await expect(page.locator('#workListHeading')).toHaveText('DANH SÁCH CÔNG VIỆC');
});

test('work cards stay compact while project, workstream and job remain available in detail',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await openLive(page);
  const card=page.locator('.work-row').filter({hasText:'#111'}).first();
  await expect(card).toContainText('NV03');
  await expect(card.locator('.work-hierarchy')).toContainText('Alpha');
  await expect(card.locator('.work-hierarchy')).toContainText('Xây dựng');
  await expect(card).not.toContainText('JOB ALPHA-111');
  await card.click();
  await expect(page.locator('#workDrawer')).toHaveClass(/open/);
  await expect(page.locator('#drawerProject')).toContainText('Alpha');
  await expect(page.locator('#drawerWorkstream')).toContainText('Xây dựng');
  await expect(page.locator('#drawerJob')).toContainText('ALPHA-111');
});

test('P0 hierarchy displays actual project, branch and parent issue without manufacturing links',async({page})=>{
  const parentRow={...snapshot.openWork[0],parentNumber:78};
  const rows=[parentRow,{...snapshot.openWork[2],projectId:null,projectName:null,workstreamId:null,workstreamName:null}];
  await routeTiger(page,{...snapshot,openWork:rows,activeWork:[],nextQueue:[]});
  await page.goto('https://tigeriq.test/command-center');
  const card=page.locator('.work-row[data-work-number="111"]');
  await expect(card.locator('.work-hierarchy')).toContainText('Alpha');
  await expect(card.locator('.work-hierarchy')).toContainText('Xây dựng');
  await expect(card.locator('.work-parent')).toContainText('#78');
  const missing=page.locator('.work-row[data-work-number="500"]');
  await expect(missing.locator('.work-hierarchy')).toContainText('Chưa phân dự án');
  await expect(missing.locator('.work-parent')).toHaveCount(0);
});

test('P0 removes the Owner dropdown strip but keeps status filters and all P0–P5 visible',async({page})=>{
  const rows=[
    {...snapshot.openWork[0],status:'ĐANG CHỜ',executionEligibility:'READY',number:111,priority:'P1',projectId:'alpha'},
    {...snapshot.openWork[1],status:'ĐANG CHỜ',executionEligibility:'PARKED_DEPENDENCY',number:112,priority:'P2',projectId:'alpha'},
    {...snapshot.openWork[2],status:'ĐANG LÀM',number:500,priority:'P5',projectId:'beta'},
    {...snapshot.openWork[3],status:'BỊ CHẶN',number:501,priority:'P0',projectId:'beta'}
  ];
  await routeTiger(page,{...snapshot,openWork:rows,activeWork:[],nextQueue:[],openSummary:{}});
  await page.goto('https://tigeriq.test/command-center');
  await expect(page.locator('.owner-filter-toolbar')).toHaveCount(0);
  await expect(page.locator('#workProjectFilter, #workStatusFilter, #workPriorityFilter, #bcctSort, #bcctRefresh')).toHaveCount(0);
  await expect(page.locator('.work-row')).toHaveCount(4);
  await expect(page.locator('.work-row[data-work-number="500"]')).toBeVisible();
  await page.locator('.filter[data-filter="waitblocked"]').click();
  await expect(page.locator('.work-row[data-work-number="112"]')).toBeVisible();
  await expect(page.locator('.work-row[data-work-number="501"]')).toBeVisible();
  await expect(page.locator('.work-row[data-work-number="111"]')).toHaveCount(0);
});

test('P0 LIVE cards show only employees with a fresh PC01 heartbeat and assigned running JOB',async({page})=>{
  const at=new Date().toISOString();
  const workers=[
    {employeeId:'NV20',label:'NVIDIA NIM',state:'working',currentJobId:'JOB-200',job:'Kiểm tra thay đổi LIVE',provider:'NVIDIA NIM',heartbeatAt:at,updatedAt:at},
    {employeeId:'NV10',label:'Ollama',state:'working',currentJobId:'JOB-100',job:'Rà soát bản phát hành',provider:'Ollama',heartbeatAt:at,updatedAt:at},
    {employeeId:'NV09',label:'Qwen3-Coder Local',state:'idle',currentJobId:null,job:'Chờ việc',heartbeatAt:at}
  ];
  await page.setViewportSize({width:1440,height:900});
  await routeTiger(page,{...snapshot,generatedAt:at,workers});
  await page.goto('https://tigeriq.test/command-center');
  await expect(page.locator('.live-worker-card')).toHaveCount(2);
  await expect(page.locator('.live-worker-card[data-live-employee="NV20"]')).toContainText('NVIDIA NIM');
  await expect(page.locator('.live-worker-card[data-live-employee="NV10"]')).toContainText('Rà soát bản phát hành');
  await expect(page.locator('.live-worker-card[data-live-employee="NV09"]')).toHaveCount(0);
  const positions=await page.evaluate(()=>({
    workers:document.querySelector('#liveWorkers')!.getBoundingClientRect().top,
    jobs:document.querySelector('#workListHeading')!.getBoundingClientRect().top
  }));
  expect(positions.workers).toBeLessThan(positions.jobs);
  await page.setViewportSize({width:390,height:844});
  const metrics=await page.evaluate(()=>({viewport:window.innerWidth,scroll:document.documentElement.scrollWidth}));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.viewport+1);
});

test('P0 LIVE never marks employees as running from stale or incomplete telemetry',async({page})=>{
  const now=new Date().toISOString();
  const base={employeeId:'NV20',label:'NVIDIA NIM',state:'working',currentJobId:'JOB-200',job:'Kiểm tra',heartbeatAt:now};
  const cases=[
    {generatedAt:now,liveConnected:false,workers:[base]},
    {generatedAt:'2026-01-01T00:00:00.000Z',liveConnected:true,workers:[base]},
    {generatedAt:now,liveConnected:true,workers:[{...base,currentJobId:null}]},
    {generatedAt:now,liveConnected:true,workers:[{...base,heartbeatAt:'2026-01-01T00:00:00.000Z'}]}
  ];
  for(const [index,data] of cases.entries()){
    await routeTiger(page,{...snapshot,...data});
    await page.goto('https://tigeriq.test/command-center');
    await expect(page.locator('.live-worker-card')).toHaveCount(0);
    await expect(page.locator('#liveWorkers')).toContainText(index<2?'CHƯA XÁC MINH':'0 NHÂN VIÊN');
    await page.unroute('https://tigeriq.test/**');
  }
});


test('P0 workforce cards use 3 / 2 / 1 columns; show job id directly and no overflow',async({page})=>{
  const at=new Date().toISOString();
  const active=Array.from({length:5},(_,i)=>({
    employeeId:'NV'+String(i+10),label:'Local worker '+(i+10),state:'working',
    currentJobId:'GH-'+(3000+i),job:'Đang kiểm tra công việc thứ '+(i+1),
    heartbeatAt:at,updatedAt:at
  }));
  await routeTiger(page,{...snapshot,generatedAt:at,workers:active});
  for(const [width,height,columns] of [[1440,900,7],[840,800,5],[390,844,3]] as const){
    await page.setViewportSize({width,height});
    await page.goto('https://tigeriq.test/command-center');
    await expect(page.locator('.live-worker-card')).toHaveCount(5);
    await expect(page.locator('.live-worker-card[data-live-employee="NV10"] .live-worker-code')).toHaveText('GH-3000');
    await expect(page.locator('.live-worker-card[data-live-employee="NV10"] .live-worker-job')).toContainText('Đang kiểm tra');
    const observed=await page.locator('.live-workers-grid').evaluate(el=>({
      columns:getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length,
      scroll:document.documentElement.scrollWidth,viewport:window.innerWidth
    }));
    expect(observed.columns).toBe(columns);
    expect(observed.scroll).toBeLessThanOrEqual(observed.viewport+1);
  }
});

test('P0 5-second workforce refresh does not rebuild unrelated work cards or unchanged employee DOM',async({page})=>{
  const at=new Date().toISOString();
  const employee={employeeId:'NV20',label:'NVIDIA NIM',state:'working',currentJobId:'GH-201',job:'JOB đầu tiên',heartbeatAt:at};
  let workforce:Record<string,unknown>={ok:true,liveConnected:true,generatedAt:at,workers:[employee]};
  let fullCalls=0,workforceCalls=0;
  await page.route('https://tigeriq.test/**',async(route:Route)=>{
    const url=route.request().url();
    if(url.includes('/api/live-status?scope=workforce')){
      workforceCalls++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(workforce)});return;
    }
    if(url.endsWith('/api/live-status')){
      fullCalls++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,generatedAt:at})});return;
    }
    if(url.endsWith('/work-center.js')){await route.fulfill({status:200,contentType:'text/javascript',body:sharedWorkJs});return}
    if(url.endsWith('/work-ui.css')){await route.fulfill({status:200,contentType:'text/css',body:sharedWorkCss});return}
    if(url.endsWith('/work-center-visual.css')){await route.fulfill({status:200,contentType:'text/css',body:workCenterVisualCss});return}
    if(url.endsWith('/command-center')){
      await route.fulfill({status:200,contentType:'text/html',body:liveHtml});return;
    }
    await route.fulfill({status:204,body:''});
  });
  await page.goto('https://tigeriq.test/command-center');
  await expect(page.locator('.live-worker-card')).toHaveCount(1);
  const before=await page.evaluate(()=>{
    const card=document.querySelector('.live-worker-card') as HTMLElement;
    const job=document.querySelector('.work-row[data-work-number="111"]') as HTMLElement;
    card.dataset.domIdentity='kept';
    job.dataset.workIdentity='kept';
    return {active:card.dataset.liveEmployee};
  });
  expect(before.active).toBe('NV20');
  workforce={...workforce,workers:[{...employee,job:'JOB đã đổi',currentJobId:'GH-202'}]};
  await page.evaluate(()=>(window as unknown as {loadWorkforce:()=>Promise<void>}).loadWorkforce());
  await expect(page.locator('.live-worker-card .live-worker-code')).toHaveText('GH-202');
  await expect(page.locator('.live-worker-card')).toHaveAttribute('data-dom-identity','kept');
  await expect(page.locator('.work-row[data-work-number="111"]')).toHaveAttribute('data-work-identity','kept');
  expect(fullCalls).toBe(1);
  expect(workforceCalls).toBeGreaterThanOrEqual(2);
  workforce={...workforce,workers:[]};
  await page.evaluate(()=>(window as unknown as {loadWorkforce:()=>Promise<void>}).loadWorkforce());
  await expect(page.locator('.live-worker-card')).toHaveCount(0);
});

test('P0 independent PC01 workforce failure clears active cards, without converting jobs into DONE',async({page})=>{
  const at=new Date().toISOString();
  let workforce:Record<string,unknown>={ok:true,liveConnected:true,generatedAt:at,workers:[
    {employeeId:'NV10',label:'Ollama',state:'working',job:'Đang rà soát',heartbeatAt:at,currentJobId:'GH-4242'}
  ]};
  await routeTiger(page,{...snapshot,generatedAt:at},()=>workforce);
  await page.goto('https://tigeriq.test/command-center');
  await expect(page.locator('.live-worker-card')).toHaveCount(1);
  workforce={ok:true,liveConnected:false,staleAll:true,generatedAt:at,workers:workforce.workers};
  await page.evaluate(()=>(window as unknown as {loadWorkforce:()=>Promise<void>}).loadWorkforce());
  await expect(page.locator('.live-worker-card')).toHaveCount(0);
  await expect(page.locator('#liveWorkers')).toContainText('CHƯA XÁC MINH');
  await expect(page.locator('.work-row[data-work-number="111"]')).toBeVisible();
});

test('work cards show evidence progress or an explicit non-quantified indicator and keep next action readable',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openLive(page);
  const verified=page.locator('.work-row').filter({hasText:'#111'}).first();
  await expect(verified.locator('.progress-text')).toHaveText('70%');
  const review=page.locator('.work-row').filter({hasText:'#112'}).first();
  await expect(review.locator('.progress-text')).toHaveText('Chưa đủ dữ liệu để tính %');
  await expect(review.locator('.work-quick')).toContainText('Kiểm tra toàn bộ dữ liệu hiện hành trên mobile dọc và mobile ngang trước khi đóng công việc');
});

test('LIVE removes redundant Work/Projects navigation on desktop and mobile',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await openLive(page);
  await expect(page.locator('.v2-global-nav')).toHaveCount(0);
  await expect(page.locator('.health-utility')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.v2-mobile-nav')).toHaveCount(0);
});

test('Projects page derives projects and workstreams from live data',async({page})=>{
  await routeTiger(page);await page.goto('https://tigeriq.test/projects');
  await expect(page.locator('#projectGrid')).toBeVisible();
  await expect(page.locator('[data-project-id="alpha"]')).toContainText('Alpha');
  await expect(page.locator('[data-project-id="alpha"]')).toContainText('Xây dựng');
  await expect(page.locator('[data-project-id="beta"]')).toContainText('Beta');
  await expect(page.locator('[data-project-id="beta"]')).toContainText('Phát hành');
  await expect(page.locator('.nav a.active')).toHaveAttribute('href','/projects');
});

test('mobile LIVE has no document overflow and work list remains first usable content',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openLive(page);
  const metrics=await page.evaluate(()=>({viewport:window.innerWidth,scroll:document.documentElement.scrollWidth,top:(document.querySelector('#workListHeading') as HTMLElement).getBoundingClientRect().top}));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.viewport+1);
  expect(metrics.top).toBeLessThan(520);
});


test('V2.1 issue and priority badges remain inside the card bounds on mobile and 4K',async({page})=>{
  for(const [width,height] of [[390,844],[3840,2160]]){
    await page.setViewportSize({width,height});await openLive(page);
    const card=page.locator('.work-row[data-work-number="111"]');
    const issue=card.locator('.work-id');
    const priority=card.locator('.priority');
    await expect(issue).toHaveText('#111');
    await expect(priority).toHaveText('P1');
    await expect(issue).toBeVisible();
    await expect(priority).toBeVisible();
    const p=await card.evaluate((element)=>{
      const row=element.getBoundingClientRect();
      const main=element.querySelector('.work-main')!.getBoundingClientRect();
      const id=element.querySelector('.work-id')!.getBoundingClientRect();
      const rank=element.querySelector('.priority')!.getBoundingClientRect();
      return {rowTop:row.top,rowLeft:row.left,rowRight:row.right,mainTop:main.top,
        idTop:id.top,idBottom:id.bottom,idLeft:id.left,
        priorityTop:rank.top,priorityBottom:rank.bottom,priorityRight:rank.right};
    });
    expect(p.idTop).toBeGreaterThanOrEqual(p.rowTop-1);
    expect(p.priorityTop).toBeGreaterThanOrEqual(p.rowTop-1);
    expect(p.idBottom).toBeLessThanOrEqual(p.mainTop+1);
    expect(p.priorityBottom).toBeLessThanOrEqual(p.mainTop+1);
    expect(p.idLeft).toBeGreaterThanOrEqual(p.rowLeft-1);
    expect(p.priorityRight).toBeLessThanOrEqual(p.rowRight+1);
  }
});

test('V2.1 semantic colors cover all eight statuses with dedicated system and completed filters',async({page})=>{
  const specs=[
    {number:801,status:'WORKING',color:'#10B981'},
    {number:802,status:'OWNER_GATE',color:'#A78BFA'},
    {number:803,status:'WAITING',color:'#F59E0B'},
    {number:804,status:'BLOCKED',color:'#F43F5E'},
    {number:805,status:'REVIEW',color:'#3B82F6'},
    {number:806,status:'VERIFY',color:'#14B8A6'},
    {number:807,status:'SYSTEM',color:'#64748B'},
    {number:808,status:'DONE',color:'#06B6D4'}
  ];
  const records=specs.map(item=>({...snapshot.openWork[0],number:item.number,title:'[P1] Thử màu '+item.status,
    status:item.status,workKind:item.status==='SYSTEM'?'SYSTEM':'WORK',progressSource:'',completionVerified:item.status==='DONE'}));
  const payload={...snapshot,openWork:records.filter(row=>row.status!=='DONE'),
    recentWork:records.filter(row=>row.status==='DONE'),activeWork:[]};
  await routeTiger(page,payload);
  await page.goto('https://tigeriq.test/command-center');
  for(const spec of specs){
    if(spec.status==='SYSTEM'){await expect(page.locator('.work-row[data-work-number="807"]')).toHaveCount(0);continue;}
    if(spec.status==='DONE')await page.locator('.filter[data-filter="closed"]').click();
    const row=page.locator('.work-row[data-work-number="'+spec.number+'"]');
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(new RegExp('status-'+spec.status.toLowerCase()));
    const color=await row.evaluate(element=>getComputedStyle(element).getPropertyValue('--status-color').trim().toUpperCase());
    expect(color).toBe(spec.color);
    if(spec.status==='DONE')await page.locator('.filter[data-filter="action"]').click();
  }
});

test('drawer GitHub link and both close methods remain functional',async({page})=>{
  const url='https://github.com/newsdayads/tigeriq-ai-lab/issues/111';
  const payload={...snapshot,openWork:[{...snapshot.openWork[0],url}]};
  await routeTiger(page,payload);
  await page.goto('https://tigeriq.test/command-center');
  const row=page.locator('.work-row[data-work-number="111"]');
  await row.click();
  await expect(page.locator('#workDrawer')).toHaveClass(/open/);
  await expect(page.locator('#drawerGithub')).toHaveAttribute('href',url);
  await expect(page.locator('#drawerGithub')).toHaveAttribute('target','_blank');
  await expect(page.locator('#drawerAskVy')).toBeVisible();
  await page.locator('#drawerCloseBottom').click();
  await expect(page.locator('#workDrawer')).not.toHaveClass(/open/);
  await row.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#workDrawer')).not.toHaveClass(/open/);
  await expect(row).toBeFocused();
});

test('Vy handoff opens a new ChatGPT project tab with encoded issue context, without real ChatGPT access',async({page})=>{
  const payload={...snapshot,openWork:[{...snapshot.openWork[0]}]};
  await routeTiger(page,payload);
  await page.context().route('https://chatgpt.com/**',async route=>{
    await route.fulfill({status:200,contentType:'text/html',body:'<html><title>Isolated handoff test</title></html>'});
  });
  await page.goto('https://tigeriq.test/command-center');
  await page.locator('.work-row[data-work-number="111"]').click();
  const nextPage=page.context().waitForEvent('page');
  await page.locator('#drawerAskVy').click();
  const popup=await nextPage;
  await popup.waitForLoadState('domcontentloaded');
  const link=new URL(popup.url());
  expect(link.origin).toBe('https://chatgpt.com');
  expect(link.pathname).toContain('/project');
  const handoff=link.searchParams.get('prompt')||'';
  expect(handoff).toContain('#111');
  expect(handoff).toContain('Xây giao diện công việc');
  await popup.close();
  // This tests outgoing URL construction only; acceptance by ChatGPT is NOT proven.
});


test('V2.2 next-step arrow and equal action buttons remain usable on mobile and desktop',async({page})=>{
  const link='https://github.com/newsdayads/tigeriq-ai-lab/issues/111';
  const fixture={...snapshot,openWork:[{...snapshot.openWork[0],url:link}]};
  await routeTiger(page,fixture);
  for(const [width,height] of [[390,844],[1440,900]]){
    await page.setViewportSize({width,height});
    await page.goto('https://tigeriq.test/command-center');
    const card=page.locator('.work-row[data-work-number="111"]');
    const action=card.locator('.work-quick.next');
    await expect(action).toContainText('Kiểm tra mobile');
    await expect(action.locator('svg.next-step-icon')).toBeVisible();
    await expect(action.locator('svg.next-step-icon')).toHaveAttribute('role','img');
    await card.click();
    const controls=[page.locator('#drawerAskVy'),page.locator('#drawerGithub'),page.locator('#drawerCloseBottom')];
    for(const control of controls)await expect(control).toBeVisible();
    const sizes=await Promise.all(controls.map(control=>control.boundingBox()));
    expect(sizes.every(Boolean)).toBe(true);
    const [vy,github,close]=sizes as {x:number,y:number,width:number,height:number}[];
    expect(vy.x).toBeLessThan(github.x);
    expect(github.x).toBeLessThan(close.x);
    expect(Math.abs(vy.width-github.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(github.width-close.width)).toBeLessThanOrEqual(2);
    await page.locator('#drawerCloseBottom').click();
  }
});

test('V2.2 dark surfaces and vector status stay readable without badge background',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openLive(page);
  const card=page.locator('.work-row[data-work-number="111"]');
  const colors=await card.evaluate(row=>{
    const surface=row.querySelector('.work-main')!;
    const state=row.querySelector('.state')!;
    const style=getComputedStyle(state);
    return {surface:getComputedStyle(surface).backgroundColor,stateBackground:style.backgroundColor,
      stateBorder:style.borderTopWidth,hasVector:!!state.querySelector('svg.live-status-icon')};
  });
  expect(colors.surface).toBe('rgb(16, 36, 58)');
  expect(colors.stateBackground).toBe('rgba(0, 0, 0, 0)');
  expect(colors.stateBorder).toBe('0px');
  expect(colors.hasVector).toBe(true);
});


test('V2.3 filters keep distinct review verification waiting blocked and paused statuses',async({page})=>{
  const rows=[
    {number:901,status:'CHỜ ANH SƠN',filter:'owner',color:'#A78BFA'},
    {number:902,status:'ĐANG LÀM',filter:'running',color:'#10B981'},
    {number:903,status:'ĐANG RÀ SOÁT',filter:'review',color:'#3B82F6'},
    {number:904,status:'ĐANG XÁC MINH',filter:'verify',color:'#14B8A6'},
    {number:905,status:'ĐANG CHỜ',filter:'waiting',color:'#F59E0B'},
    {number:906,status:'BỊ CHẶN',filter:'blocked',color:'#F43F5E'},
    {number:907,status:'TẠM DỪNG',filter:'paused',color:'#64748B'},
    {number:908,status:'SYSTEM',filter:'system',color:'#64748B'}
  ];
  const openWork=rows.map(item=>({...snapshot.openWork[0],number:item.number,
    title:'[P1] Phân loại '+item.filter,status:item.status,
    workKind:item.filter==='system'?'SYSTEM':'WORK',progressSource:''}));
  const recentWork=[{...snapshot.openWork[0],number:909,
    title:'[P1] Công việc đã hoàn tất',status:'HOÀN TẤT',workKind:'WORK',progressSource:'terminal',progressPercent:100,completionVerified:true}];
  await routeTiger(page,{...snapshot,openWork,recentWork,activeWork:[],
    nextQueue:[],openSummary:{}});
  await page.goto('https://tigeriq.test/command-center');
  for(const item of rows){
    await page.locator('.filter[data-filter="action"]').click();
    if(item.filter==='system'){await expect(page.locator('.work-row[data-work-number="908"]')).toHaveCount(0);continue;}
    const card=page.locator('.work-row[data-work-number="'+item.number+'"]');
    await expect(card).toBeVisible();
    const actual=await card.evaluate(element=>
      getComputedStyle(element).getPropertyValue('--status-color').trim().toUpperCase());
    expect(actual).toBe(item.color);
    await card.click();
    const drawer=page.locator('#workDrawer');
    await expect(drawer).toHaveClass(/open/);
    const detailColor=await drawer.evaluate(element=>
      getComputedStyle(element).getPropertyValue('--detail-color').trim().toUpperCase());
    expect(detailColor).toBe(item.color);
    await page.locator('#drawerCloseBottom').click();
  }
  await page.locator('.filter[data-filter="closed"]').click();
  await expect(page.locator('.work-row')).toHaveCount(1);
  await expect(page.locator('.work-row[data-work-number="909"]')).toBeVisible();
});

test('V2.4 checklist shows verified counts on the card and auditable steps in the detail drawer',async({page})=>{
  const row={...snapshot.openWork[0],
    progressPercent:50,progressSource:'checklist_verified',progressDetail:'2/4 bước xác minh',
    progressChecklistVerified:true,progressDone:2,progressTotal:4,progressRemaining:2,
    progressSteps:[
      {title:'Phân tích',done:true,evidenceUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/111'},
      {title:'Thiết kế',done:true,evidenceUrl:null},
      {title:'Kiểm thử',done:false,evidenceUrl:null},
      {title:'Xác minh',done:false,evidenceUrl:null}
    ]
  };
  await page.setViewportSize({width:390,height:844});
  await routeTiger(page,{...snapshot,openWork:[row],activeWork:[],nextQueue:[]});
  await page.goto('https://tigeriq.test/command-center');
  const card=page.locator('.work-row[data-work-number="111"]');
  await expect(card.locator('.progress-text')).toHaveText('50%');
  await expect(card.locator('.work-step-summary')).toContainText('2/4 bước đã xác minh');
  await expect(card.locator('.work-step-summary')).toContainText('Còn 2 bước');
  await card.click();
  const checklist=page.locator('#drawerChecklistSection');
  await expect(checklist).toBeVisible();
  await expect(page.locator('#drawerChecklistMeta')).toContainText('2/4 bước · còn 2 bước');
  await expect(page.locator('.drawer-checklist-step')).toHaveCount(4);
  await expect(page.locator('.drawer-checklist-step.verified.done')).toHaveCount(2);
  await expect(page.locator('.drawer-checklist-copy a').first()).toHaveAttribute('href','https://github.com/newsdayads/tigeriq-ai-lab/issues/111');
  await expect(page.locator('#drawerChecklistHint')).toContainText('100%');
});

test('V2.4 unchecked validation never fabricates a percentage, even when steps are marked',async({page})=>{
  const row={...snapshot.openWork[0],status:'WAITING',progressPercent:null,progressSource:'none',
    progressChecklistVerified:false,progressDone:1,progressTotal:2,progressRemaining:1,
    progressSteps:[{title:'Khảo sát',done:true,evidenceUrl:null},{title:'Triển khai',done:false,evidenceUrl:null}]};
  await routeTiger(page,{...snapshot,openWork:[row],activeWork:[],nextQueue:[]});
  await page.goto('https://tigeriq.test/command-center');
  const card=page.locator('.work-row[data-work-number="111"]');
  await expect(card.locator('.progress-text')).toHaveCount(0);
  await expect(card.locator('.work-step-summary')).toHaveCount(0);
  await card.click();
  await expect(page.locator('#drawerChecklistSection')).toBeVisible();
  await expect(page.locator('#drawerChecklistHint')).toContainText('chưa có xác nhận');
  await expect(page.locator('.drawer-checklist-step')).toHaveCount(2);
});

test('GitHub NEXT steps appear even with no verified checklist; no fabricated percentage',async({page})=>{
  const row={...snapshot.openWork[0],progressPercent:null,progressSource:'none',
    progressChecklistVerified:false,progressDone:0,progressTotal:0,progressRemaining:0,progressSteps:[],
    executionPlanSource:'GITHUB_CURRENT_NEXT',executionSteps:[
      {title:'Rà soát độc lập đúng HEAD',done:false,evidenceUrl:null},
      {title:'Kiểm chứng thực tế sau khi hợp nhất',done:false,evidenceUrl:null}
    ]};
  await routeTiger(page,{...snapshot,openWork:[row],activeWork:[],nextQueue:[]});
  await page.goto('https://tigeriq.test/command-center');
  const card=page.locator('.work-row[data-work-number="111"]');
  await expect(card.locator('.work-step-summary')).toHaveCount(0);
  await expect(card.locator('.progress-text')).toContainText('Chưa đủ dữ liệu để tính %');
  await card.click();
  await expect(page.locator('#drawerChecklistMeta')).toContainText('2 bước theo GitHub');
  await expect(page.locator('.drawer-checklist-step')).toHaveCount(2);
  await expect(page.locator('.drawer-checklist-copy').first()).toContainText('Rà soát độc lập đúng HEAD');
  await expect(page.locator('#drawerChecklistHint')).toContainText('không tính %');
  await expect(page.locator('.drawer-checklist-step.verified')).toHaveCount(0);
});

test('P0 GitHub verified gates render real percentage with evidence links, never infer DONE',async({page})=>{
  const row={...snapshot.openWork[0],number:987,progressPercent:50,progressSource:'github_gates_verified',
    progressDetail:'3/6 cổng GitHub xác minh',progressChecklistVerified:true,
    progressDone:3,progressTotal:6,progressRemaining:3,
    progressSteps:[
      {title:'PR đúng HEAD',done:true,evidenceUrl:'https://github.com/newsdayads/tigeriq-ai-lab/pull/11'},
      {title:'CI PASS',done:true,evidenceUrl:'https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/123'},
      {title:'Queue Hygiene PASS',done:true,evidenceUrl:'https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/456'},
      {title:'Rà soát độc lập',done:false,evidenceUrl:null},
      {title:'Merge',done:false,evidenceUrl:null},
      {title:'DONE',done:false,evidenceUrl:null}
    ]};
  await routeTiger(page,{...snapshot,openWork:[row],activeWork:[],nextQueue:[]});
  await page.goto('https://tigeriq.test/command-center');
  const card=page.locator('.work-row[data-work-number="987"]');
  await expect(card.locator('.progress-text')).toHaveText('50%');
  await expect(card.locator('.work-step-summary')).toContainText('3/6 cổng GitHub đã xác minh');
  await card.click();
  await expect(page.locator('#drawerChecklistSection h3')).toHaveText('CỔNG TIẾN ĐỘ GITHUB');
  await expect(page.locator('#drawerChecklistMeta')).toContainText('3/6 cổng GitHub');
  await expect(page.locator('.drawer-checklist-step.verified.done')).toHaveCount(3);
  await expect(page.locator('.drawer-checklist-copy a')).toHaveCount(3);
  await expect(page.locator('#drawerChecklistHint')).toContainText('100% chỉ khi công việc DONE');
});

test('P0 progress fixed at BOTTOM and exact semantic status color on all verified cards',async({page})=>{
  const colors=[
    ['OWNER_GATE','#A78BFA'],['WORKING','#10B981'],['REVIEW','#3B82F6'],
    ['VERIFY','#14B8A6'],['QUEUED','#F59E0B'],['WAITING','#F59E0B'],
    ['BLOCKED','#F43F5E'],['PAUSED','#64748B'],['DONE','#06B6D4']
  ] as const;
  const rows=colors.filter(x=>x[0]!=='DONE').map(([status],i)=>({
    ...snapshot.openWork[0],number:710+i,status,priority:'P1',workKind:'WORK',
    progressPercent:50,progressSource:'github_gates_verified',progressChecklistVerified:true,
    progressDone:3,progressTotal:6,progressRemaining:3,activeLease:false,heartbeatFresh:false,
    nextStep:'Bước tiếp: Kiểm tra mã nguồn'
  }));
  const done={...rows[0],number:719,status:'DONE',progressPercent:100,progressSource:'terminal',completionVerified:true};
  await routeTiger(page,{...snapshot,openWork:rows,recentWork:[done],activeWork:[],nextQueue:[],openSummary:{}});
  await page.goto('https://tigeriq.test/command-center');
  for(const [i,[state,color]] of colors.entries()){
    await page.locator('.filter[data-filter="'+(state==='DONE'?'closed':'action')+'"]').click();
    const card=page.locator('.work-row[data-work-number="'+(state==='DONE'?719:710+i)+'"]');
    await expect(card).toBeVisible();
    const data=await card.evaluate(el=>{
      const meter=el.querySelector('.progress')!,fill=el.querySelector('.progress-fill')!,pct=el.querySelector('.progress-text')!,
        action=el.querySelector('.work-quick')!,bottom=el.querySelector('.work-progress-bottom')!,
        title=el.querySelector('.work-title')!;
      return {status:getComputedStyle(el).getPropertyValue('--status-color').trim().toUpperCase(),
        meterColor:getComputedStyle(meter).color,fillColor:getComputedStyle(fill).backgroundColor,
        percentColor:getComputedStyle(pct).color,hasBottom:!!bottom,
        meterTop:meter.getBoundingClientRect().top,actionTop:action.getBoundingClientRect().top,
        titleTop:title.getBoundingClientRect().top,nextText:action.textContent||'',
        animated:getComputedStyle(fill,'::after').animationName};
    });
    const rgb=parseInt(color.slice(1,3),16)+', '+parseInt(color.slice(3,5),16)+', '+parseInt(color.slice(5,7),16);
    expect(data.status).toBe(color);
    expect(data.fillColor).toBe('rgb('+rgb+')');
    expect(data.percentColor).toBe('rgb('+rgb+')');
    expect(data.hasBottom).toBe(true);
    expect(data.meterTop).toBeGreaterThan(data.actionTop);
    expect(data.actionTop).toBeGreaterThan(data.titleTop);
    expect(data.nextText).not.toMatch(/Bước tiếp/i);
    expect(data.animated).toBe('none');
  }
});

test('P0 shimmer is shown only for live WORKING runtime lease, never on review or stale',async({page})=>{
  const active={...snapshot.openWork[0],number:810,activeLease:true,heartbeatFresh:true,status:'WORKING',
    progressSource:'explicit_verified',progressPercent:50};
  const review={...active,number:811,status:'REVIEW'};
  await routeTiger(page,{...snapshot,openWork:[active,review],activeWork:[],nextQueue:[],openSummary:{},liveConnected:true});
  await page.goto('https://tigeriq.test/command-center');
  const activeCard=page.locator('.work-row[data-work-number="810"]');
  const reviewCard=page.locator('.work-row[data-work-number="811"]');
  await expect(activeCard).toHaveClass(/progress-running/);
  await expect(reviewCard).not.toHaveClass(/progress-running/);
  const animations=await Promise.all([activeCard,reviewCard].map(card=>card.locator('.progress-fill').evaluate(el=>getComputedStyle(el,'::after').animationName)));
  expect(animations[0]).toContain('progress-shimmer');
  expect(animations[1]).toBe('none');
});

test('LIVE owner grid shows at most four cards per desktop row and readable iPhone fallback',async({page})=>{
  const samples:[[number,number,number],[number,number,number],[number,number,number],[number,number,number]]=[
    [1664,950,4],[2560,1440,4],[1280,900,4],[390,844,1]
  ];
  for(const [width,height,columns] of samples){
    await page.setViewportSize({width,height});
    await openLive(page);
    const actual=await page.locator('#workList').evaluate((el)=>{
      const computed=getComputedStyle(el);
      return {columns:computed.gridTemplateColumns.split(' ').filter(Boolean).length,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
    });
    expect(actual.columns).toBe(columns);
    expect(actual.scrollWidth).toBeLessThanOrEqual(actual.viewport+1);
    const card=page.locator('.work-row').first();
    await expect(card.locator('.work-id')).toBeVisible();
    await expect(card.locator('.priority')).toBeVisible();
    await expect(card.locator('.work-title')).toBeVisible();
  }
});


test('Production-line LIVE keeps workforce widgets and orders system P1–P5 before products without hiding P5',async({page})=>{
  const entries=[
    {number:2293,priority:'P5',title:'[P5] Apify'},
    {number:4456,priority:'P2',title:'[P2] News'},
    {number:4661,priority:'P2',title:'[P2] Isolation'},
    {number:4578,priority:'P4',title:'[P4] Skills'},
    {number:4595,priority:'P3',title:'[P3] API Doctor'},
    {number:2949,priority:'P2',title:'[P2] S10'},
    {number:4457,priority:'P1',title:'[P1] Core'},
    {number:4569,priority:'P4',title:'[P4] Communication'},
    {number:4532,priority:'P4',title:'[P4] Cline'},
    {number:999,priority:'P0',title:'[P0] Owner-only'},
    {number:4636,priority:'P3',title:'[P3] Workflow Lab'}
  ];
  const openWork=entries.map(x=>({...x,workKind:'WORK',status:'WAITING'}));
  await routeTiger(page,{...snapshot,openWork,activeWork:[],nextQueue:[],openSummary:{},workers:[],workProjection:{...snapshot.workProjection,ownerBacklogOrder:[4457,2949,4661,4595,4532,4578,4569,4456,4636,2293],openIssueEnumerationComplete:true}});
  await page.goto('https://tigeriq.test/command-center');
  const ids=await page.locator('#workList [data-work-number]').evaluateAll(nodes=>nodes.map(n=>Number(n.getAttribute('data-work-number'))));
  expect(ids).toEqual([4457,2949,4661,4595,4532,4578,4569,4456,4636,2293,999]);
  await expect(page.locator('#workList [data-work-number="2293"]')).toBeVisible();
  await expect(page.locator('#actionCount')).toHaveText('11');
  await expect(page.locator('#bcctSort')).toHaveCount(0);
  await expect(page.locator('#liveWorkers')).toBeVisible();
  await page.locator('#workList [data-work-number="4457"]').click();
  await expect(page.locator('#drawerTerminalState')).toContainText('CHƯA KẾT THÚC');
  await expect(page.locator('#drawerTerminalCriteria')).toContainText('Chỉ kết thúc khi');
});

test('Projects keeps seven groups plus custom projects and counts recent/owner-gated work once',async({page})=>{
  const definitions=[
    {id:'tigeriq-ai',name:'TigerIQ AI',children:['tigeriq-platform','tigeriq-mobile-worker','tigeriq-live','tigeriq-workflow-lab','tigeriq-app-chrome']},
    {id:'tigeriq-news',name:'TigerIQ News / Media',children:['tigeriq-news']},
    {id:'paperclip-vnext',name:'Paperclip vNext',children:['paperclip-vnext']},
    {id:'revenue-lab',name:'Revenue Lab',children:['revenue-lab']},
    {id:'tigeriq-driver',name:'TigerIQ Driver',children:['tigeriq-driver']},
    {id:'dexcam-personal',name:'DeXCam Personal',children:['dexcam-personal']},
    {id:'tigeriq-coin',name:'TigerIQ Coin',children:['tigeriq-coin']},
  ];
  const gate={number:8401,title:'Driver gate',status:'OWNER_GATE',workKind:'WORK',projectId:'tigeriq-driver',projectName:'TigerIQ Driver',workstreamId:'release',workstreamName:'Phát hành'};
  const done={...gate,number:8402,title:'Driver complete',status:'DONE'};
  const data={...snapshot,
    portfolioGroups:definitions.map(g=>({id:g.id,name:g.name,projects:g.children.map(id=>({id,name:id,counts:{working:0,review:0,blocked:0,waiting:0,done:0},workstreams:[]}))})),
    openWork:[...snapshot.openWork,gate],
    activeWork:snapshot.activeWork,
    recentWork:[done],
  };
  await routeTiger(page,data);await page.goto('https://tigeriq.test/projects');
  await expect(page.locator('.project-card')).toHaveCount(9);
  for(const group of definitions)await expect(page.locator('.project-card[data-project-id="'+group.id+'"]')).toBeVisible();
  await expect(page.locator('.project-card[data-project-id="alpha"]')).toContainText('Đang làm 1');
  await expect(page.locator('.project-card[data-project-id="alpha"]')).toContainText('Rà soát 1');
  await expect(page.locator('.project-card[data-project-id="alpha"]')).toContainText('2 công việc');
  await expect(page.locator('.project-card[data-project-id="beta"]')).toContainText('Beta');
  const driver=page.locator('.project-card[data-project-id="tigeriq-driver"]');
  await expect(driver).toContainText('Bị chặn 1');
  await expect(driver).toContainText('Xong 1');
  await expect(driver).toContainText('2 công việc trong nguồn');
});

test('LIVE uses current GitHub owner order instead of hardcoded issue IDs',async({page})=>{
  const openWork=[{number:4457,title:'Core',priority:'P1',status:'WAITING',workKind:'WORK'},{number:4456,title:'News',priority:'P2',status:'WAITING',workKind:'WORK'},{number:2293,title:'Apify',priority:'P5',status:'WAITING',workKind:'WORK'}];
  await routeTiger(page,{...snapshot,openWork,activeWork:[],nextQueue:[],openSummary:{},workers:[],workProjection:{...snapshot.workProjection,ownerBacklogOrder:[4456,2293,4457]}});
  await page.goto('https://tigeriq.test/command-center');
  const ids=await page.locator('#workList [data-work-number]').evaluateAll(nodes=>nodes.map(n=>Number(n.getAttribute('data-work-number'))));
  expect(ids).toEqual([4456,2293,4457]);
});
