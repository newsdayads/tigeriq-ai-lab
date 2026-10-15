import {execFile} from 'node:child_process';

const EXE=String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const CLIENT=String.raw`C:\ProgramData\TigerIQNV07\code\nv07-protected-session-client.ps1`;
const denied=()=>({attestationVerified:false,deviceIdentityVerified:false,code:'NV07_NATIVE_TRUST_NOT_VERIFIED'});

// Core-only authority adapter. No caller-supplied evidence, path, command,
// identity or "verified" flag can replace this fixed OS verifier invocation.
export async function attestNv07ProtectedSession(){
  if(process.platform!=='win32')return denied();
  try{
    const stdout=await new Promise((resolve,reject)=>{
      execFile(EXE,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',CLIENT],
        {windowsHide:true,timeout:15000,maxBuffer:65536,encoding:'utf8'},
        (error,output)=>error?reject(error):resolve(output));
    });
    const value=JSON.parse(String(stdout).replace(/^\uFEFF/,'').trim());
    const at=Date.parse(value?.at),age=Date.now()-at;
    if(value?.accepted!==true||value?.code!=='NV07_OS_PEER_AND_PROTECTED_CODE_VERIFIED'
      ||value?.host!=='PC01'||value?.windowsUser!=='wdragons12x'
      ||value?.attestationVerified!==true||value?.deviceIdentityVerified!==true
      ||!Number.isSafeInteger(value?.pid)||value.pid<=0
      ||!Number.isInteger(value?.sessionId)||value.sessionId<=0
      ||!/^[a-f0-9]{40}$/.test(value?.sourceSha||'')
      ||!/^[a-f0-9]{64}$/.test(value?.brokerHash||'')
      ||!Number.isFinite(at)||age<0||age>5000
      ||value?.coreLeaseVerified!==false||value?.nv07Active!==false)return denied();
    return Object.freeze({...value,coreLeaseVerified:false,nv07Active:false});
  }catch{return denied();}
}
