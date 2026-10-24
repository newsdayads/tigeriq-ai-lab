/** GH-5284: fail-closed G06 S10 planning; NEVER starts ADB or reads credentials. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const G06_CODES = Object.freeze([
  'WAIT_RUNTIME_MCP_BINDING', 'WAIT_ADB_UNAVAILABLE', 'WAIT_DEVICE_EXCLUSIVE_FENCING',
  'WAIT_BATTERY_OVERRIDE_OWNER', 'WAIT_PREVIEW_ACCESS',
  'READY_FOR_DEVICE_OWNER_CLAIM', 'PASS_WITH_EVIDENCE'
]);
const SERIAL = /^[A-Za-z0-9._:-]{6,64}$/;
const SHA = /^[0-9a-f]{40}$/;
const safeString = (x, max=128) => typeof x === 'string' ? x.slice(0,max) : '';
const validNumber = x => Number.isInteger(x) && x >= 0 && x <= 100;

export function parseAdbDevices(text) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  // adb stdout without its expected header is not a native device listing.
  // A foreign stdout fragment must never authorize a device.
  if (lines[0].trim() !== 'List of devices attached') return [];
  return lines.slice(1,64).map(line => {
    const m = /^([^\s]+)\s+(device|offline|unauthorized)(?:\s|$)/.exec(line.trim());
    return m ? { serial: safeString(m[1],64), state:m[2] } : null;
  }).filter(Boolean);
}

export function parseBattery(text) {
  if (typeof text !== 'string') return null;
  const level = /(?:^|\n)\s*level:\s*(\d{1,3})\b/i.exec(text);
  const status = /(?:^|\n)\s*status:\s*(\d+)\b/i.exec(text);
  return level && validNumber(Number(level[1])) ?
    {level:Number(level[1]),status:status ? Number(status[1]):null}:null;
}

function safePreview(url) {
  if (typeof url !== 'string' || url.length>256) return false;
  try {
    const u = new URL(url);
    return u.username==='' && u.password==='' && u.search==='' && u.hash==='' &&
      (u.protocol==='https:' || (u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)));
  } catch { return false; }
}

/**
 * Evidence is provided by an already-authorized read-only Core/PC01 adapter.
 * This function never trusts that a supplied flag constitutes a *native* lease.
 * The terminal code here is READY_FOR_DEVICE_OWNER_CLAIM, never PASS.
 */
export function evaluateG06Preflight(evidence={}) {
  const base={workOrder:'GH-5284',resourceScope:'TIGERIQ_GAME_G06_S10_E2E_HARNESS',
    mode:'read_only', deviceMutation:false, coreNativeLease:'NOT_VERIFIED',
    productG06Done:false};
  const finish=(code,fields={})=>({ ...base,code,ready:code==='READY_FOR_DEVICE_OWNER_CLAIM',...fields });
  if(evidence?.mcpBindingVerified!==true || evidence?.attestedReadOnlySource!==true)
    return finish('WAIT_RUNTIME_MCP_BINDING');
  if(evidence?.adbExecutableVerified!==true) return finish('WAIT_ADB_UNAVAILABLE');
  const devices=Array.isArray(evidence?.devices) ? evidence.devices : [];
  const matching=devices.filter(d=>d && d.state==='device' && SERIAL.test(d.serial||''));
  const selected=matching.filter(d=>d.serial===evidence?.deviceSerial);
  if(selected.length!==1 || evidence?.deviceModel!=='SM-G977N')
    return finish('WAIT_ADB_UNAVAILABLE',{reason:'AUTHORIZED_DEVICE_MODEL_OR_SERIAL_NOT_VERIFIED'});
  if(!validNumber(evidence?.batteryLevel))
    return finish('WAIT_BATTERY_OVERRIDE_OWNER',{reason:'BATTERY_BASELINE_UNVERIFIED'});
  // A preexisting battery control/override must be explicitly owned and restored
  // by the same principal. GitHub issue text alone cannot authorize mutation.
  if (typeof evidence?.batteryOverrideDetected !== 'boolean' ||
    (evidence.batteryOverrideDetected && evidence.batteryOverrideOwnerVerified !== true))
    return finish('WAIT_BATTERY_OVERRIDE_OWNER',{reason:'PREEXISTING_OVERRIDE_OWNERSHIP_UNKNOWN'});
  if(!safePreview(evidence?.previewUrl) || evidence?.previewReachable!==true ||
    evidence?.previewSsoRequired!==false)
    return finish('WAIT_PREVIEW_ACCESS');
  if(!SHA.test(evidence?.buildSha||''))
    return finish('WAIT_PREVIEW_ACCESS',{reason:'BUILD_SHA_NOT_ATTESTED'});
  // A separate atomic resource/device claim is ALWAYS required before E2E.
  return finish('READY_FOR_DEVICE_OWNER_CLAIM',{
    sourceSha:evidence.buildSha,deviceModel:'SM-G977N',
    previewKind:new URL(evidence.previewUrl).protocol.replace(':','')});
}

export async function main(argv=process.argv.slice(2)) {
  let result;
  if(argv[0]==='--dry-run' && argv.length===1) result=evaluateG06Preflight();
  else if(argv[0]==='--input' && argv.length===2) {
    // JSON is an untrusted, optional non-secret read-only source snapshot.
    const raw=await readFile(argv[1],{encoding:'utf8'});
    if(Buffer.byteLength(raw)>32768) throw Error('INPUT_TOO_LARGE');
    const evaluated=evaluateG06Preflight(JSON.parse(raw));
    // A local JSON file is untrusted: even perfect fields cannot attest a live
    // MCP binding or create an exclusive device claim. Keep detailed failures,
    // but never emit READY from editable input without the native adapter.
    result=evaluated.ready ? {...evaluated,code:'WAIT_RUNTIME_MCP_BINDING',
      ready:false,reason:'INPUT_JSON_CANNOT_ATTEST_NATIVE_RUNTIME'} : evaluated;
  } else result=evaluateG06Preflight();
  process.stdout.write(JSON.stringify(result)+'\n');
  return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(()=>{console.log(JSON.stringify(evaluateG06Preflight()));process.exitCode=1;});
