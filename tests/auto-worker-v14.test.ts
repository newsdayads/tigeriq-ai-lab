import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

let C: any;
let reg: any;
let pm: Record<string, any>;

beforeAll(async () => {
  await import('../artifacts/auto-worker/v14.0.0/tigeriq_aw_core.js');
  C = (globalThis as any).TigerIQCore;
  reg = JSON.parse(fs.readFileSync(path.resolve('artifacts/auto-worker/v14.0.0/registry_seed.json'), 'utf8'));
  reg = C.validateRegistry(reg);
  pm = Object.fromEntries(reg.employees.map((x: any) => [x.employee_id, x]));
});

describe('TigerIQ Auto Worker V14 multi-employee core', () => {
  it('keeps NV02 command 2 as AUTO', () => { expect(pm.NV02.mode).toBe('background_auto'); expect(pm.NV02.primary_command).toBe('2'); });
  it('upgrades NV04 to AUTO', () => { expect(pm.NV04.mode).toBe('background_auto'); expect(pm.NV04.primary_command).toBe('4'); });
  it('adds NV05 Product AUTO on next free command 5', () => { expect(pm.NV05.mode).toBe('background_auto'); expect(pm.NV05.primary_command).toBe('5'); });
  it('keeps NV03 paused', () => { expect(pm.NV03.enabled).toBe(false); expect(C.autoEmployees(reg).some((x:any)=>x.employee_id==='NV03')).toBe(false); });
  it('keeps NV01 foreground only', () => { expect(pm.NV01.mode).toBe('foreground_interactive'); expect(C.autoEmployees(reg).some((x:any)=>x.employee_id==='NV01')).toBe(false); });
  it('enforces one lease owner per resource', () => { const a=C.acquireLeases({},'NV02',['shared'],90000,'a',1000); const b=C.acquireLeases(a.leases,'NV04',['shared'],90000,'b',1001); expect(a.ok).toBe(true); expect(b.ok).toBe(false); });
  it('reaps stale leases', () => { const a=C.acquireLeases({},'NV02',['x'],100,'a',1000); expect(C.reapStaleLeases(a.leases,1200).stale).toHaveLength(1); });
  it('owner foreground reduces heavy concurrency to zero', () => { const g=C.governorDecision({owner_foreground:true,cpu_pct:20,mem_used_pct:30}); expect(g.heavy_slots).toBe(0); expect(g.total_slots).toBe(1); });
  it('soft pressure reduces heavy concurrency to one', () => { expect(C.governorDecision({cpu_pct:80,mem_used_pct:30}).heavy_slots).toBe(1); });
  it('hard pressure blocks heavy executors', () => { expect(C.governorDecision({cpu_pct:95,mem_used_pct:30}).heavy_slots).toBe(0); });
  it('blocked employee does not stop another employee', () => { const w=C.mergeWorkers(reg,{}); w.NV02.state='BỊ_CHẶN'; const q=[C.makeCycleJob(pm.NV02,1),C.makeCycleJob(pm.NV04,1)]; const s=C.selectRunnable(q,w,{},reg,{heavy_slots:1,total_slots:1},Date.now()); expect(s[0].employee_id).toBe('NV04'); });
  it('paused employee does not stop another employee', () => { const w=C.mergeWorkers(reg,{}); w.NV02.paused=true; const q=[C.makeCycleJob(pm.NV02,1),C.makeCycleJob(pm.NV04,1)]; const s=C.selectRunnable(q,w,{},reg,{heavy_slots:2,total_slots:2},Date.now()); expect(s.some((x:any)=>x.employee_id==='NV02')).toBe(false); expect(s.some((x:any)=>x.employee_id==='NV04')).toBe(true); });
  it('restart recovers running jobs as waiting', () => { const q=C.recoverQueueAfterRestart([{id:'x',state:'RUNNING'}],1000); expect(q[0].state).toBe('WAITING'); expect(q[0].waiting_reason).toBe('SERVICE_WORKER_RESTART'); });
  it('routes NV02 review to NV04', () => { expect(C.routeReviewer('NV02',reg)).toBe('NV04'); });
  it('routes NV04 review to NV02', () => { expect(C.routeReviewer('NV04',reg)).toBe('NV02'); });
  it('routes AI/API work to NV04', () => { expect(C.routeWorkOrder({scope:'AI/API provider inference'},reg)).toBe('NV04'); });
  it('routes Web/Vercel/Ops work to NV02', () => { expect(C.routeWorkOrder({scope:'Website Vercel vận hành'},reg)).toBe('NV02'); });
  it('supports adding NV06 via registry without scheduler change', () => { const x=JSON.parse(JSON.stringify(reg)); x.employees.push({employee_id:'NV06',display_name:'NV06',role:'Test',mode:'background_auto',scope:{resource_keys:['test']},priority:70,enabled:true,active:true,command_aliases:['6'],primary_command:'6',runtime_binding:'auto_worker'}); const z=C.validateRegistry(x); expect(C.commandMap(z)['6']).toBe('NV06'); });
  it('keeps command aliases unique', () => { const x=JSON.parse(JSON.stringify(reg)); x.employees.push({...x.employees.find((e:any)=>e.employee_id==='NV05'),employee_id:'NV99'}); expect(()=>C.validateRegistry(x)).toThrow(/DUP_COMMAND/); });
  it('heartbeat truth is TTL-bound', () => { const w={heartbeat_at:1000}; expect(C.heartbeatFresh(w,pm.NV02,1001)).toBe(true); expect(C.heartbeatFresh(w,pm.NV02,1000+pm.NV02.heartbeat_ttl_ms+1)).toBe(false); });
});
