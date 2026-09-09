import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startOwnerCockpitV17 } from '../apps/dashboard/src/server-v17.js';
import { normalizeControllerRuntimeTruth } from '../apps/dashboard/src/runtime-truth-client.js';
import type { ExecutiveDashboardV4 } from '../apps/dashboard/src/executive-data-v4.js';
import type { ServerTelemetry } from '../apps/dashboard/src/server.js';

const closers:Array<()=>Promise<void>>=[];
afterEach(async()=>{while(closers.length)await closers.pop()?.();});
async function stub(body:string,contentType:string){const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':contentType});res.end(body);});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as AddressInfo;closers.push(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));return `http://127.0.0.1:${address.port}`;}
function seedRuntime(stage='queued'){
  return normalizeControllerRuntimeTruth({ok:true,source:'workforce-controller-v1',protocol:'runtime-truth-v1',generatedAt:'2026-09-08T06:45:00Z',staleAfterMs:45000,postgres:true,queue:{queued:stage==='queued'?1:0,activeLeases:0,stageCounts:{[stage]:1}},pc01:{employeeId:'EMP-PC01-NATIVE',deviceId:'DEV-PC01',health:'ok',heartbeatAt:'2026-09-08T06:44:59Z',online:true,metadata:{}},employees:[{employeeId:'EMP-PC01-NATIVE',displayName:'PC01 Native Worker',roles:['pc01-native-worker'],concurrencyLimit:4,deviceId:'DEV-PC01',health:'ok',heartbeatAt:'2026-09-08T06:44:59Z',stale:false,online:true}],providers:[],jobs:[{jobId:'J508',objective:'runtime live canary',stage,priority:'P0',targetEmployeeId:'EMP-PC01-NATIVE',createdAt:'2026-09-08T06:44:50Z',updatedAt:'2026-09-08T06:44:59Z',attempts:0,maxAttempts:2,lastFailureCode:null}],leases:[]},'http://127.0.0.1:8790');
}
const telemetry:ServerTelemetry={available:true,server:'PC01',generatedAt:'2026-09-08T06:45:00.000Z',cpu:null,memory:null,uptimeSeconds:1,disk:null,worker:null,controller:{online:true,ip:'100.97.23.87',port:8790,protocol:'controller-v1'},workforce:null,postgresql:null,ollama:null,tailscale:null,gpu:null};
const data:ExecutiveDashboardV4={generatedAt:'2026-09-08T06:45:00.000Z',works:[{number:508,title:'Live foundation',ownerCode:'NV01',owner:'Minh (NV01)',progressPercent:null,progressLabel:'—',status:'Chờ xử lý',tone:'waiting',next:'SSE',updated:'08/09/2026 13:45:00'}],people:[],systems:[{key:'control',name:'Bộ điều phối',status:'Hoạt động',tone:'active',note:'controller-v1'}],activeCount:0,waitingCount:1,blockedCount:0,doneCount:0,pausedCount:0,progressAverage:null,ownerActionRequired:false,ownerActionText:'Không có việc cần anh Sơn'};

describe('Web Control V5 SSE foundation',()=>{
  it('serves runtime-truth events, Last-Event-ID replay and JSON snapshot without leaking secrets',async()=>{
    seedRuntime('queued');
    const stableUrl=await stub('<!doctype html><html><body>ok</body></html>','text/html; charset=utf-8');
    const backendUrl=await stub(JSON.stringify(telemetry),'application/json; charset=utf-8');
    const outer=await startOwnerCockpitV17({stableUrl,backendUrl,repo:'newsdayads/tigeriq-ai-lab',loadData:async()=>data,livePollMs:1000});closers.push(outer.close);
    const abort=new AbortController(),response=await fetch(`${outer.url}/api/events`,{signal:abort.signal});expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader=response.body!.getReader(),first=await reader.read(),text=new TextDecoder().decode(first.value);abort.abort();
    expect(text).toContain('event: tigeriq');expect(text).toContain('work.queued');expect(text).toContain('runtime-truth-v1:job:J508');expect(text).not.toContain('authorization');expect(text).not.toContain('secret');expect(text).not.toContain('D:\\');
    const id=text.match(/^id: (evt-[^\n]+)/m)?.[1];expect(id).toBeTruthy();
    const replay=await fetch(`${outer.url}/api/live-snapshot?after=${encodeURIComponent(id!)}`);expect(replay.status).toBe(200);const snapshot=await replay.json() as {protocol:string;last_event_id:string|null;events:unknown[]};expect(snapshot.protocol).toBe('web-v5-live-v1');expect(Array.isArray(snapshot.events)).toBe(true);expect(snapshot.last_event_id).toBeTruthy();
  });

  it('serves a prewarmed V5 overview without waiting on stable relay and embeds checkpoint/fallback transport',async()=>{
    seedRuntime('queued');
    const slow=createServer((_req,res)=>{setTimeout(()=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<html>slow</html>');},2000);});await new Promise<void>(resolve=>slow.listen(0,'127.0.0.1',resolve));const slowAddress=slow.address() as AddressInfo;closers.push(()=>new Promise<void>((resolve,reject)=>slow.close(error=>error?reject(error):resolve())));
    const backendUrl=await stub(JSON.stringify(telemetry),'application/json; charset=utf-8');let loads=0;
    const outer=await startOwnerCockpitV17({stableUrl:`http://127.0.0.1:${slowAddress.port}`,backendUrl,repo:'newsdayads/tigeriq-ai-lab',loadData:async()=>{loads+=1;return data;}});closers.push(outer.close);
    const started=Date.now(),response=await fetch(`${outer.url}/?view=overview`),html=await response.text();expect(response.status).toBe(200);expect(Date.now()-started).toBeLessThan(1000);expect(loads).toBe(1);expect(html).toContain('Web Control V5');expect(html).toContain('Đang kết nối dữ liệu');expect(html).toContain('Đồng bộ trực tiếp');
    expect(html).toContain('/api/live-snapshot');expect(html).toContain('sessionStorage');expect(html).toContain('5000');expect(html).toContain('EventSource');expect(html).not.toContain('location.reload');expect(html).toContain('Vừa xảy ra');
  });
});
