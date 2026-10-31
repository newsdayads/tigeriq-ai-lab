import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

// Deliberately bounded visual macro actions; never arbitrary ADB shell commands.
export function validMacro(steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 50) return false;
  let totalWait = 0;
  for (const step of steps) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
    const a = step.action;
    if (a === 'wait') {
      if (!Number.isInteger(step.ms) || step.ms < 50 || step.ms > 3000) return false;
      totalWait += step.ms;
    } else if (a === 'tap') {
      if (![step.x,step.y].every(n=>Number.isInteger(n) && n >= 0 && n <= 10000)) return false;
    } else if (a === 'swipe') {
      if (![step.x,step.y,step.toX,step.toY].every(n=>Number.isInteger(n) && n >= 0 && n <= 10000) ||
          !Number.isInteger(step.ms) || step.ms < 100 || step.ms > 3000) return false;
    } else if (a === 'key') {
      if (!['HOME','BACK','APP_SWITCH','VOLUME_UP','VOLUME_DOWN'].includes(step.key)) return false;
    } else if (a === 'text') {
      if (typeof step.text !== 'string' || step.text.length < 1 || step.text.length > 200 ||
          !/^[\x20-\x7e]+$/.test(step.text)) return false;
    } else return false;
  }
  return totalWait <= 30000;
}
export async function executeMacro(steps, serials, inputOne, signal, onProgress=()=>{}) {
  if (!validMacro(steps)) throw Error('Kịch bản không hợp lệ');
  for (let i=0;i<steps.length;i++) {
    signal?.throwIfAborted();
    const step = steps[i];
    if (step.action === 'wait') {
      await sleep(step.ms, undefined, signal ? { signal } : {});
    } else {
      // Bounded parallelism across phones. Each device gets the same step before proceeding.
      let next = 0;
      const failures = [];
      await Promise.all(Array.from({length:Math.min(4, serials.length)},async()=>{
        while(next < serials.length) {
          signal?.throwIfAborted();
          const serial = serials[next++];
          try { await inputOne(serial,step); }
          catch (e) { failures.push({serial,error:String(e.message||e).slice(0,200)}); }
        }
      }));
      if (failures.length) throw Error('Thao tác thất bại: '+JSON.stringify(failures.slice(0,3)));
    }
    onProgress(i+1,steps.length);
  }
  return { completed:steps.length, total:steps.length };
}
export class MacroRuns {
  constructor() { this.records=new Map(); this.locked=new Set(); }
  start(steps,serials,inputOne){
    if(!validMacro(steps) || !Array.isArray(serials) || serials.length<1 || serials.length>200 ||
       new Set(serials).size!==serials.length || serials.some(s=>this.locked.has(s))) {
      throw Error('Kịch bản không hợp lệ hoặc thiết bị đang chạy kịch bản khác');
    }
    const id=randomUUID(), controller=new AbortController();
    const r={id,state:'running',done:0,total:steps.length,startedAt:new Date().toISOString(),finishedAt:null,error:null};
    this.records.set(id,{r,controller});
    serials.forEach(s=>this.locked.add(s));
    // Bounded, observable runtime task, not detached ChatGPT background work.
    void executeMacro(steps,serials,inputOne,controller.signal,n=>{r.done=n})
      .then(()=>{r.state='completed'})
      .catch(e=>{r.state=controller.signal.aborted?'cancelled':'failed';r.error=String(e.message||e).slice(0,300)})
      .finally(()=>{
        r.finishedAt=new Date().toISOString();
        serials.forEach(s=>this.locked.delete(s));
        // Only retain the last 100 records.
        while(this.records.size>100)this.records.delete(this.records.keys().next().value);
      });
    return id;
  }
  status(id) { return this.records.get(id)?.r || null; }
  stop(id) { const x=this.records.get(id);if(!x||x.r.state!=='running')return false;x.controller.abort();return true; }
}
