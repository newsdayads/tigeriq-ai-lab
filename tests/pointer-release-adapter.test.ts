import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,test} from 'vitest';
import {ZeroTouchUpdateCoordinator,type ComponentUpdateManifest} from '../packages/update-framework/src/index.js';
import {PointerReleaseAdapter} from '../packages/update-framework/src/pointer-release-adapter.js';

const HASH='c'.repeat(64),SOURCE='d'.repeat(40);
const roots:string[]=[];
const manifest=(version:string,revision:number):ComponentUpdateManifest=>({schemaVersion:1,component:'command-center',version,revision,sourceSha:SOURCE,artifactSha256:HASH,preserveKeys:['identity','state']});
afterEach(async()=>{while(roots.length)await rm(roots.pop()!,{recursive:true,force:true});});

async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'tigeriq-pointer-'));roots.push(root);
  const releases=path.join(root,'releases'),pointer=path.join(root,'current-release.txt'),state=path.join(root,'state.json');
  const dirs=new Map<string,string>();
  for(const version of ['1.0.0','1.1.0','1.2.0','1.3.0','2.0.0']){
    const dir=path.join(releases,version);dirs.set(version,dir);await mkdir(dir,{recursive:true});
    await writeFile(path.join(dir,'entry.txt'),version,'utf8');await writeFile(path.join(dir,'health.txt'),version==='2.0.0'?'fail':'ok','utf8');
  }
  await writeFile(pointer,dirs.get('1.0.0')!,'utf8');
  await writeFile(state,JSON.stringify({version:'1.0.0',revision:1,artifactSha256:HASH,releaseDir:dirs.get('1.0.0')}),'utf8');
  const activations:string[]=[];
  const adapter=new PointerReleaseAdapter({
    releaseRoot:releases,pointerPath:pointer,statePath:state,
    resolveCandidate:async m=>({releaseDir:dirs.get(m.version)!,sha256:m.artifactSha256}),
    verifyCandidate:async(dir,m)=>({ok:(await readFile(path.join(dir,'entry.txt'),'utf8'))===m.version,detail:'entry-match'}),
    activate:async dir=>{activations.push(path.basename(dir));},
    healthCheck:async dir=>({ok:(await readFile(path.join(dir,'health.txt'),'utf8'))==='ok',detail:path.basename(dir)}),
    preservedFingerprints:{identity:async()=> 'identity-fingerprint',state:async()=> 'state-fingerprint'}
  });
  return {adapter,dirs,pointer,state,activations,releases};
}

describe('PointerReleaseAdapter',()=>{
  test('applies three versions through atomic pointer and persists state',async()=>{
    const f=await fixture(),coordinator=new ZeroTouchUpdateCoordinator();
    for(const [version,revision] of [['1.1.0',2],['1.2.0',3],['1.3.0',4]] as const)expect((await coordinator.run(manifest(version,revision),f.adapter)).status).toBe('updated');
    expect((await readFile(f.pointer,'utf8')).trim()).toBe(f.dirs.get('1.3.0'));
    expect(JSON.parse(await readFile(f.state,'utf8')).version).toBe('1.3.0');
    expect(f.activations).toEqual(['1.1.0','1.2.0','1.3.0']);
  });

  test('health failure restores prior pointer and leaves committed state unchanged',async()=>{
    const f=await fixture(),coordinator=new ZeroTouchUpdateCoordinator();
    await coordinator.run(manifest('1.1.0',2),f.adapter);
    const result=await coordinator.run(manifest('2.0.0',3),f.adapter);
    expect(result.status).toBe('rolled_back');expect(result.rolledBack).toBe(true);
    expect((await readFile(f.pointer,'utf8')).trim()).toBe(f.dirs.get('1.1.0'));
    expect(JSON.parse(await readFile(f.state,'utf8')).version).toBe('1.1.0');
    expect(f.activations.slice(-2)).toEqual(['2.0.0','1.1.0']);
  });

  test('same revision is a no-op with no duplicate activation',async()=>{
    const f=await fixture(),coordinator=new ZeroTouchUpdateCoordinator();
    const result=await coordinator.run(manifest('1.0.0',1),f.adapter);
    expect(result.status).toBe('no_change');expect(f.activations).toHaveLength(0);
  });

  test('rejects candidate outside release root before pointer mutation',async()=>{
    const f=await fixture();
    const outside=path.join(path.dirname(f.releases),'outside');await mkdir(outside,{recursive:true});
    const adapter=new PointerReleaseAdapter({...f.adapter.options,resolveCandidate:async()=>({releaseDir:outside,sha256:HASH})});
    const result=await new ZeroTouchUpdateCoordinator().run(manifest('1.1.0',2),adapter);
    expect(result.status).toBe('failed');expect(result.error).toBe('RELEASE_PATH_OUTSIDE_ROOT');
    expect((await readFile(f.pointer,'utf8')).trim()).toBe(f.dirs.get('1.0.0'));
  });
});
