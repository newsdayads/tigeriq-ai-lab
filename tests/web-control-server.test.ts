import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe,expect,it } from 'vitest';
import { startWebControlServer } from '../apps/web-control/src/server.js';
import { writeWebControlSnapshot } from '../apps/web-control/src/file-source.js';
import type { WebControlSnapshot } from '../apps/web-control/src/core.js';

function snapshot():WebControlSnapshot{return {version:1,generatedAt:new Date().toISOString(),goals:{queued:0,running:0,waitingAuthorization:0,blocked:0,done:0,failed:0},goalRows:[],tasks:{queued:0,running:0,review:0,authorization:0,blocked:0,done:0,failed:0},taskRows:[],workers:{total:0,busy:0,online:0,waiting:0,offline:0,failed:0},workerRows:[],providers:[],employees:[],authorization:{goalIds:[],taskIds:[]},evidence:{subjects:0,judgePass:0,judgePending:0}};}
async function setup(){
  const dir=await mkdtemp(path.join(tmpdir(),'tigeriq-web-'));
  const snapshotPath=path.join(dir,'snapshot.json'),controlPath=path.join(dir,'control.json'),goalsPath=path.join(dir,'goals.json');
  await writeWebControlSnapshot(snapshot(),snapshotPath);await writeFile(controlPath,JSON.stringify({version:1,paused:false}));await writeFile(goalsPath,JSON.stringify({version:1,goals:[]}));
  const server=await startWebControlServer({host:'127.0.0.1',port:0,commandSecret:'owner-secret',snapshotPath,continuousControlPath:controlPath,continuousGoalsPath:goalsPath,secureCookies:false});
  return {dir,snapshotPath,controlPath,goalsPath,...server};
}
async function login(url:string){
  const response=await fetch(`${url}/login`,{method:'POST',body:new URLSearchParams({secret:'owner-secret'}),redirect:'manual'});
  expect(response.status).toBe(303);
  const cookie=(response.headers.get('set-cookie')??'').split(';')[0];
  const root=await fetch(`${url}/`,{headers:{cookie}});const html=await root.text();
  const csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1];expect(csrf).toBeTruthy();
  return {cookie,csrf:csrf!};
}

describe('PC01 Web Control server',()=>{
  it('binds only loopback and exposes read-only health/control safely',async()=>{
    await expect(startWebControlServer({host:'0.0.0.0',port:0})).rejects.toThrow('WEB_CONTROL_LOOPBACK_ONLY');
    const server=await setup();
    try{
      const health=await fetch(`${server.url}/health`);expect(await health.json()).toEqual({ok:true,service:'tigeriq-web-control',bind:'loopback'});
      const control=await fetch(`${server.url}/api/control`);const body=await control.json() as {available:boolean};expect(body.available).toBe(true);
      expect(control.headers.get('x-frame-options')).toBe('DENY');
      const html=await (await fetch(`${server.url}/`)).text();expect(html).toContain('Owner Control');expect(html).not.toContain('owner-secret');
    }finally{await server.close();}
  });

  it('requires owner login + CSRF for pause/resume',async()=>{
    const server=await setup();
    try{
      const unauthorized=await fetch(`${server.url}/control/pause`,{method:'POST',body:new URLSearchParams({csrf:'x'}),redirect:'manual'});expect(unauthorized.status).toBe(401);
      const {cookie,csrf}=await login(server.url);
      const pause=await fetch(`${server.url}/control/pause`,{method:'POST',headers:{cookie},body:new URLSearchParams({csrf}),redirect:'manual'});expect(pause.status).toBe(303);
      expect(JSON.parse(await readFile(server.controlPath,'utf8')).paused).toBe(true);
      const resume=await fetch(`${server.url}/control/resume`,{method:'POST',headers:{cookie},body:new URLSearchParams({csrf}),redirect:'manual'});expect(resume.status).toBe(303);
      expect(JSON.parse(await readFile(server.controlPath,'utf8')).paused).toBe(false);
    }finally{await server.close();}
  });

  it('adds only a queue-valid explicit goal and prevents invalid dependency state',async()=>{
    const server=await setup();
    try{
      const {cookie,csrf}=await login(server.url);
      const add=await fetch(`${server.url}/goals`,{method:'POST',headers:{cookie},body:new URLSearchParams({csrf,goalId:'G1',goal:'Implement safe feature',priority:'P0',mode:'ai',dependencies:''}),redirect:'manual'});expect(add.status).toBe(303);
      let queue=JSON.parse(await readFile(server.goalsPath,'utf8')) as {goals:Array<{goalId:string}>};expect(queue.goals.map(row=>row.goalId)).toEqual(['G1']);
      const invalid=await fetch(`${server.url}/goals`,{method:'POST',headers:{cookie},body:new URLSearchParams({csrf,goalId:'G2',goal:'Blocked by unknown',priority:'P1',mode:'ai',dependencies:'MISSING'}),redirect:'manual'});expect(invalid.status).toBe(503);
      queue=JSON.parse(await readFile(server.goalsPath,'utf8'));expect(queue.goals.map(row=>row.goalId)).toEqual(['G1']);
    }finally{await server.close();}
  });

  it('rejects incorrect login without issuing a session cookie',async()=>{
    const server=await setup();
    try{
      const response=await fetch(`${server.url}/login`,{method:'POST',body:new URLSearchParams({secret:'wrong'}),redirect:'manual'});expect(response.status).toBe(401);expect(response.headers.get('set-cookie')).toBeNull();
    }finally{await server.close();}
  });
});
