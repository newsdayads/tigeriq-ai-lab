import {describe,expect,test} from 'vitest';
import {ZeroTouchUpdateCoordinator,type ComponentUpdateManifest,type InstalledComponentState,type StagedCandidate,type UpdateCheck,type ZeroTouchComponentAdapter} from '../packages/update-framework/src/index.js';

type Handle={version:string;revision:number};
const HASH='a'.repeat(64),SOURCE='b'.repeat(40);
function manifest(version:string,revision:number,overrides:Partial<ComponentUpdateManifest>={}):ComponentUpdateManifest{
  return {schemaVersion:1,component:'command-center',version,revision,sourceSha:SOURCE,artifactSha256:HASH,preserveKeys:['identity','state'],...overrides};
}

class FakeAdapter implements ZeroTouchComponentAdapter<Handle>{
  installed:InstalledComponentState={version:'1.0.0',revision:1,artifactSha256:HASH};
  preserved:Record<string,string>={identity:'id-fingerprint',state:'state-fingerprint'};
  staged=0;applied=0;committed=0;rolledBack=0;healthCalls=0;
  healthPlan:boolean[]=[];
  stageGate:Promise<void>|null=null;
  async current(){return {...this.installed};}
  async stage(m:ComponentUpdateManifest):Promise<StagedCandidate<Handle>>{this.staged++;if(this.stageGate)await this.stageGate;return {sha256:m.artifactSha256,handle:{version:m.version,revision:m.revision}};}
  async verify():Promise<UpdateCheck>{return {ok:true,detail:'provenance-ok'};}
  async capturePreserved(keys:string[]){return Object.fromEntries(keys.map(k=>[k,this.preserved[k]]));}
  async apply(){this.applied++;}
  async health(){const ok=this.healthPlan.length?this.healthPlan.shift()!:true;this.healthCalls++;return {ok,detail:ok?'healthy':'forced-health-fail'};}
  async commit(m:ComponentUpdateManifest){this.committed++;this.installed={version:m.version,revision:m.revision,artifactSha256:m.artifactSha256};}
  async rollback(previous:InstalledComponentState){this.rolledBack++;this.installed={...previous};}
}

describe('ZeroTouchUpdateCoordinator',()=>{
  test('updates three consecutive versions while preserving state',async()=>{
    const adapter=new FakeAdapter(),coordinator=new ZeroTouchUpdateCoordinator();
    for(const [version,revision] of [['1.1.0',2],['1.2.0',3],['1.3.0',4]] as const){
      const result=await coordinator.run(manifest(version,revision),adapter);
      expect(result.status).toBe('updated');
      expect(result.evidence.map(e=>e.phase)).toEqual(['check','stage','verify','apply','health','commit']);
      expect(adapter.preserved).toEqual({identity:'id-fingerprint',state:'state-fingerprint'});
    }
    expect(adapter.installed.version).toBe('1.3.0');expect(adapter.committed).toBe(3);expect(adapter.rolledBack).toBe(0);
  });

  test('rolls back a forced health failure',async()=>{
    const adapter=new FakeAdapter();adapter.healthPlan=[false];
    const result=await new ZeroTouchUpdateCoordinator().run(manifest('2.0.0',2),adapter);
    expect(result.status).toBe('rolled_back');expect(result.rolledBack).toBe(true);expect(adapter.installed.version).toBe('1.0.0');
    expect(result.evidence.map(e=>e.phase)).toContain('rollback');
  });

  test('bounded retry rolls back then succeeds',async()=>{
    const adapter=new FakeAdapter();adapter.healthPlan=[false,true];
    const result=await new ZeroTouchUpdateCoordinator().run(manifest('2.0.0',2,{maxAttempts:2}),adapter);
    expect(result.status).toBe('updated');expect(result.attempts).toBe(2);expect(adapter.rolledBack).toBe(1);expect(adapter.committed).toBe(1);
  });

  test('same installed revision is idempotent and does not apply twice',async()=>{
    const adapter=new FakeAdapter(),coordinator=new ZeroTouchUpdateCoordinator();
    const result=await coordinator.run(manifest('1.0.0',1),adapter);
    expect(result.status).toBe('no_change');expect(adapter.staged).toBe(0);expect(adapter.applied).toBe(0);
  });

  test('concurrent duplicate component update returns busy without duplicate apply',async()=>{
    const adapter=new FakeAdapter(),coordinator=new ZeroTouchUpdateCoordinator();
    let release!:()=>void;adapter.stageGate=new Promise<void>(resolve=>{release=resolve;});
    const first=coordinator.run(manifest('2.0.0',2),adapter);
    const second=await coordinator.run(manifest('2.0.1',3),adapter);
    expect(second.status).toBe('busy');expect(second.error).toBe('UPDATE_IN_FLIGHT');
    release();expect((await first).status).toBe('updated');expect(adapter.applied).toBe(1);
  });

  test('rejects downgrade before staging',async()=>{
    const adapter=new FakeAdapter();adapter.installed={version:'3.0.0',revision:3,artifactSha256:HASH};
    const result=await new ZeroTouchUpdateCoordinator().run(manifest('2.0.0',2),adapter);
    expect(result.status).toBe('failed');expect(result.error).toBe('NON_FORWARD_UPDATE_DENIED');expect(adapter.staged).toBe(0);
  });
});
