import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir=fileURLToPath(new URL('../../public/',import.meta.url));
let server:Server|null=null; let baseUrl='';
const contentType=(path:string)=>({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json'}[extname(path)]||'text/plain; charset=utf-8');

test.beforeAll(async()=>{
  server=createServer(async(req,res)=>{
    const url=new URL(req.url||'/','http://127.0.0.1');
    if(url.pathname.startsWith('/api/')){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'NOT_AVAILABLE_IN_STATIC_E2E'}));return;}
    const relative=url.pathname==='/'?'web-v1/index.html':url.pathname.replace(/^\/+/, '');
    const safe=normalize(relative).replace(/^\.\.(?:[\\/]|$)/,'');
    try{const body=await readFile(join(publicDir,safe));res.writeHead(200,{'content-type':contentType(safe),'cache-control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end('not found');}
  });
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('E2E_SERVER_ADDRESS_INVALID');baseUrl=`http://127.0.0.1:${address.port}`;
});
test.afterAll(async()=>{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));});

test('TIG Owner Cockpit V3 desktop keeps executive hierarchy and 5-item sidebar',async({page})=>{
  await page.setViewportSize({width:1440,height:960});
  await page.route('https://accounts.google.com/**',route=>route.abort());
  await page.goto(`${baseUrl}/web-v1/index.html`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.brand-mark')).toHaveText('TIG');
  await expect(page.locator('.brand-sigil b')).toHaveText('TIG');
  expect(await page.locator('.nav button').count()).toBe(5);
  expect(await page.locator('.nav button span').allTextContents()).toEqual(['Tổng quan','CẦN SẾP','Công việc','Công ty','Hệ thống']);
  const layout=await page.evaluate(()=>{const sidebar=document.querySelector('.sidebar');if(!sidebar)throw new Error('SIDEBAR_MISSING');return{position:getComputedStyle(sidebar).position,height:(sidebar as HTMLElement).getBoundingClientRect().height,viewport:window.innerHeight,scrollWidth:document.body.scrollWidth,innerWidth:window.innerWidth};});
  expect(layout.position).toBe('sticky');
  expect(layout.height).toBeGreaterThan(layout.viewport*.9);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth+1);
  await expect(page.locator('#companySummary')).toBeVisible();
  await expect(page.locator('#cockpitMissionCount')).toBeVisible();
  await expect(page.locator('#homeOwnerActions')).toBeVisible();
  await expect(page.locator('#homeKpis')).toBeVisible();
  await expect(page.locator('#homeMissions')).toBeVisible();
  await expect(page.locator('#homeOutcomes')).toBeVisible();
  await expect(page.getByText('SHA & CI')).not.toBeVisible();

  await page.locator('.nav button[data-view="missions"]').click();
  await expect(page.locator('[data-section="missions"] h2')).toHaveText('Công việc');
  await expect(page.locator('#workCoordinationSummary')).toBeVisible();
  await expect(page.locator('#goalGrid')).toBeVisible();
  await expect(page.locator('#missionBoard')).toBeVisible();
  await expect(page.locator('#outcomeBoard')).toBeVisible();
  await expect(page.locator('#processBoard')).toBeVisible();

  await page.locator('.nav button[data-view="organization"]').click();
  await expect(page.locator('[data-section="organization"] h2')).toHaveText('Công ty');
  await expect(page.locator('#departmentGrid')).toBeVisible();
  await expect(page.locator('#employeeGrid')).toBeVisible();

  await page.locator('.nav button[data-view="technical"]').click();
  await expect(page.locator('[data-section="technical"] h2')).toHaveText('Hệ thống');
  await expect(page.getByText('SHA & CI')).toBeVisible();
});
