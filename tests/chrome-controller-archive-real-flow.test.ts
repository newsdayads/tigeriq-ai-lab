import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-ignore plain JS extension module
import { runArchiveCommand } from '../apps/chrome-controller/extension/archive-command.js';

const extensionDir=resolve('apps/chrome-controller/extension');
const canonical='https://chatgpt.com/g/g-p-6a925c470aa08191a10595e215d04f4e-tigeriq-ai-lab/c/test';
const jsonResponse=(value:unknown)=>({ok:true,status:200,json:async()=>value});

afterEach(()=>vi.restoreAllMocks());

async function loadRealFlow(done:boolean,events:string[]){
  vi.spyOn(globalThis,'setInterval').mockImplementation((()=>0) as unknown as typeof setInterval);
  let windows:any[]=[];
  let uiReads=0;
  (globalThis as any).chrome={
    storage:{local:{get:vi.fn(async()=>({})),set:vi.fn(async()=>{}),remove:vi.fn(async()=>{})}},
    windows:{getAll:vi.fn(async()=>windows),get:vi.fn(async()=>({left:0,top:0,width:500,height:800})),update:vi.fn(async()=>({})),remove:vi.fn(async()=>{}),onRemoved:{addListener:vi.fn()}},
    tabs:{get:vi.fn(async()=>({status:'complete'})),update:vi.fn(async()=>({})),sendMessage:vi.fn(async(_id:number,msg:any)=>{
      if(msg.type==='TIGERIQ_DISPATCH'){events.push('save-dispatch');return {ok:true};}
      if(msg.type==='TIGERIQ_UI_STATE'){events.push('ui-state');uiReads+=1;return {uiBusy:uiReads===1,securityBlock:null};}
      if(msg.type==='TIGERIQ_ARCHIVE_CONVERSATION'){events.push('archive');return {ok:true};}
      return {ok:true};
    }),onUpdated:{addListener:vi.fn(),removeListener:vi.fn()}},
    system:{display:{getInfo:vi.fn(async()=>[{isPrimary:true,bounds:{left:0,top:0,width:1920,height:1080},workArea:{left:0,top:0,width:1920,height:1040}}])}},
    action:{setBadgeText:vi.fn(async()=>{}),setTitle:vi.fn(async()=>{})},
    alarms:{create:vi.fn(async()=>{}),onAlarm:{addListener:vi.fn()}},
    runtime:{onInstalled:{addListener:vi.fn()},onStartup:{addListener:vi.fn()},onMessage:{addListener:vi.fn()}},
  };
  (globalThis as any).fetch=vi.fn(async(input:any)=>{
    const url=String(input);
    if(url.includes('/api/state')){events.push('guard-state');return jsonResponse({killed:false,paused:false,workers:[{id:'NV02',enabled:true,blocked:false,lastHeartbeat:{uiBusy:false,securityBlock:null}}]});}
    if(url.includes('/api/autopilot/state')){events.push('guard-autopilot');return jsonResponse({state:{},snapshot:{previousJob:done?{workerId:'NV02',jobId:'GH-802',status:'DONE',evidence:[{source:'GITHUB',ref:'https://github.com/newsdayads/tigeriq-ai-lab/issues/802',verifiedAt:'2026-09-17T00:00:00Z'}]}:null}});}
    if(url.includes('/api/ui-autopilot/save-receipt')){events.push('durable-receipt');return jsonResponse({ok:true,status:'DURABLE',receiptRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/788#receipt',checkpointRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/802',verifiedAt:'2026-09-17T00:00:01Z'});}
    throw new Error('UNEXPECTED_FETCH:'+url);
  });
  const temp=join(extensionDir,`.archive-real-flow-${process.pid}-${Date.now()}.mjs`);
  const source=readFileSync(join(extensionDir,'background.js'),'utf8');
  writeFileSync(temp,source+'\nexport { saveAndArchive as __testSaveAndArchive };\n','utf8');
  const mod=await import(pathToFileURL(temp).href+'?v='+Date.now());
  windows=[{id:10,tabs:[{id:20,url:canonical,active:true}]}];
  return {saveAndArchive:mod.__testSaveAndArchive as Function,temp};
}

describe('direct ARCHIVE_CHAT real canonical flow',()=>{
  it('requires DONE, then save -> durable receipt -> re-guard -> archive in order',async()=>{
    const events:string[]=[];
    const {saveAndArchive,temp}=await loadRealFlow(true,events);
    try{
      const result=await runArchiveCommand('NV02',{receiptRef:'https://github.com/upstream'},{archiveSupported:()=>true,saveAndArchive});
      expect(result.status).toBe('ARCHIVED');
      expect(events.filter(x=>x==='guard-state')).toHaveLength(2);
      expect(events.indexOf('save-dispatch')).toBeLessThan(events.indexOf('durable-receipt'));
      expect(events.indexOf('durable-receipt')).toBeLessThan(events.lastIndexOf('guard-state'));
      expect(events.lastIndexOf('guard-autopilot')).toBeLessThan(events.indexOf('archive'));
    }finally{unlinkSync(temp);}
  });

  it('fails before save/archive when terminal external DONE evidence is missing',async()=>{
    const events:string[]=[];
    const {saveAndArchive,temp}=await loadRealFlow(false,events);
    try{
      await expect(runArchiveCommand('NV02',{receiptRef:'https://github.com/upstream'},{archiveSupported:()=>true,saveAndArchive})).rejects.toThrow('ARCHIVE_EXTERNAL_DONE_EVIDENCE_REQUIRED');
      expect(events).not.toContain('save-dispatch');
      expect(events).not.toContain('archive');
    }finally{unlinkSync(temp);}
  });
});
