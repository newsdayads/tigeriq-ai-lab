import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.use({ channel: 'chrome' });

// Hermetic UI acceptance only. Not the protected Vercel preview.
const html = readFileSync(new URL('../../labs/workflow-lab-v5/index.html', import.meta.url), 'utf8');
const issue = (number:number, state:'open'|'closed', current:string, reason:string|null=null) => ({
  number, title: number===88?'Không triển khai tính năng cũ':'Xử lý lỗi phân công',
  body:['PROJECT_ID=tigeriq-ai-lab','CURRENT_STATE='+current].join(String.fromCharCode(10)),
  state, state_reason:reason, updated_at:'2026-10-10T06:00:00Z',
  html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/'+number,
});
const payload={ ok:true, issues:[issue(88,'closed','NOT_PLANNED','not_planned'),issue(99,'open','BLOCKED_WAIT')], coverage:{
  complete:true, truncated:false,pagesFetched:1,stopReason:null,nextSince:null
}, core:{connected:false,stale:true,rows:[],reason:'CORE_UNAVAILABLE'} };

async function openLab(page:Page, data:unknown=payload){
  await page.route('https://workflow-lab.test/**',async(route:Route)=>{
    if(new URL(route.request().url()).pathname==='/api/portfolio') {
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});return;
    }
    await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});
  });
  await page.goto('https://workflow-lab.test/');
  await expect(page.locator('#projectCards .projecttile').first()).toBeVisible();
}

test('V5 excludes stale Core rows so old BLOCKED/employee/nextStep cannot override GitHub',async({page})=>{
 const current={...issue(4457,'open','WORKING'),
  title:'[P1][CORE vNext] Source still working',
  body:['PROJECT_ID=tigeriq-platform','CURRENT_STATE=WORKING','ASSIGNEE=NV02','NEXT_ACTION=Verify GitHub source changes'].join(String.fromCharCode(10))};
 const data={...payload,issues:[current],
  core:{connected:true,stale:true,rows:[
   {number:4457,status:'BLOCKED',employeeId:'NV09',nextStep:'Outdated Core retry loop'},
  ]}};
 await openLab(page,data);
 await page.locator('[data-project="tigeriq-platform"]').click();
 await expect(page.locator('#jobCards .jobcard')).toContainText('ĐANG LÀM');
 await expect(page.locator('#jobCards .jobcard')).not.toContainText('BỊ CHẶN');
 await page.locator('#jobCards .jobcard').click();
 await expect(page.locator('#graph')).toContainText('NV02');
 await expect(page.locator('#graph')).toContainText('Verify GitHub source changes');
 await expect(page.locator('#graph')).not.toContainText('Outdated Core retry loop');
 await expect(page.locator('#graph')).not.toContainText('NV09');
});

test('V5 keeps active Core evidence ahead of stale recentWork for the same GitHub issue',async({page})=>{
 const data={...payload,
  issues:[{...issue(4457,'open','REVIEW'),title:'[P1][CORE vNext] Current manager activity'}],
  core:{connected:true,stale:false,rows:[
   {number:4457,status:'active',employeeId:'NV09',nextStep:'Continue current source review'},
   {number:4457,status:'completed',employeeId:'NV03',nextStep:'Superseded old activity'},
  ]},
 };
 await openLab(page,data);
 await page.locator('[data-project="tigeriq-platform"]').click();
 await page.locator('#jobCards .jobcard').click();
 await expect(page.locator('#graph')).toContainText('NV09');
 await expect(page.locator('#graph')).toContainText('Continue current source review');
 await expect(page.locator('#graph')).not.toContainText('Superseded old activity');
});

test('V5 project and issue navigation keeps GitHub closed distinct from completed',async({page})=>{
  await openLab(page);
  await page.locator('[data-project="tigeriq-platform"]').click();
  await expect(page.locator('#jobCards .jobcard')).toHaveCount(2);
  await page.locator('[data-jobfilter="closed"]').click();
  await expect(page.locator('#jobCards .jobcard')).toHaveCount(1);
  await page.locator('#jobCards .jobcard').click();
  await expect(page.locator('#workflowScreen')).toBeVisible();
  await expect(page.locator('#graph')).toContainText('ĐÃ ĐÓNG TRÊN GITHUB');
  await expect(page.locator('#graph')).toContainText('không thực hiện');
  await expect(page.locator('#graph')).not.toContainText('HOÀN TẤT 100%');
});

test('V5 follows two bounded history windows and de-duplicates by issue number',async({page})=>{
 let calls=0;
 const old={...issue(88,'open','REVIEW'),title:'Earlier issue state',updated_at:'2026-09-01T00:00:00Z'};
 const latest={...old,title:'Latest issue state',updated_at:'2026-10-10T06:00:00Z'};
 await page.route('https://workflow-lab.test/**',async(route:Route)=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/portfolio'){
   calls++;
   const first=!url.searchParams.has('since');
   const data={...payload,issues:first?[old,issue(99,'open','BLOCKED_WAIT')]:[latest,issue(120,'open','REVIEW')],
    coverage:{...payload.coverage,complete:!first,truncated:first,pagesFetched:first?8:1,
     stopReason:first?'NEXT_WINDOW_AVAILABLE':null,nextSince:first?'2026-09-01T00:00:00Z':null}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});return;
  }
  await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});
 });
 await page.goto('https://workflow-lab.test/');
 await expect(page.locator('#catalogDescription')).toContainText('ĐÃ ĐỌC TỚI CUỐI PHÂN TRANG');
 await page.locator('[data-project="tigeriq-platform"]').click();
 await expect(page.locator('#jobCards .jobcard')).toHaveCount(3);
 await expect(page.locator('#jobCards')).toContainText('Latest issue state');
 await expect(page.locator('#jobCards')).not.toContainText('Earlier issue state');
 expect(calls).toBe(2);
});

test('V5 retains verified partial history and flags a failed second window',async({page})=>{
 let calls=0;
 await page.route('https://workflow-lab.test/**',async(route:Route)=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/portfolio'){
   calls++;
   if(url.searchParams.has('since')){
    await route.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"reason":"GITHUB_HTTP_503_PAGE_1"}'});return;
   }
   const data={...payload,coverage:{...payload.coverage,complete:false,truncated:true,
    pagesFetched:8,stopReason:'NEXT_WINDOW_AVAILABLE',nextSince:'2026-09-01T00:00:00Z'}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});return;
  }
  await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});
 });
 await page.goto('https://workflow-lab.test/');
 await expect(page.locator('#catalogDescription')).toContainText('CHƯA ĐẦY ĐỦ');
 await expect(page.locator('#catalogDescription')).toContainText('CỬA SỔ 2');
 await page.locator('[data-project="tigeriq-platform"]').click();
 await expect(page.locator('#jobCards .jobcard')).toHaveCount(2);
 expect(calls).toBe(2);
});

test('V5 displays incomplete GitHub history without inventing a full catalog',async({page})=>{
  await openLab(page,{...payload,coverage:{complete:false,truncated:true,pagesFetched:1,stopReason:'GITHUB_HTTP_422_PAGE_2',nextSince:null}});
  await expect(page.locator('#catalogDescription')).toContainText('CHƯA ĐẦY ĐỦ');
  await expect(page.locator('#catalogDescription')).toContainText('GITHUB_HTTP_422_PAGE_2');
});


test('V5 portfolio contains every canonical project from main portfolio registry',async({page})=>{
  const portfolio=readFileSync(new URL('../../projects/portfolio.yaml',import.meta.url),'utf8');
  const canonical=[...portfolio.matchAll(/^\s+children:\s*\[([^\]]+)\]/gm)]
    .flatMap((m)=>m[1].split(',').map(s=>s.trim())).sort();
  await openLab(page);
  const ids=await page.locator('#projectCards [data-project]').evaluateAll(
    nodes=>nodes.map(n=>n.getAttribute('data-project')||'').sort());
  expect(ids).toEqual(canonical);
  expect(ids).toHaveLength(11);
});

test('V5 DeXCam and Workflow Lab issues route to their own canonical projects',async({page})=>{
 const dexcam={...issue(4625,'open','SPEC_DOCUMENTATION_REVIEW_PENDING'),
   title:'[P1][ANDROID/DEX] DeXCam Personal — camera lùi',
   body:'PROJECT_ID=TIGERIQ_DEXCAM_PERSONAL'};
 const workflow={...issue(4636,'open','WORKING'),
   title:'[P1][WORKFLOW LAB V5] Portfolio các dự án',
   body:'PROJECT_ID=tigeriq-workflow-lab'};
 await openLab(page,{...payload,issues:[...payload.issues,dexcam,workflow]});
 await page.locator('[data-project="dexcam-personal"]').click();
 await expect(page.locator('#jobCards')).toContainText('DeXCam Personal');
 await expect(page.locator('#jobCards')).not.toContainText('Workflow Lab');
 await page.locator('#backToProjects').click();
 await page.locator('[data-project="tigeriq-workflow-lab"]').click();
 await expect(page.locator('#jobCards')).toContainText('Portfolio các dự án');
 await expect(page.locator('#jobCards')).not.toContainText('DeXCam Personal');
 await page.locator('#backToProjects').click();
 await page.locator('[data-project="tigeriq-mobile-worker"]').click();
 await expect(page.locator('#jobCards')).not.toContainText('DeXCam Personal');
});


test('V5 incomplete coverage warning remains visible in project and issue detail',async({page})=>{
 const data={...payload,coverage:{...payload.coverage,complete:false,truncated:true,stopReason:'GITHUB_HTTP_422_PAGE_2',nextSince:null}};
 await openLab(page,data);
 await page.locator('[data-project="tigeriq-platform"]').click();
 await expect(page.locator('#catalogDescription')).toContainText('CHƯA ĐẦY ĐỦ');
 await page.locator('#jobCards .jobcard').first().click();
 await expect(page.locator('#workflowScreen .top-right .chip.warn')).toContainText('CHƯA ĐẦY ĐỦ');
 await expect(page.locator('#workflowScreen .graph-head small')).toContainText('GITHUB_HTTP_422_PAGE_2');
});


test('V5 explicitly distinguishes central GitHub issues from external repository history',async({page})=>{
 await openLab(page);
 await expect(page.locator('.labnotice')).toContainText('newsdayads/tigeriq-ai-lab');
 await expect(page.locator('.labnotice')).toContainText('Chưa thống kê các repository ngoài');
 await expect(page.locator('#portfolioStats')).toContainText('ISSUE REPO TRUNG TÂM');
});


test('V5 ignores unrelated project names in issue body when inferring issue project',async({page})=>{
 const coreIssue={...issue(4457,'open','REVIEW'),
  title:'[P1][CORE vNext] Durable AI manager checkpoint',
  body:'CURRENT_STATE=REVIEW\nNotes: Workflow Lab V5 has a separate approval process; App Chrome is local only; DeXCam Personal is independent.'};
 const apiIssue={...issue(4595,'open','BLOCKED'),
  title:'[P1][API DOCTOR] openrouter source repair',
  body:'CURRENT_STATE=BLOCKED\nNotes: DeXCam Personal must not be modified.'};
 const explicit={...issue(4625,'open','SPEC_DOCUMENTATION_REVIEW_PENDING'),
  title:'[P1][ANDROID] Generic legacy work',
  body:'PROJECT_ID=dexcam-personal\nNotes: Workflow Lab owns a different scope.'};
 await openLab(page,{...payload,issues:[coreIssue,apiIssue,explicit]});
 await page.locator('[data-project="tigeriq-platform"]').click();
 await expect(page.locator('#jobCards')).toContainText('Durable AI manager checkpoint');
 await expect(page.locator('#jobCards')).toContainText('openrouter source repair');
 await page.locator('#backToProjects').click();
 await page.locator('[data-project="tigeriq-workflow-lab"]').click();
 await expect(page.locator('#jobCards')).not.toContainText('Durable AI manager checkpoint');
 await page.locator('#backToProjects').click();
 await page.locator('[data-project="dexcam-personal"]').click();
 await expect(page.locator('#jobCards')).toContainText('Generic legacy work');
 await expect(page.locator('#jobCards')).not.toContainText('openrouter source repair');
});


test('V5 issue detail discloses whether project assignment is explicit or inferred',async({page})=>{
 const withId={...issue(4625,'open','PLANNING'),
  title:'[P1][ANDROID] Generic item',
  body:'PROJECT_ID=dexcam-personal\nCURRENT_STATE=PLANNING'};
 const titleOnly={...issue(4457,'open','REVIEW'),
  title:'[P1][CORE vNext] Manager checkpoint',
  body:'CURRENT_STATE=REVIEW\nThe separate Workflow Lab should not be modified'};
 await openLab(page,{...payload,issues:[withId,titleOnly]});
 await page.locator('[data-project="dexcam-personal"]').click();
 await page.locator('#jobCards .jobcard').click();
 await expect(page.locator('#workflowScreen .source-evidence-note')).toContainText('Phân nhóm dự án theo PROJECT_ID');
 await page.locator('#jobBack').click();
 await page.locator('#backToProjects').click();
 await page.locator('[data-project="tigeriq-platform"]').click();
 await page.locator('#jobCards .jobcard').filter({hasText:'Manager checkpoint'}).click();
 await expect(page.locator('#workflowScreen .source-evidence-note')).toContainText('Phân nhóm dự án suy luận từ tiêu đề');
});


test('V5 honors canonical project and status fields extracted beyond 1500-character GitHub body',async({page})=>{
 const dexcam={...issue(4625,'open',''),
   title:'[P1] Generic personal Android work',
   body:'Historical description '+'x'.repeat(1500),
   project_id:'dexcam-personal',current_state:'BLOCKED_REAL_DEVICE',
   worker:'NV02',next_action:'Review physical camera connection',target_pr:'4637'};
 await openLab(page,{...payload,issues:[dexcam]});
 await page.locator('[data-project="dexcam-personal"]').click();
 await expect(page.locator('#jobCards')).toContainText('Generic personal Android work');
 await expect(page.locator('#jobCards')).toContainText('BỊ CHẶN');
 await page.locator('#jobCards .jobcard').click();
 await expect(page.locator('#workflowScreen .source-evidence-note')).toContainText('Phân nhóm dự án theo PROJECT_ID');
 await expect(page.locator('#graph')).toContainText('BLOCKED_REAL_DEVICE');
 await expect(page.locator('#graph')).toContainText('NV02');
 await expect(page.locator('#graph')).toContainText('Review physical camera connection');
 await expect(page.locator('#graph')).toContainText('PR #4637');
});
