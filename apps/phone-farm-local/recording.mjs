// Offline local video capture by the scrcpy executable already installed on PC01.
// Each session records to a private local MKV file and runs for a bounded duration.
// No browser stream, LAIXI binary, license service or network endpoint is required.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export function validRecordRequest(b) {
  return !!b && typeof b.serial==='string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(b.serial) &&
    Number.isInteger(b.seconds) && b.seconds>=5 && b.seconds<=120;
}
export function isValidMkv(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size <= 4096) return false;
    const fd = fs.openSync(file, 'r');
    try {
      const limit=Math.min(st.size,2*1024*1024);
      const bytes=Buffer.alloc(limit);
      if(fs.readSync(fd,bytes,0,limit,0)!==limit)return false;
      const has=id=>bytes.indexOf(Buffer.from(id))>=0;
      return bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) &&
        has([0x18,0x53,0x80,0x67]) && // Segment
        has([0x16,0x54,0xae,0x6b]) && // Tracks
        has([0x1f,0x43,0xb6,0x75]);   // Cluster
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}
export function buildRecordArgs(serial,seconds,target) {
  if(!validRecordRequest({serial,seconds})) throw Error('Thông số ghi màn hình không hợp lệ');
  if(typeof target!=='string'||!path.isAbsolute(target)||!target.toLowerCase().endsWith('.mkv'))
    throw Error('Đường dẫn ghi màn hình không hợp lệ');
  return ['--serial',serial,'--no-audio','--no-window','--max-size=1080',
    '--video-bit-rate=2M','--record='+target,'--time-limit='+String(seconds)];
}
export class Recordings {
  constructor(scrcpyPath,folder,launch=spawn) {
    this.scrcpyPath=scrcpyPath;this.folder=folder;this.launch=launch;
    this.items=new Map();
  }
  start(body){
    if(!validRecordRequest(body))throw Error('Yêu cầu ghi màn hình không hợp lệ');
    if([...this.items.values()].filter(x=>x.state==='recording').length>=4)
      throw Error('Đang ghi tối đa 4 máy; hãy hoàn thành phiên hiện tại');
    if([...this.items.values()].some(x=>x.serial===body.serial && x.state==='recording'))
      throw Error('Thiết bị này đang được ghi');
    fs.mkdirSync(this.folder,{recursive:true});
    const id=randomUUID();
    const file=path.join(this.folder,new Date().toISOString().replace(/[:.]/g,'-')+'-'+body.serial+'-'+id.slice(0,8)+'.mkv');
    const r={id,serial:body.serial,seconds:body.seconds,state:'recording',
      startedAt:new Date().toISOString(),finishedAt:null,file,error:null,bytes:0};
    this.items.set(id,r);
    let child;
    try {
      child=this.launch(this.scrcpyPath,buildRecordArgs(body.serial,body.seconds,file),
        {windowsHide:true,cwd:path.dirname(this.scrcpyPath),stdio:['ignore','ignore','pipe']});
    }catch(e){this.items.delete(id);throw e}
    r._child=child;
    let stderr='';
    if(child.stderr)child.stderr.on('data',data=>{stderr=(stderr+String(data)).slice(-1800)});
    const end=(err,code)=>{
      if(r.state!=='recording')return;
      r.finishedAt=new Date().toISOString();
      try{r.bytes=fs.statSync(r.file).size}catch{r.bytes=0}
      r.state=code===0 && isValidMkv(r.file)?'completed':'failed';
      r.error=r.state==='failed'?(String(err?.message||stderr||('Exit '+code)).slice(-350)):null;
      r._child=null;
    };
    child.once('error',e=>end(e,-1));
    child.once('exit',code=>end(null,code));
    while(this.items.size>100){const [key,value]=this.items.entries().next().value;if(value.state==='recording')break;this.items.delete(key)}
    return {id,serial:r.serial,seconds:r.seconds,state:r.state};
  }
  status(id){
    const x=this.items.get(id);
    if(!x)return null;
    const {_child,...publicItem}=x;
    return {...publicItem};
  }
  list(){
    return [...this.items.values()].map(x=>this.status(x.id));
  }
  stop(id){
    const r=this.items.get(id);
    if(!r || r.state!=='recording' || !r._child)return false;
    r._child.kill('SIGINT');
    // Interrupting an MKV writer may invalidate the output. Never claim a successful stop/recording.
    return true;
  }
}
