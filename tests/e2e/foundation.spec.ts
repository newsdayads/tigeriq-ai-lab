import {test,expect} from '@playwright/test';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
let core:ChildProcess,web:ChildProcess;
test.beforeAll(async()=>{
  if(!process.env.TEST_DATABASE_URL)throw new Error('Disposable PostgreSQL required');
  core=spawn(process.execPath,['apps/tigeriq-core/core-entry.mjs'],{env:{PATH:process.env.PATH,DATABASE_URL:process.env.TEST_DATABASE_URL,TIGERIQ_CORE_HOST:'127.0.0.1',TIGERIQ_CORE_PORT:'18885'},stdio:'pipe'});
  let coreLogs='';core.stdout?.on('data',x=>coreLogs+=x);core.stderr?.on('data',x=>coreLogs+=x);
  let ready=false;
  for(let i=0;i<100;i++){
    if(core.exitCode!==null)throw new Error('Core exited: '+coreLogs);
    try{if((await fetch('http://127.0.0.1:18885/health')).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  if(!ready)throw new Error('Core startup failed: '+coreLogs);
  web=spawn(process.execPath,['apps/tigeriq-core/web-control-server.mjs'],{env:{...process.env,TIGERIQ_WEB_CONTROL_HOST:'127.0.0.1',TIGERIQ_WEB_CONTROL_PORT:'18886',TIGERIQ_CORE_URL:'http://127.0.0.1:18885',TIGERIQ_CODING_LANE_URL:'http://127.0.0.1:1'},stdio:'pipe'});
  let logs='';web.stderr?.on('data',x=>logs+=x);
  for(let i=0;i<100;i++){
    if(web.exitCode!==null)throw new Error(logs);
    try{if((await fetch('http://127.0.0.1:18886/health')).ok)return;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Web startup failed: '+logs);
});
test.afterAll(async()=>{
  if(web&&web.exitCode===null){const closed=once(web,'close');web.kill();await closed;}
  if(core&&core.exitCode===null){const closed=once(core,'close');core.kill();await closed;}
});
for(const width of [390,1440]){
  test('Web Control stays usable with Coding Lane disabled at '+width,async({page})=>{
    await page.setViewportSize({width,height:900});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:18886/');
    await expect(page.locator('#metrics')).toContainText('DISABLED');
    await expect(page.locator('#metrics')).toContainText('Core');
    await expect(page.locator('#metrics')).toContainText('ONLINE');
    expect(errors).toEqual([]);
    const status=await (await page.request.get('http://127.0.0.1:18886/api/status')).json();
    expect(status.codingLane.enabled).toBe(false);
    await page.screenshot({path:'test-results/web-disabled-'+width+'.png',fullPage:true});
  });
}
