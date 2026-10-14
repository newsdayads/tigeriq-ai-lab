import {describe,it,expect} from 'vitest';
import {createNonblockingManagerTick} from '../apps/tigeriq-coding-lane/nonblocking-manager-tick.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
describe('P0 manager/worker no-head-of-line blocking, fail closed',()=>{
 it('starts worker work before a slow manager finishes and never doubles the manager lease',async()=>{
   let finishManager,managerRuns=0,workerRuns=0;
   const pending=new Promise(resolve=>{finishManager=resolve;});
   const gate=createNonblockingManagerTick(async()=>{managerRuns++;await pending;});
   expect(gate.launch()).toBe(true);
   await flush();
   expect(gate.snapshot().running).toBe(true);
   // Mirrors loop behavior: claim/worker awaits are no longer behind await managerTick.
   await Promise.resolve().then(()=>{workerRuns++});
   expect(workerRuns).toBe(1);
   expect(gate.launch()).toBe(false);
   expect(managerRuns).toBe(1);
   finishManager();
   await flush();
   expect(gate.snapshot().running).toBe(false);
   expect(gate.launch()).toBe(true);
   await flush();
   expect(managerRuns).toBe(2);
 });
 it('manager failure records the error, cools down and cannot crash the worker loop',async()=>{
   let time=1000,calls=0,errors=0;
   const gate=createNonblockingManagerTick(async()=>{calls++;throw new Error('manager_not_available');},{
     now:()=>time,failureBackoffMs:30_000,onError:()=>errors++,
   });
   expect(gate.launch()).toBe(true);
   await flush();
   expect(errors).toBe(1);
   expect(gate.snapshot().running).toBe(false);
   expect(gate.launch()).toBe(false);
   time+=30_001;
   expect(gate.launch()).toBe(true);
   await flush();
   expect(calls).toBe(2);
 });
 it('stalled manager warns once per interval, never forks a second live manager',async()=>{
   let now=0,warnings=0,executions=0,release;
   const hold=new Promise(resolve=>{release=resolve;});
   const gate=createNonblockingManagerTick(async()=>{executions++;await hold;},{
     now:()=>now,stallAfterMs:5000,onStall:()=>warnings++,
   });
   expect(gate.launch()).toBe(true);
   await flush();
   now=5001;
   expect(gate.launch()).toBe(false);
   expect(gate.launch()).toBe(false);
   expect(warnings).toBe(1);
   now=10002;
   expect(gate.launch()).toBe(false);
   expect(warnings).toBe(2);
   expect(executions).toBe(1);
   release();
   await flush();
   expect(gate.snapshot().running).toBe(false);
 });
});
