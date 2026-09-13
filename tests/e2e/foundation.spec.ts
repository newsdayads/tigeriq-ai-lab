import {test,expect} from '@playwright/test';
import {createServer, type Server} from 'node:http';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
let core:Server,web:ChildProcess;
test.beforeAll(async()=>{
  core=createServer((req,res)=>{
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(req.url==='/health'?{ok:true,pid:1234}:{ok:true,core:{pid:1234,uptimeSec:100},resources:[],jobs:[],objectives:[],events:[],telemetry:[]}));
  });
  await new Promise<void>(r=>core.listen(18885,'127.0.0.1',r));
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
  await new Promise<void>(r=>core.close(()=>r()));
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
