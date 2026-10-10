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

test('V5 displays incomplete GitHub history without inventing a full catalog',async({page})=>{
  await openLab(page,{...payload,coverage:{complete:false,truncated:true,pagesFetched:1,stopReason:'GITHUB_HTTP_422_PAGE_2',nextSince:null}});
  await expect(page.locator('#catalogDescription')).toContainText('CHƯA ĐẦY ĐỦ');
  await expect(page.locator('#catalogDescription')).toContainText('GITHUB_HTTP_422_PAGE_2');
});
