// Local-only E2E audit for the running TigerIQ Phone Farm server on PC01.
// No credentials, external network, destructive shell commands or LAIXI services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const origin='http://127.0.0.1:8765';
const port=18787;
const chrome=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-phone-e2e-'));
const logs=[];
let proc, ws;
const record=(name,status,detail)=>{const row={name,status,detail};logs.push(row);console.log(JSON.stringify(row))};
const until=async(fn,max=16000,interval=250)=>{
  const start=Date.now();let last;
  while(Date.now()-start<max){try {const x=await fn();if(x)return x}catch(e){last=e}await sleep(interval)}
  throw Error('Timed out '+(last?.message||''));
};
try{
  const health=await (await fetch(origin+'/api/health',{signal:AbortSignal.timeout(5000)})).json();
  assert.equal(health.ok,true);
  const invent=await (await fetch(origin+'/api/devices',{signal:AbortSignal.timeout(9000)})).json();
  const online=invent.devices.filter(x=>x.state==='device');
  record('ADB_INVENTORY','PASS',{reported:invent.count,online:online.length});
  assert(online.length>0);
  if(!fs.existsSync(chrome))throw Error('Chrome not installed at '+chrome);
  proc=spawn(chrome,['--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking',
    '--no-first-run','--no-default-browser-check','--no-proxy-server','--remote-allow-origins=*',
    '--remote-debugging-port='+port,'--user-data-dir='+profile,origin+'/'],
    {stdio:'ignore',windowsHide:true});
  const page=await until(async()=>{
    const r=await fetch('http://127.0.0.1:'+port+'/json',{signal:AbortSignal.timeout(1200)});
    const xs=await r.json();
    return xs.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
  },16000);
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await until(()=>ws.readyState===WebSocket.OPEN,4500);
  const pending=new Map();let counter=1;
  ws.addEventListener('message',e=>{
    const data=JSON.parse(String(e.data));
    if(!data.id)return;
    const x=pending.get(data.id);if(!x)return;
    pending.delete(data.id);
    if(data.error)x.reject(Error(data.error.message));else x.resolve(data.result);
  });
  function send(method,params={}){
    const id=counter++;return new Promise((resolve,reject)=>{
      pending.set(id,{resolve,reject});
      ws.send(JSON.stringify({id,method,params}));
    });
  }
  const evaluate=async expression=>{
    const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw Error(r.exceptionDetails.text);
    return r.result?.value;
  };
  await send('Runtime.enable');
  await until(async()=>await evaluate('document.readyState==="complete" && !!document.querySelector("#grid")'),13000);
  await until(async()=>await evaluate('document.querySelectorAll("#grid article.phone").length'),18000);
  const cards=await evaluate('document.querySelectorAll("#grid article.phone").length');
  record('GUI_DEVICE_CARDS',cards===invent.count?'PASS':'FAIL',{cards,adb:invent.count});
  assert.equal(cards,invent.count);
  await evaluate('document.querySelector("#deviceNumberGrid button").click()');
  const selected=await evaluate('document.querySelector("#chosenCount").textContent');
  assert.match(selected,/1 selected/);
  await evaluate('window.__commandReceipts=[];const originalFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const r=await originalFetch(...args);if(String(args[0]).includes("/api/input")){window.__commandReceipts.push({url:String(args[0]),status:r.status,body:await r.clone().json()})}return r}');
  await evaluate('document.querySelector("#mirrorSelected").click()');
  await until(async()=>await evaluate('document.querySelector("#controlOverlay").hidden===false'),7000);
  const image=await until(async()=>{
    return await evaluate('(()=>{let i=document.querySelector("#controlImage");return i.complete&&i.naturalWidth>0?{w:i.naturalWidth,h:i.naturalHeight}:false})()');
  },26000,450);
  record('IN_APP_CONTROLLER','PASS',{selected,overlay:true,image});
  await evaluate('document.querySelector("#controlHome").click()');
  const receipt=await until(async()=>await evaluate('window.__commandReceipts[0]||false'),22000,450);
  const success=receipt.status===200&&receipt.body.results?.[0]?.ok===true;
  record('GUI_HOME_REAL_DEVICE',success?'PASS':'FAIL',receipt);
  assert(success,'GUI HOME did not pass');
  await evaluate('document.querySelector("#controlClose").click()');
  assert.equal(await evaluate('document.querySelector("#controlOverlay").hidden'),true);
  record('CLOSE_CONTROLLER','PASS',{});
  await evaluate('document.querySelector("#grid article.phone:last-child").scrollIntoView()');
  const tail=await until(async()=>await evaluate('(()=>{let i=document.querySelector("#grid article.phone:last-child .screen img");return i&&i.complete&&i.naturalWidth>0?{w:i.naturalWidth,h:i.naturalHeight}:false})()'),22000,400);
  record('LAST_DEVICE_VISIBLE','PASS',tail);
  let screenshotOk=0;const failed=[];
  for(let i=0;i<online.length;i++){
    const d=online[i];
    try{
      const response=await fetch(origin+'/api/screen?serial='+encodeURIComponent(d.serial),{signal:AbortSignal.timeout(16000)});
      if(response.status!==200)throw Error('HTTP '+response.status);
      const arr=new Uint8Array(await response.arrayBuffer());
      if(arr.length<60||arr[0]!==137||arr[1]!==80||arr[2]!==78||arr[3]!==71)throw Error('Bad PNG');
      screenshotOk++;
      console.log('SCREEN '+(i+1)+'/'+online.length+' PNG_BYTES='+arr.length);
    }catch(e){failed.push({serial:d.serial,error:String(e.message)})}
  }
  record('ALL_PHYSICAL_SCREENSHOTS',failed.length?'FAIL':'PASS',{ok:screenshotOk,total:online.length,failed});
  if(failed.length)process.exitCode=2;
}catch(e){
  record('AUDIT','FAIL',String(e.stack||e));
  process.exitCode=1;
}finally{
  try{ws?.close()}catch{}
  try{proc?.kill()}catch{}
  try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:6,retryDelay:350})}catch(e){record('CLEANUP','WARN',String(e.message))}
  console.log('FINAL_E2E '+JSON.stringify({checks:logs.length,passed:logs.filter(x=>x.status==='PASS').length,failed:logs.filter(x=>x.status==='FAIL').length}));
}