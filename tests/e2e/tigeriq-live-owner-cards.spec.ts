import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';

test.use({ channel: 'chrome' });

const liveHtml = fs.readFileSync(new URL('../../command-center.html', import.meta.url), 'utf8');
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

async function routeTiger(page:Page,payload:Record<string,unknown>=snapshot){
  await page.route('https://tigeriq.test/**',async(route:Route)=>{
    const url=route.request().url();
    if(url.endsWith('/api/live-status')){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});return}
    if(url.endsWith('/projects')){await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:projectsHtml});return}
    if(url.endsWith('/command-center')){await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:liveHtml});return}
    await route.fulfill({status:204,body:''});
  });
}

async function openLive(page:Page){await routeTiger(page);await page.goto('https://tigeriq.test/command-center');await expect(page.locator('#workList')).toBeVisible()}

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
  await expect(card).not.toContainText('Alpha');
  await expect(card).not.toContainText('Xây dựng');
  await expect(card).not.toContainText('JOB ALPHA-111');
  await card.click();
  await expect(page.locator('#workDrawer')).toHaveClass(/open/);
  await expect(page.locator('#drawerProject')).toContainText('Alpha');
  await expect(page.locator('#drawerWorkstream')).toContainText('Xây dựng');
  await expect(page.locator('#drawerJob')).toContainText('ALPHA-111');
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
    status:item.status,workKind:item.status==='SYSTEM'?'SYSTEM':'WORK',progressSource:''}));
  const payload={...snapshot,openWork:records.filter(row=>row.status!=='DONE'),
    recentWork:records.filter(row=>row.status==='DONE'),activeWork:[]};
  await routeTiger(page,payload);
  await page.goto('https://tigeriq.test/command-center');
  for(const spec of specs){
    if(spec.status==='SYSTEM')await page.locator('.filter[data-filter="system"]').click();
    else if(spec.status==='DONE')await page.locator('.filter[data-filter="done"]').click();
    const row=page.locator('.work-row[data-work-number="'+spec.number+'"]');
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(new RegExp('status-'+spec.status.toLowerCase()));
    const color=await row.evaluate(element=>getComputedStyle(element).getPropertyValue('--status-color').trim().toUpperCase());
    expect(color).toBe(spec.color);
    if(spec.status==='SYSTEM')await page.locator('.filter[data-filter="action"]').click();
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
    title:'[P1] Công việc đã hoàn tất',status:'HOÀN TẤT',workKind:'WORK',progressSource:'terminal',progressPercent:100}];
  await routeTiger(page,{...snapshot,openWork,recentWork,activeWork:[],
    nextQueue:[],openSummary:{}});
  await page.goto('https://tigeriq.test/command-center');
  for(const item of rows){
    await page.locator('.filter[data-filter="'+item.filter+'"]').click();
    const filtered=page.locator('.work-row');
    await expect(filtered).toHaveCount(1);
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
  await page.locator('.filter[data-filter="done"]').click();
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
  await expect(card.locator('.work-step-summary')).toContainText('chưa xác minh');
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
  await expect(card.locator('.work-step-summary')).toContainText('2 bước theo GitHub');
  await expect(card.locator('.progress-text')).toHaveCount(0);
  await card.click();
  await expect(page.locator('#drawerChecklistMeta')).toContainText('2 bước theo GitHub');
  await expect(page.locator('.drawer-checklist-step')).toHaveCount(2);
  await expect(page.locator('.drawer-checklist-copy').first()).toContainText('Rà soát độc lập đúng HEAD');
  await expect(page.locator('#drawerChecklistHint')).toContainText('không tính %');
  await expect(page.locator('.drawer-checklist-step.verified')).toHaveCount(0);
});

test('LIVE compact owner grid shows five to six cards per row on desktop with readable mobile fallback',async({page})=>{
  const samples:[[number,number,number],[number,number,number],[number,number,number],[number,number,number]]=[
    [1664,950,5],[2560,1440,6],[1280,900,4],[390,844,1]
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
