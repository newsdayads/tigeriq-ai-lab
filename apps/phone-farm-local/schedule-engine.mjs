import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeSerial } from './farm-ops.mjs';
import { validMacro } from './macro-engine.mjs';

// Durable local schedules. Never contacts a server; no schedule runs unless added explicitly.
export class LocalScheduler {
  constructor(file, execute, clock=()=>Date.now()) {
    this.file=file; this.execute=execute; this.clock=clock; this.ticking=false;
    this.items=[];
    if (fs.existsSync(file)) {
      const raw=JSON.parse(fs.readFileSync(file,'utf8'));
      if (!Array.isArray(raw) || raw.length > 100 || raw.some(x=>!this.validStored(x)))
        throw Error('Dữ liệu lịch cục bộ không hợp lệ, giữ nguyên để kiểm tra');
      this.items=raw;
    }
  }
  validStored(x) {
    return x && typeof x.id==='string' && /^[0-9a-f-]{36}$/.test(x.id) &&
      typeof x.name==='string' && x.name.length>0 && x.name.length<=80 &&
      Array.isArray(x.serials) && x.serials.length>0 && x.serials.length<=200 &&
      x.serials.every(safeSerial) && new Set(x.serials).size===x.serials.length &&
      validMacro(x.steps) && Number.isSafeInteger(x.nextAt) && x.nextAt>0 &&
      Number.isInteger(x.repeatMinutes) && x.repeatMinutes>=0 && x.repeatMinutes<=1440 &&
      typeof x.enabled==='boolean';
  }
  save() {
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const tmp=this.file+'.'+randomUUID()+'.tmp';
    try {
      fs.writeFileSync(tmp,JSON.stringify(this.items,null,2),'utf8');
      fs.renameSync(tmp,this.file);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }
  add(input) {
    const stamp=Date.parse(input?.runAt);
    const now=this.clock();
    if (!input || typeof input.name!=='string' || !input.name.trim() || input.name.length>80 ||
        !Array.isArray(input.serials) || input.serials.length<1 || input.serials.length>200 ||
        !input.serials.every(safeSerial) || new Set(input.serials).size!==input.serials.length ||
        !validMacro(input.steps) || typeof input.runAt!=='string' ||
        !Number.isSafeInteger(stamp) || stamp<now+1000 || stamp>now+365*86400000 ||
        !Number.isInteger(input.repeatMinutes) || input.repeatMinutes<0 || input.repeatMinutes>1440 ||
        this.items.length>=100) throw Error('Cấu hình lịch chạy không hợp lệ');
    const x={id:randomUUID(),name:input.name.trim(),serials:[...input.serials],
      steps:input.steps,nextAt:stamp,repeatMinutes:input.repeatMinutes,enabled:true,
      lastRunAt:null,lastRunId:null,lastError:null};
    this.items.push(x);this.save();
    return {id:x.id,name:x.name,nextAt:x.nextAt};
  }
  remove(id) {
    const before=this.items.length;
    this.items=this.items.filter(x=>x.id!==id);
    if (this.items.length<before)this.save();
    return this.items.length<before;
  }
  list() { return this.items.map(x=>({...x})); }
  async tick() {
    if(this.ticking)return;
    this.ticking=true;
    try {
      const now=this.clock();
      let changed=false;
      for(const item of this.items) {
        if (!item.enabled || item.nextAt>now)continue;
        changed=true;
        // Fail closed after prolonged downtime, never replay a stale backlog of device actions.
        if(now-item.nextAt>60*60*1000) {
          item.lastError='Missed window (>1h); not replayed';
        } else {
          try {
            const id=await this.execute(item.steps,item.serials);
            item.lastRunId=id;
            item.lastRunAt=new Date(now).toISOString();
            item.lastError=null;
          } catch(e) { item.lastError=String(e.message||e).slice(0,300); }
        }
        if(item.repeatMinutes===0)item.enabled=false;
        else {
          const ms=item.repeatMinutes*60000;
          item.nextAt+=Math.max(1,Math.floor((now-item.nextAt)/ms)+1)*ms;
        }
      }
      if(changed)this.save();
    } finally {this.ticking=false;}
  }
}
