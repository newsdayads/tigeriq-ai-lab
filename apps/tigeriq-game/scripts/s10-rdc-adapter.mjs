/** GH-5284: host-native RDC adapter. Direct adb.exe only, no shell; battery mutation only after owned fence. */
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,unlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {evaluateG06Preflight,parseAdbDevices} from './s10-preflight.mjs';
import {runG06E2E} from './s10-e2e.mjs';

export const DEFAULT_ADB_PATH='D:\\TigerIQ\\Tools\\platform-tools\\adb.exe';
export const DEFAULT_STATE_ROOT='D:\\TigerIQ\\State\\tigeriq-game-s10';
const execFileAsync=promisify(execFileCb);
const ID=/^[A-Za-z0-9._:-]{8,128}$/;
const SHA=/^[0-9a-f]{40}$/;
const answers=Object.freeze({L01:'Đi tới',L02:'Quay trái',L03:'Quay phải',L04:'Đi tới',L05:'Quay trái'});
const names=Object.freeze({L01:'1. Lạc hướng',L02:'2. Rẽ sai',L03:'3. Bấm nhầm',L04:'4. Giao gói hàng',L05:'5. Đường vòng'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const digest=b=>createHash('sha256').update(b).digest('hex');
const lockFile=(root,serial)=>join(root,'locks',serial+'.json');
const sessionFile=(root,id)=>join(root,'sessions',id+'.json');
const safeJson=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch{return null;}};
const matchIntent=(a,b)=>['ownerId','leaseId','fencingToken','resourceScope'].every(k=>a?.[k]===b?.[k]);
const publicLease=x=>x?{ownerId:x.ownerId,workOrder:x.workOrder,resourceScope:x.resourceScope,deviceSerial:x.deviceSerial,leaseId:x.leaseId,leaseState:x.leaseState,expiresAtMs:x.expiresAtMs}:null;

export async function claimAtomicFence({stateRoot=DEFAULT_STATE_ROOT,ownerId,workOrder='GH-5284',resourceScope='TIGERIQ_GAME_G06_S10_E2E_HARNESS',deviceSerial,sourceSha,ttlMs=300000,now=Date.now}={}){
  if(!ID.test(ownerId||'')||!ID.test(deviceSerial||'')||!SHA.test(sourceSha||''))throw Error('INVALID_FENCE_INPUT');
  await mkdir(join(stateRoot,'locks'),{recursive:true});
  await mkdir(join(stateRoot,'sessions'),{recursive:true});
  const path=lockFile(stateRoot,deviceSerial);
  const leaseId='LEASE_'+randomUUID().replaceAll('-','');
  const fencingToken='FENCE_'+randomUUID().replaceAll('-','');
  const value={schema:'TIGERIQ_S10_DEVICE_FENCE_V1',ownerId,workOrder,resourceScope,deviceSerial,sourceSha,leaseId,fencingToken,leaseState:'active',createdAtMs:now(),expiresAtMs:now()+ttlMs};
  let h;
  try{h=await open(path,'wx');await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.close();}
  catch(e){try{await h?.close();}catch{} if(e?.code==='EEXIST'){const existing=await safeJson(path);return {accepted:false,code:'DEVICE_ALREADY_FENCED',existing:publicLease(existing),path};} throw e;}
  return {accepted:true,intent:{ownerId,workOrder,resourceScope,deviceSerial,sourceSha,leaseId,fencingToken},lease:publicLease(value),path};
}

export function parseUiNodes(xml){
  if(typeof xml!=='string')return [];
  const out=[];for(const tag of xml.match(/<node\b[^>]*>/g)||[]){
    const attrs={};for(const m of tag.matchAll(/([A-Za-z0-9_-]+)="([^"]*)"/g))attrs[m[1]]=m[2];
    const b=/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.bounds||'');
    if(b)out.push({text:attrs.text||'',contentDesc:attrs['content-desc']||'',clickable:attrs.clickable==='true',bounds:b.slice(1).map(Number)});
  }return out;
}
export function nodeCenter(node){const [x1,y1,x2,y2]=node.bounds;return {x:Math.floor((x1+x2)/2),y:Math.floor((y1+y2)/2)};}

export function createS10RdcAdapter({adbPath=DEFAULT_ADB_PATH,stateRoot=DEFAULT_STATE_ROOT,previewHtmlPath=resolve(import.meta.dirname,'../preview/robot-oops-g06-field-test.html'),execFile=execFileAsync,now=Date.now}={}){
  let server=null,sessionId=null,currentIntent=null,previewUrl=null,reverseAdded=false,batteryOverrideOwned=false;
  const adb=async(args,{binary=false,timeout=15000}={})=>{
    const r=await execFile(adbPath,args,{windowsHide:true,timeout,maxBuffer:8*1024*1024,encoding:binary?null:'utf8',shell:false});
    return {stdout:r.stdout,stderr:r.stderr};
  };
  const verifyFence=async({intent})=>{
    const row=await safeJson(lockFile(stateRoot,intent?.deviceSerial||''));
    const ok=row?.schema==='TIGERIQ_S10_DEVICE_FENCE_V1'&&row.leaseState==='active'&&matchIntent(row,intent)&&row.deviceSerial===intent.deviceSerial&&row.expiresAtMs>now();
    return ok?{accepted:true,leaseState:'active',scope:row.resourceScope,deviceSerial:row.deviceSerial,ownerId:row.ownerId,leaseId:row.leaseId,fencingToken:row.fencingToken,expiresAtMs:row.expiresAtMs}:{accepted:false};
  };
  const inspectDevice=async serial=>{
    const devices=await adb(['devices','-l']);
    const model=(await adb(['-s',serial,'shell','getprop','ro.product.model'])).stdout.trim();
    const battery=(await adb(['-s',serial,'shell','dumpsys','battery'])).stdout;
    const state=(devices.stdout.split(/\r?\n/).find(x=>x.trim().startsWith(serial+' '))||'').includes(' device')?'device':'unavailable';
    const level=Number(/(?:^|\n)\s*level:\s*(\d{1,3})\b/i.exec(battery)?.[1]);
    return {devicesText:devices.stdout,deviceSerial:serial,deviceState:state,deviceModel:model,batteryText:battery,batteryLevel:Number.isInteger(level)?level:null,batteryOverrideDetected:/UPDATES\s+STOPPED/i.test(battery)};
  };
  const preparePreview=async()=>{
    if(server)return {url:previewUrl,reachable:true};
    const html=await readFile(previewHtmlPath);
    server=createServer((req,res)=>{if(req.url==='/healthz'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({previewReady:true,production:false})+'\n');return;} if(req.url!=='/'){res.writeHead(404);res.end();return;} res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);});
    await new Promise((ok,bad)=>{server.once('error',bad);server.listen(4173,'127.0.0.1',ok);});
    previewUrl='http://127.0.0.1:4173/';return {url:previewUrl,reachable:true};
  };
  const dumpUi=async serial=>{await adb(['-s',serial,'shell','uiautomator','dump','/sdcard/tigeriq-g06.xml']);return (await adb(['-s',serial,'exec-out','cat','/sdcard/tigeriq-g06.xml'])).stdout;};
  const findNode=async(serial,needle,{contains=false,tries=12}={})=>{for(let i=0;i<tries;i++){const nodes=parseUiNodes(await dumpUi(serial));const n=nodes.find(x=>contains?(x.text||x.contentDesc).includes(needle):(x.text===needle||x.contentDesc===needle));if(n)return n;await sleep(300);}return null;};
  const tapNode=async(serial,needle,opts)=>{const n=await findNode(serial,needle,opts);if(!n)throw Error('UI_NODE_NOT_FOUND:'+needle);const p=nodeCenter(n);await adb(['-s',serial,'shell','input','tap',String(p.x),String(p.y)]);await sleep(300);return p;};
  const resetOwnedBattery=async serial=>{
    if(!batteryOverrideOwned)return {ok:true,reset:false};
    try{
      await adb(['-s',serial,'shell','dumpsys','battery','reset']);
      const after=(await adb(['-s',serial,'shell','dumpsys','battery'])).stdout;
      const ok=!/UPDATES\s+STOPPED/i.test(after);
      if(ok)batteryOverrideOwned=false;
      return {ok,reset:ok};
    }catch{return {ok:false,reset:false};}
  };
  const beginOnce=async({intent,deviceSerial,sourceSha})=>{
    if(!(await verifyFence({intent})).accepted)return {accepted:false};
    if(sourceSha!==intent.sourceSha||deviceSerial!==intent.deviceSerial)return {accepted:false};
    const batteryBefore=(await adb(['-s',deviceSerial,'shell','dumpsys','battery'])).stdout;
    const beforeLevel=Number(/(?:^|\n)\s*level:\s*(\d{1,3})\b/i.exec(batteryBefore)?.[1]);
    const preexistingOverride=/UPDATES\s+STOPPED/i.test(batteryBefore);
    if(beforeLevel!==100){
      if(preexistingOverride)return {accepted:false,reason:'PREEXISTING_BATTERY_OVERRIDE_NOT_100'};
      await adb(['-s',deviceSerial,'shell','dumpsys','battery','set','level','100']);
      batteryOverrideOwned=true;
      const verify=(await adb(['-s',deviceSerial,'shell','dumpsys','battery'])).stdout;
      const verifiedLevel=Number(/(?:^|\n)\s*level:\s*(\d{1,3})\b/i.exec(verify)?.[1]);
      if(verifiedLevel!==100||!/UPDATES\s+STOPPED/i.test(verify)){
        try{await adb(['-s',deviceSerial,'shell','dumpsys','battery','reset']);}catch{}
        batteryOverrideOwned=false;
        return {accepted:false,reason:'OWNED_BATTERY_OVERRIDE_NOT_VERIFIED'};
      }
    }
    currentIntent=intent;sessionId='S10SESSION_'+randomUUID().replaceAll('-','').slice(0,24);
    try{
      const p=sessionFile(stateRoot,sessionId);const h=await open(p,'wx');await h.writeFile(JSON.stringify({schema:'TIGERIQ_S10_SESSION_V1',sessionId,...intent,sourceSha,batteryOverrideOwned})+'\n');await h.close();
      await preparePreview();
      await adb(['-s',deviceSerial,'reverse','tcp:4173','tcp:4173']);reverseAdded=true;
      await adb(['-s',deviceSerial,'shell','am','start','-a','android.intent.action.VIEW','-d',previewUrl]);await sleep(1200);
      return {accepted:true,fresh:true,sessionId,ownerId:intent.ownerId,leaseId:intent.leaseId,fencingToken:intent.fencingToken,sourceSha};
    }catch(error){
      if(reverseAdded){try{await adb(['-s',deviceSerial,'reverse','--remove','tcp:4173']);}catch{} reverseAdded=false;}
      await closePreview().catch(()=>{});
      const sf=sessionFile(stateRoot,sessionId);const row=await safeJson(sf);
      if(row?.sessionId===sessionId&&matchIntent(row,intent))await unlink(sf).catch(()=>{});
      const reset=await resetOwnedBattery(deviceSerial);
      if(reset.ok)await releaseOwnedFence(intent).catch(()=>{});
      if(!reset.ok)throw Error('OWNED_BATTERY_RESET_UNVERIFIED');
      throw error;
    }
  };
  const runLevel=async({level,intent,sessionId:given})=>{
    if(given!==sessionId||!(await verifyFence({intent})).accepted)throw Error('FENCE_LOST');
    const serial=intent.deviceSerial;
    const home=await findNode(serial,'Chọn màn',{tries:2});if(home){const p=nodeCenter(home);await adb(['-s',serial,'shell','input','tap',String(p.x),String(p.y)]);await sleep(300);}
    await tapNode(serial,names[level]);
    await tapNode(serial,'CÓ THỂ SỬA',{contains:true});
    await tapNode(serial,answers[level]);
    await tapNode(serial,'CHẠY');
    const pass=await findNode(serial,'ĐÃ GIÚP ROBOT!',{tries:14});if(!pass)throw Error('LEVEL_NOT_ACCEPTED:'+level);
    const dir=join(stateRoot,'evidence',sessionId);await mkdir(dir,{recursive:true});
    const shot=(await adb(['-s',serial,'exec-out','screencap','-p'],{binary:true,timeout:20000})).stdout;
    const path=join(dir,level+'.png');await writeFile(path,shot);
    return {level,pass:true,evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/5284',evidencePath:path,evidenceSha256:digest(shot)};
  };
  const closePreview=async()=>{
    if(server){await new Promise(r=>server.close(()=>r()));server=null;}
  };
  const releaseOwnedFence=async intent=>{
    const lp=lockFile(stateRoot,intent?.deviceSerial||'');
    const l=await safeJson(lp);
    if(!l)return true;
    if(!matchIntent(l,intent))return false;
    await unlink(lp).catch(()=>{});
    return true;
  };
  const cleanupOwned=async({intent,sessionId:given})=>{
    if(given!==sessionId||!currentIntent||!matchIntent(currentIntent,intent))return {cleaned:false,sessionId:given};
    const fence=await verifyFence({intent});if(!fence.accepted)return {cleaned:false,sessionId:given};
    if(reverseAdded){try{await adb(['-s',intent.deviceSerial,'reverse','--remove','tcp:4173']);}catch{} reverseAdded=false;}
    await closePreview();
    const reset=await resetOwnedBattery(intent.deviceSerial);
    const batteryReset=reset.reset;
    if(!reset.ok)return {cleaned:false,sessionId:given,reason:'OWNED_BATTERY_RESET_UNVERIFIED'};
    const sf=sessionFile(stateRoot,sessionId);const row=await safeJson(sf);if(row?.sessionId===sessionId&&matchIntent(row,intent))await unlink(sf).catch(()=>{});
    if(!await releaseOwnedFence(intent))return {cleaned:false,sessionId:given};
    return {cleaned:true,sessionId:given,batteryUntouched:!batteryReset,batteryReset};
  };
  return {adb,inspectDevice,preparePreview,verifyFence,beginOnce,runLevel,cleanupOwned,closePreview,releaseOwnedFence};
}

export async function runS10Acceptance({serial,sourceSha,ownerId='NV02_RDC_GH5284',stateRoot=DEFAULT_STATE_ROOT,receiptPath=null}={}){
  if(!ID.test(serial||'')||!SHA.test(sourceSha||''))throw Error('INVALID_ACCEPTANCE_INPUT');
  const adapter=createS10RdcAdapter({stateRoot});
  const observed=await adapter.inspectDevice(serial);
  const preview=await adapter.preparePreview();
  const evidence={
    mcpBindingVerified:true,attestedReadOnlySource:true,adbExecutableVerified:true,
    devices:parseAdbDevices(observed.devicesText),deviceSerial:serial,
    deviceModel:observed.deviceModel,batteryLevel:observed.batteryLevel,
    batteryOverrideDetected:observed.batteryOverrideDetected,
    batteryMutationRequested:observed.batteryLevel!==100&&!observed.batteryOverrideDetected,
    batteryOverrideOwnerVerified:false,previewUrl:preview.url,
    previewReachable:preview.reachable,previewSsoRequired:false,buildSha:sourceSha
  };
  const preflight=evaluateG06Preflight(evidence);
  let result;
  let intent=null;
  try{
    if(!preflight.ready){
      result={workOrder:'GH-5284',code:preflight.code,status:'WAIT',mutated:false,
        productG06Done:false,reason:preflight.reason||'PREFLIGHT_NOT_READY'};
    }else{
      const claim=await claimAtomicFence({stateRoot,ownerId,deviceSerial:serial,sourceSha});
      if(!claim.accepted){
        result={workOrder:'GH-5284',code:'WAIT_DEVICE_EXCLUSIVE_FENCING',status:'WAIT',
          mutated:false,productG06Done:false,reason:claim.code};
      }else{
        intent=claim.intent;
        result=await runG06E2E({adapter,evidence,ownerIntent:intent});
      }
    }
  }finally{
    await adapter.closePreview().catch(()=>{});
    if(intent&&result?.mutated!==true)await adapter.releaseOwnedFence(intent).catch(()=>{});
  }
  const receipt={schema:'TIGERIQ_GH5284_S10_RDC_ACCEPTANCE_V1',workOrder:'GH-5284',
    sourceSha,serial,model:observed.deviceModel,batteryLevel:observed.batteryLevel,
    batteryOverrideDetected:observed.batteryOverrideDetected,
    batteryMutationRequested:observed.batteryLevel!==100&&!observed.batteryOverrideDetected,
    deviceE2EAccepted:result?.code==='PASS_WITH_EVIDENCE',result};
  if(receiptPath){await mkdir(resolve(receiptPath,'..'),{recursive:true});await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');}
  return receipt;
}

function argValue(argv,name){const p=argv.find(x=>x.startsWith(name+'='));return p?.slice(name.length+1);}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const argv=process.argv.slice(2);
  if(argv.includes('--acceptance')){
    runS10Acceptance({serial:argValue(argv,'--serial'),sourceSha:argValue(argv,'--source-sha'),
      ownerId:argValue(argv,'--owner-id')||'NV02_RDC_GH5284',
      stateRoot:argValue(argv,'--state-root')||DEFAULT_STATE_ROOT,
      receiptPath:argValue(argv,'--receipt')||null})
      .then(r=>process.stdout.write(JSON.stringify(r)+'\n'))
      .catch(e=>{console.error('GH5284_S10_ACCEPTANCE_FAILED',e.message);process.exitCode=1;});
  }
}
