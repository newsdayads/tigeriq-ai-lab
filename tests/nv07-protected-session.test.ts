import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({exec:vi.fn()}));
vi.mock('node:child_process',()=>({execFile:native.exec}));
import {attestNv07ProtectedSession} from '../apps/openclaw-tigeriq-runtime/nv07-protected-session.mjs';
const actualProcess=process;
const now=Date.parse('2026-10-16T00:00:00Z');
const proof=(patch={})=>({
 accepted:true,code:'NV07_OS_PEER_AND_PROTECTED_CODE_VERIFIED',
 host:'PC01',windowsUser:'wdragons12x',pid:42,sessionId:1,
 attestationVerified:true,deviceIdentityVerified:true,
 sourceSha:'a'.repeat(40),brokerHash:'b'.repeat(64),at:new Date(now).toISOString(),
 coreLeaseVerified:false,nv07Active:false,...patch,
});
const respond=(value:unknown)=>native.exec.mockImplementation((_exe:unknown,_args:unknown,_opts:unknown,cb:Function)=>cb(null,JSON.stringify(value)));
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(now);
 vi.stubGlobal('process',{...actualProcess,platform:'win32'});native.exec.mockReset();
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('fixed protected native verifier authority boundary',()=>{
 it('rejects unsupported hosts without invoking any process',async()=>{
  vi.stubGlobal('process',{...actualProcess,platform:'linux'});
  expect((await attestNv07ProtectedSession()).attestationVerified).toBe(false);
  expect(native.exec).not.toHaveBeenCalled();
 });
 it('uses only the protected verifier and cannot activate or claim a Core lease',async()=>{
  respond(proof());
  expect(await attestNv07ProtectedSession()).toMatchObject({
   attestationVerified:true,coreLeaseVerified:false,nv07Active:false,
  });
  const [exe,args,options]=native.exec.mock.calls[0];
  expect(exe).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`);
  expect(args).toEqual(['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
   String.raw`C:\ProgramData\TigerIQNV07\code\nv07-protected-session-client.ps1`]);
  expect(options).toMatchObject({windowsHide:true,timeout:15000,maxBuffer:65536});
  expect(options.shell).toBeUndefined();
 });
 it.each([
  {code:'NV07_NATIVE_SESSION_IPC_RESPONDED'},
  {windowsUser:'SYSTEM'},{host:'OTHER'},{sessionId:0},{pid:0},
  {sourceSha:'untrusted'},{brokerHash:'untrusted'},
  {attestationVerified:false},{deviceIdentityVerified:false},
  {at:new Date(now-5001).toISOString()},{at:new Date(now+1).toISOString()},
  {coreLeaseVerified:true},{nv07Active:true},
 ])('fails closed on invalid or overclaimed proof %j',async patch=>{
  respond(proof(patch));
  expect((await attestNv07ProtectedSession()).attestationVerified).toBe(false);
 });
 it('does not trust successful-looking stdout when the native process failed',async()=>{
  native.exec.mockImplementation((_e:unknown,_a:unknown,_o:unknown,cb:Function)=>cb(new Error('failed'),JSON.stringify(proof())));
  expect((await attestNv07ProtectedSession()).attestationVerified).toBe(false);
 });
 it('rejects extra log text instead of extracting an attractive JSON fragment',async()=>{
  native.exec.mockImplementation((_e:unknown,_a:unknown,_o:unknown,cb:Function)=>cb(null,'not a receipt\n'+JSON.stringify(proof())));
  expect((await attestNv07ProtectedSession()).attestationVerified).toBe(false);
 });
});
