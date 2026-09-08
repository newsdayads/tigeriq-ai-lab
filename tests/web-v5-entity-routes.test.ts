import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startOwnerCockpitV17 } from '../apps/dashboard/src/server-v17.js';
import { systemRows, type ExecutiveDashboardV4 } from '../apps/dashboard/src/executive-data-v4.js';
import type { ServerTelemetry } from '../apps/dashboard/src/server.js';

const closers:Array<()=>Promise<void>>=[];
afterEach(async()=>{while(closers.length) await closers.pop()?.();});
async function stub(body:string,type:string){const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':type});res.end(body);});await new Promise<void>((resolve)=>server.listen(0,'127.0.0.1',resolve));const a=server.address() as AddressInfo;closers.push(()=>new Promise<void>((resolve,reject)=>server.close((e)=>e?reject(e):resolve())));return `http://127.0.0.1:${a.port}`;}
const telemetry:ServerTelemetry={available:true,server:'PC01',generatedAt:'2026-09-08T08:00:00Z',cpu:null,memory:null,uptimeSeconds:1,disk:{drive:'D:',freeBytes:1,totalBytes:2,utilizationPercent:50},worker:{online:true,pid:24700,instances:1},controller:{online:true,ip:'100.97.23.87',port:8790},workforce:null,postgresql:{online:true,service:null,port:5432},ollama:{online:true,models:[]},tailscale:null,gpu:null};
function data():ExecutiveDashboardV4{return{generatedAt:telemetry.generatedAt,works:[],people:[{key:'NV01',initials:'MI',name:'Minh (NV01)',role:'Thực thi',status:'Đang làm',tone:'active',current:'V5',activeCount:1}],systems:systemRows(telemetry),activeCount:0,waitingCount:0,blockedCount:0,doneCount:0,pausedCount:0,progressAverage:null,ownerActionRequired:false,ownerActionText:'Không'};}
describe('Web V5 entity routes',()=>{
  it('serves workforce and system list/detail with V5 markers',async()=>{
    const stable=await stub('<html><body>stable</body></html>','text/html');
    const backend=await stub(JSON.stringify(telemetry),'application/json');
    const app=await startOwnerCockpitV17({stableUrl:stable,backendUrl:backend,repo:'newsdayads/tigeriq-ai-lab',loadData:async()=>data()});closers.push(app.close);
    for(const [path,marker] of [['/?view=workforce','AI nào đang làm gì'],['/people/NV01','Work liên quan'],['/?view=system','Máy có khỏe không'],['/system/worker','Native Worker']] as const){
      const r=await fetch(app.url+path);const html=await r.text();expect(r.status).toBe(200);expect(html).toContain(marker);expect(html).toContain('V5 · đang kết nối');
    }
  });
});
describe('Web V5 management routes',()=>{
  it('serves projects reports settings and project detail under one shell',async()=>{
    const d=data();d.works=[{number:511,title:'Web V5',ownerCode:'NV01',owner:'Minh',progressPercent:null,progressLabel:'—',status:'Đang làm',tone:'active',next:'Rollout',updated:'now',workId:'GH-511',projectId:'project:tigeriq',project:'TigerIQ',priority:'P0',goal:'Live',currentStep:'Batch',lastActivityAt:'2026-09-08T08:00:00Z'}];d.activeCount=1;
    const stable=await stub('<html><body>stable</body></html>','text/html');const backend=await stub(JSON.stringify(telemetry),'application/json');
    const app=await startOwnerCockpitV17({stableUrl:stable,backendUrl:backend,repo:'newsdayads/tigeriq-ai-lab',loadData:async()=>d});closers.push(app.close);
    for(const [path,marker] of [['/?view=models','stable project_id'],['/projects/project%3Atigeriq','Work thuộc dự án'],['/?view=reports','Chưa đủ dữ liệu'],['/?view=settings','read-first']] as const){const r=await fetch(app.url+path);const html=await r.text();expect(r.status).toBe(200);expect(html).toContain(marker);}
  });
});
