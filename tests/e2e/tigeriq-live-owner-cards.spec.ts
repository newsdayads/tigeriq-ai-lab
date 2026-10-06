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
    {number:112,title:'[P1][REVIEW] Rà soát giao diện',status:'RÀ SOÁT',workKind:'WORK',priority:'P1',employeeId:'NV12',projectId:'alpha',projectName:'Alpha',workstreamId:'build',workstreamName:'Xây dựng',jobId:'ALPHA-112'},
    {number:500,title:'[P1] Phát hành Beta',status:'ĐANG XỬ LÝ',workKind:'WORK',priority:'P1',employeeId:'NV06',projectId:'beta',projectName:'Beta',workstreamId:'release',workstreamName:'Phát hành',jobId:'BETA-500'},
    {number:501,title:'[P1] Beta bị chặn',status:'BỊ CHẶN',workKind:'WORK',priority:'P1',employeeId:'NV06',blocker:'Thiếu bằng chứng',projectId:'beta',projectName:'Beta',workstreamId:'release',workstreamName:'Phát hành',jobId:'BETA-501'}
  ],
  activeWork:[{number:111,title:'[P1] Xây giao diện công việc',status:'ĐANG XỬ LÝ',workKind:'WORK',priority:'P1',employeeId:'NV03',assignee:'NV03',currentStep:'Dựng thẻ công việc',nextStep:'Kiểm tra mobile',progressPercent:70,progressSource:'explicit_verified',projectId:'alpha',projectName:'Alpha',workstreamId:'build',workstreamName:'Xây dựng',jobId:'ALPHA-111'}],
  nextQueue:[],recentWork:[],workers:[{employeeId:'NV03',state:'working',status:'ĐANG LÀM'}]
};

async function routeTiger(page:Page){
  await page.route('https://tigeriq.test/**',async(route:Route)=>{
    const url=route.request().url();
    if(url.endsWith('/api/live-status')){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot)});return}
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

test('work cards retain project, workstream, job and assignee context',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await openLive(page);
  const card=page.locator('.work-row').filter({hasText:'#111'}).first();
  await expect(card).toContainText('Alpha');
  await expect(card).toContainText('Xây dựng');
  await expect(card).toContainText('JOB ALPHA-111');
  await expect(card).toContainText('NV03');
  await card.click();
  await expect(page.locator('#workDrawer')).toHaveClass(/open/);
  await expect(page.locator('#drawerProject')).toContainText('Alpha');
  await expect(page.locator('#drawerWorkstream')).toContainText('Xây dựng');
});

test('navigation separates Work and Projects on desktop and mobile',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await openLive(page);
  await expect(page.locator('.v2-global-nav')).toContainText('Công việc');
  await expect(page.locator('.v2-global-nav')).toContainText('Dự án');
  await expect(page.locator('.v2-global-nav a[href="/projects"]')).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.v2-mobile-nav a[href="/projects"]')).toBeVisible();
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
