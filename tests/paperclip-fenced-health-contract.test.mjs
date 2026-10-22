import { describe,it,expect,vi } from 'vitest';
import {readFileSync} from 'node:fs';
import { PAPERCLIP_LAB_ACTIONS,assertPaperclipLabRequest,readFencedPaperclipHealth } from '../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs';
import {
  PAPERCLIP_DIRECT_SCOPE,PAPERCLIP_NV06_RESOURCE,
  paperclipFencedHealthNativeAccepted,executeFencedPaperclipHealth,
} from '../apps/tigeriq-core/paperclip-direct-lease.mjs';

const validNative=()=>({ok:true,action:'paperclip_lab_fenced_health',target:'pc01-local',data:{
  ok:true,http:{appOk:true},port:{reachable:true},
  docker:{transport:'wsl-ubuntu-interactive-broker',version:'29.1.3'},
  backup:{verified:true,gzipCrcVerified:true,pgDumpHeaderVerified:true,pgDumpFooterVerified:true,restoreTested:false,archiveSha256:'a'.repeat(64)},
  database:{present:true,running:true,healthStatus:'healthy'},
  container:{identityOk:true,portBindingOk:true},
  broker:{ready:true,sourceVerified:true,version:'1.7-openai-device-auth',sessionId:1,ageMs:250,wslKeepaliveRunning:true},
}});
function harness({native=validNative(),ownerDirect=true,scope=PAPERCLIP_DIRECT_SCOPE,heartbeats=[true,true],releaseOk=true,action='paperclip_lab_fenced_health'}={}){
  const job={id:'JOB-GH-2054-HEALTH',objective_metadata:{
    issueNumber:2054,ownerDirect,resourceScope:scope,
    pcOperatorDirectAction:{action}
  }};
  const db={query:vi.fn()};
  const execute=vi.fn().mockResolvedValue(native);
  const acquire=vi.fn(async (_db,spec)=>({lease_token:'PRIVATE-TEST-FENCE',
    resource_id:spec.resourceId,work_id:spec.workId,
    lease_until:new Date(Date.now()+120000).toISOString()}));
  const hs=[...heartbeats],heartbeat=vi.fn(async()=>hs.length?hs.shift():true);
  const release=vi.fn().mockResolvedValue(releaseOk);
  return {job,db,execute,acquire,heartbeat,release,
    call:()=>executeFencedPaperclipHealth({job,db,execute,acquire,heartbeat,release})};
}
describe('GH-2054: fenced Docker/PostgreSQL native proof',()=>{
  it('never allows the existing unleased health tool to write broker requests',()=>{
    const src=readFileSync(new URL('../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs',import.meta.url),'utf8');
    expect(src).toContain('resolveDockerTransport(signal, { allowBrokerProbe: false })');
    expect(src).toContain('export async function readFencedPaperclipHealth(signal = null)');
    expect(src).toContain('resolveDockerTransport(signal, { allowBrokerProbe: true })');
    expect(PAPERCLIP_LAB_ACTIONS).not.toContain('paperclip_lab_fenced_health');
    expect(() => assertPaperclipLabRequest({action:'paperclip_lab_fenced_health'})).toThrow('TIGERIQ_PAPERCLIP_LAB_ACTION_NOT_ALLOWED');
    expect(readFencedPaperclipHealth).toBeTypeOf('function');
    expect(()=>assertPaperclipLabRequest({action:'paperclip_lab_fenced_health',path:'C:\\'})).toThrow();
  });
  it('Core typed dispatch reaches only the guarded owner-scoped lane',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    const intake=readFileSync(new URL('../apps/tigeriq-core/github-intake.mjs',import.meta.url),'utf8');
    expect(core).toContain("action.action==='paperclip_lab_fenced_health'");
    expect(core).toContain('executeFencedPaperclipHealth({');
    expect(core).toContain('const data=await readFencedPaperclipHealth();');
    expect(core).toContain('acquire:acquireSharedResourceLease,heartbeat:heartbeatSharedResourceLease');
    expect(intake).toContain("'paperclip_lab_fenced_health'");
  });
  it('rejects healthy HTTP-only or DB-only receipts',()=>{
    expect(paperclipFencedHealthNativeAccepted({ok:true,data:{http:{appOk:true}}})).toBe(false);
    const stale=validNative();stale.data.broker.sourceVerified=false;
    expect(paperclipFencedHealthNativeAccepted(stale)).toBe(false);
    const db=validNative();db.data.database.healthStatus='starting';
    expect(paperclipFencedHealthNativeAccepted(db)).toBe(false);
    const mount=validNative();mount.data.container.identityOk=false;
    expect(paperclipFencedHealthNativeAccepted(mount)).toBe(false);
    const docker=validNative();docker.data.docker.version='';
    expect(paperclipFencedHealthNativeAccepted(docker)).toBe(false);
    const noBackup=validNative();delete noBackup.data.backup;
    expect(paperclipFencedHealthNativeAccepted(noBackup)).toBe(false);
    const fakeBackup=validNative();fakeBackup.data.backup.gzipCrcVerified=false;
    expect(paperclipFencedHealthNativeAccepted(fakeBackup)).toBe(false);
  });
  it('allows exactly one live proof after the NV06 atomic lease with fencing and confirmed release',async()=>{
    const h=harness(),r=await h.call();
    expect(r.leaseVerified).toBe(true);expect(r.leaseReleased).toBe(true);
    expect(h.acquire).toHaveBeenCalledOnce();
    expect(h.acquire.mock.calls[0][1]).toMatchObject({
      employeeId:'NV06',resourceId:PAPERCLIP_NV06_RESOURCE,
      workId:h.job.id,lane:'core_pc_direct',
      metadata:{workOrderId:2054,resourceScope:PAPERCLIP_DIRECT_SCOPE,action:'paperclip_lab_fenced_health',targetStepId:'R03'}
    });
    expect(h.heartbeat).toHaveBeenCalledTimes(2);
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.execute).toHaveBeenCalledWith({action:'paperclip_lab_fenced_health'});
    expect(h.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(r)).not.toContain('PRIVATE-TEST-FENCE');
  });
  it.each([
    ['owner missing',{ownerDirect:false}],
    ['foreign scope',{scope:'OUTSIDE_SCOPE'}],
    ['wrong action',{action:'paperclip_lab_stop'}],
  ])('rejects %s before any PC01 execution',async(_name,opts)=>{
    const h=harness(opts);await expect(h.call()).rejects.toThrow('PAPERCLIP_CORE_DIRECT_SCOPE_NOT_AUTHORIZED');
    expect(h.execute).not.toHaveBeenCalled();expect(h.acquire).not.toHaveBeenCalled();
  });
  it('never queries Docker without a fenced lease and always releases on failure',async()=>{
    const h=harness({heartbeats:[false]});
    await expect(h.call()).rejects.toThrow('NV06_SHARED_LEASE_NOT_FENCED');
    expect(h.execute).not.toHaveBeenCalled();expect(h.release).toHaveBeenCalledOnce();
  });
  it('rejects lost ownership after a read and negative Postgres proof',async()=>{
    const h=harness({heartbeats:[true,false]});
    await expect(h.call()).rejects.toThrow('NV06_SHARED_LEASE_LOST');
    expect(h.release).toHaveBeenCalledOnce();
    const noDb=validNative();noDb.data.database.present=false;
    const x=harness({native:noDb});await expect(x.call()).rejects.toThrow('NATIVE_FENCED_HEALTH_NOT_ACCEPTED');
    expect(x.release).toHaveBeenCalledOnce();
  });
  it('never treats a positive Docker receipt as accepted if the lease release fails',async()=>{
    const h=harness({releaseOk:false});
    await expect(h.call()).rejects.toThrow('NV06_SHARED_LEASE_RELEASE_UNVERIFIED');
    expect(h.execute).toHaveBeenCalledOnce();expect(h.release).toHaveBeenCalledOnce();
  });
});