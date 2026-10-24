/** GH-5284: fail-closed S10 E2E orchestrator. No raw ADB or PC01 shell. */
import {evaluateG06Preflight} from './s10-preflight.mjs';
import {pathToFileURL} from 'node:url';
const LEVELS=Object.freeze(['L01','L02','L03','L04','L05']);
const wait=(code,fields={})=>({workOrder:'GH-5284',code,status:'WAIT',mutated:false,
  productG06Done:false,...fields});
const leaseValid=(r,intent,serial)=>r?.accepted===true&&
  r?.scope===intent.resourceScope&&r?.deviceSerial===serial&&
  Number.isFinite(r?.expiresAtMs)&&r.expiresAtMs>Date.now();

/**
 * Only an authorized native runtime may provide adapter. Its verifyFence,
 * beginOnce, runLevel and cleanupOwned must atomically check actual lease,
 * scope, device and ownership, not booleans from GitHub or input JSON.
 * No native adapter is shipped; CLI does not connect to PC01/ADB.
 */
export async function runG06E2E({adapter=null,evidence={},ownerIntent=null}={}) {
  const preflight=evaluateG06Preflight(evidence);
  if(!preflight.ready)return wait(preflight.code);
  if(!adapter||['verifyFence','beginOnce','runLevel','cleanupOwned'].some(
    name=>typeof adapter[name]!=='function'))return wait('WAIT_RUNTIME_MCP_BINDING');
  if(ownerIntent?.workOrder!=='GH-5284'||
     ownerIntent.resourceScope!=='TIGERIQ_GAME_G06_S10_E2E_HARNESS')
    return wait('WAIT_DEVICE_EXCLUSIVE_FENCING');
  const check=async action=>leaseValid(await adapter.verifyFence({intent:ownerIntent,action}),
    ownerIntent,evidence.deviceSerial);
  try{
    if(!await check('preflight'))return wait('WAIT_DEVICE_EXCLUSIVE_FENCING');
    // Atomic idempotency proof must be from the actual native bridge.
    const session=await adapter.beginOnce({intent:ownerIntent,deviceSerial:evidence.deviceSerial,
      sourceSha:evidence.buildSha});
    if(session?.accepted!==true||session?.fresh!==true||
      !/^[A-Za-z0-9_-]{12,96}$/.test(session?.sessionId||''))
      return wait('WAIT_DEVICE_EXCLUSIVE_FENCING',{reason:'SESSION_NOT_FRESH_OR_UNVERIFIED'});
    const steps=[];
    let mutated=false,problem=null,cleaned=false;
    try{
      for(const level of LEVELS){
        if(!await check('level:'+level)){
          problem='WAIT_DEVICE_EXCLUSIVE_FENCING';break;
        }
        mutated=true;
        const result=await adapter.runLevel({level,intent:ownerIntent,sessionId:session.sessionId});
        if(result?.level!==level||result?.pass!==true||
          typeof result.evidenceRef!=='string'||
          !/^https:\/\/[^\s]+$/.test(result.evidenceRef)){
          problem='WAIT_RUNTIME_MCP_BINDING';break;
        }
        steps.push({level,pass:true,evidenceRef:result.evidenceRef});
      }
    } catch {problem='WAIT_RUNTIME_MCP_BINDING';}
    finally {
      try {
        if(await check('cleanup')) {
          // Adapter must clean only its own session-owned state and must NOT
          // reset a preexisting battery override or a competing actor's data.
          const result=await adapter.cleanupOwned({intent:ownerIntent,
            sessionId:session.sessionId});
          cleaned=result?.cleaned===true&&result?.sessionId===session.sessionId;
        }
      } catch {cleaned=false;}
    }
    if(!cleaned) return wait('WAIT_DEVICE_EXCLUSIVE_FENCING',{
      mutated,attemptedLevels:steps.length,reason:'CLEANUP_NOT_ATTESTED'});
    if(problem)return wait(problem,{mutated,attemptedLevels:steps.length});
    return {workOrder:'GH-5284',code:'PASS_WITH_EVIDENCE',status:'PASS',
      mutated,levels:steps,sourceSha:evidence.buildSha,cleanupAttested:true,
      productG06Done:false,reason:'G06_ACCEPTANCE_REQUIRES_SEPARATE_REAL_DEVICE_QA'};
  }catch{return wait('WAIT_RUNTIME_MCP_BINDING');}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  runG06E2E().then(result=>console.log(JSON.stringify(result)));
