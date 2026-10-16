import { expect, it } from 'vitest';
// @ts-ignore Standalone JS module intentionally has no TypeScript declarations.
import { inspectR06ConsumerLock, REA_DIRECT_DEPENDENCIES, REA_EXPECTED_SRI } from '../../projects/rea-reconstruction-lab/r06-consumer-lock-preflight.mjs';
const sri='sha512-'+('A'.repeat(86))+'==';
const fixture=():any=>{
  const deps=structuredClone(REA_DIRECT_DEPENDENCIES);
  const packages:any={
    '':{name:'synthetic-consumer',version:'0.0.0',dependencies:{'rea-agents':'6.4.0'}},
    'node_modules/rea-agents':{version:'6.4.0',integrity:REA_EXPECTED_SRI,
      resolved:'https://registry.npmjs.org/rea-agents/-/rea-agents-6.4.0.tgz',
      dependencies:deps}
  };
  for(const [name,ver] of Object.entries(deps))
    packages['node_modules/'+name]={
      version:ver,integrity:sri,
      resolved:`https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${ver}.tgz`
    };
  return {lockfileVersion:3,packages};
};
const safe=(r:any)=>{
  for(const k of ['sourceAuthenticated','lockByteDigestVerified','installed',
    'actualSbomVerified','transitiveScriptsVerified','deviceAuthorized','leaseOwned',
    'installAuthorized','hostIsolationVerified','mutated','releaseAuthorized'])
    expect(r[k],k).toBe(false);
};
it('R06 full synthetic lock is never a real install or source authorization',()=>{
  const r=inspectR06ConsumerLock(fixture());
  expect(r.decision).toBe('STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED');
  expect(r.counts).toMatchObject({packageRows:36,directDependencies:35});
  safe(r);
});
it('R06 rejects missing root and wrong npm lock versions',()=>{
  const x=fixture();delete x.packages[''];
  for(const bad of [null,{},x,{...fixture(),lockfileVersion:2}]){
    const r=inspectR06ConsumerLock(bad);expect(r.decision).toBe('REJECTED');safe(r);
  }
});
it('R06 pins exact upstream version, SRI and registry origin without credentials',()=>{
  for(const mutate of [
    (x:any)=>x.packages[''].dependencies['rea-agents']='^6.4.0',
    (x:any)=>x.packages['node_modules/rea-agents'].integrity=sri,
    (x:any)=>x.packages['node_modules/rea-agents'].version='6.4.1',
    (x:any)=>x.packages['node_modules/rea-agents'].resolved='http://registry.npmjs.org/rea-agents/-/rea-agents-6.4.0.tgz',
    (x:any)=>x.packages['node_modules/rea-agents'].resolved='https://token@registry.npmjs.org/rea-agents/-/rea-agents-6.4.0.tgz'
  ]){
    const x=fixture();mutate(x);
    const r=inspectR06ConsumerLock(x);
    expect(r.reason).toBe('REA_ARTIFACT_PIN_MISMATCH');safe(r);
  }
});
it('R06 detects direct manifest drift and resolved dependency version drift',()=>{
  const x=fixture();x.packages['node_modules/rea-agents'].dependencies['playwright-core']='^1.58.2';
  expect(inspectR06ConsumerLock(x).reason).toBe('REA_DIRECT_DEPENDENCIES_MISMATCH');
  const y=fixture();y.packages['node_modules/playwright-core'].version='1.58.1';
  const r=inspectR06ConsumerLock(y);
  expect(r.reason).toBe('REA_LOCK_RESOLUTION_MISMATCH');safe(r);
});
it('R06 detects a missing pinned package and an unresolved nested dependency',()=>{
  const x=fixture();delete x.packages['node_modules/playwright-core'];
  expect(inspectR06ConsumerLock(x).reason).toBe('PACKAGE_ENTRIES_INVALID');
  // Keep row count in range so the separate dependency-resolution guard is exercised.
  x.packages['node_modules/unrelated-example']={version:'1.0.0',integrity:sri,
    resolved:'https://registry.npmjs.org/unrelated-example/-/unrelated-example-1.0.0.tgz'};
  expect(inspectR06ConsumerLock(x).reason).toBe('REA_LOCK_RESOLUTION_MISMATCH');
  const y=fixture();y.packages['node_modules/zod'].dependencies={absent:'1.0.0'};
  const r=inspectR06ConsumerLock(y);
  expect(r.reason).toBe('UNRESOLVED_DEPENDENCY_REFERENCE');safe(r);
});
it('R06 rejects symlinks, SHA1, local and git sources',()=>{
  for(const mutate of [
    (x:any)=>x.packages['node_modules/zod'].link=true,
    (x:any)=>x.packages['node_modules/zod'].integrity='sha1-TEST',
    (x:any)=>x.packages['node_modules/zod'].resolved='file:/tmp/zod.tgz',
    (x:any)=>x.packages['node_modules/zod'].resolved='git+ssh://example.test/zod'
  ]){
    const x=fixture();mutate(x);
    const r=inspectR06ConsumerLock(x);
    expect(r.reason).toBe('UNVERIFIED_PACKAGE_SOURCE');safe(r);
  }
});
it('R06 counts lifecycle hints without claiming transitive scripts are audited',()=>{
  const x=fixture();x.packages['node_modules/@lydell/node-pty'].hasInstallScript=true;
  const r=inspectR06ConsumerLock(x);
  expect(r.counts.packagesWithInstallScriptFlag).toBe(1);
  expect(r.transitiveScriptsVerified).toBe(false);safe(r);
});
it('R06 sanitizes output even when caller supplies secret-like fields',()=>{
  const x=fixture();x.packages['node_modules/zod'].apiToken='PRIVATE_SECRET_MARKER';
  const r=JSON.stringify(inspectR06ConsumerLock(x));
  expect(r).not.toContain('PRIVATE_SECRET_MARKER');
});
it('R06 rejects malformed/unsafe entries and excessive package counts',()=>{
  const x=fixture();x.packages['node_modules/../evil']={};
  expect(inspectR06ConsumerLock(x).reason).toBe('PACKAGE_ENTRIES_INVALID');
  const y=fixture();y.packages['node_modules/zod']=null;
  expect(inspectR06ConsumerLock(y).reason).toBe('PACKAGE_ENTRIES_INVALID');
  const z=fixture();for(let i=0;i<2000;i++)z.packages['node_modules/p'+i]={};
  expect(inspectR06ConsumerLock(z).reason).toBe('PACKAGE_ENTRIES_INVALID');
});


it('R06 rejects substituted REA tarball from same npm registry despite pinned-looking metadata',()=>{
  const x=fixture();
  x.packages['node_modules/rea-agents'].resolved=
    'https://registry.npmjs.org/rogue/-/rogue-6.4.0.tgz';
  const r=inspectR06ConsumerLock(x);
  expect(r.reason).toBe('REA_ARTIFACT_PIN_MISMATCH');safe(r);
});
it('R06 rejects transitive registry tarball whose name or version differs from node_modules entry',()=>{
  for(const resolved of [
    'https://registry.npmjs.org/rogue/-/rogue-4.4.3.tgz',
    'https://registry.npmjs.org/zod/-/zod-9.9.9.tgz',
    'https://registry.npmjs.org/zod/-/rogue-4.4.3.tgz'
  ]){
    const x=fixture();x.packages['node_modules/zod'].resolved=resolved;
    const r=inspectR06ConsumerLock(x);
    expect(r.reason).toBe('UNVERIFIED_PACKAGE_SOURCE');safe(r);
  }
});
it('R06 detects scoped package substitution while accepting canonical encoded scoped path',()=>{
  const bad=fixture();
  bad.packages['node_modules/@babel/parser'].resolved=
    'https://registry.npmjs.org/@fake/parser/-/parser-8.0.4.tgz';
  const r=inspectR06ConsumerLock(bad);
  expect(r.reason).toBe('UNVERIFIED_PACKAGE_SOURCE');safe(r);
  const ok=fixture();
  ok.packages['node_modules/@babel/parser'].resolved=
    'https://registry.npmjs.org/@babel%2fparser/-/parser-8.0.4.tgz';
  const x=inspectR06ConsumerLock(ok);
  expect(x.decision).toBe('STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED');safe(x);
});

it('R06 permits missing optional OS-specific node-pty binary rows without accepting installation',()=>{
  const realOptionalOs=['darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-arm64','win32-x64'];
  const x=fixture();
  x.packages['node_modules/@lydell/node-pty'].optionalDependencies=Object.fromEntries(
    realOptionalOs.map(os=>['@lydell/node-pty-'+os,'1.1.0']));
  x.packages['node_modules/@lydell/node-pty-win32-x64']={version:'1.1.0',optional:true,
    os:['win32'],cpu:['x64'],integrity:sri,
    resolved:'https://registry.npmjs.org/@lydell/node-pty-win32-x64/-/node-pty-win32-x64-1.1.0.tgz'};
  const r=inspectR06ConsumerLock(x);
  expect(r.decision).toBe('STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED');
  expect(r.counts).toMatchObject({missingOptionalDependencies:5,packageRows:37});
  safe(r);
});
it('R06 reports absent optional native package without claiming binary availability',()=>{
  const x=fixture();x.packages['node_modules/@lydell/node-pty'].optionalDependencies={
    '@lydell/node-pty-win32-x64':'1.1.0'};
  const r=inspectR06ConsumerLock(x);
  expect(r.counts.missingOptionalDependencies).toBe(1);safe(r);
});
it('R06 preserves mandatory dependency fail-closed checks',()=>{
  const x=fixture();x.packages['node_modules/zod'].dependencies={'required-missing':'1.0.0'};
  const r=inspectR06ConsumerLock(x);
  expect(r.reason).toBe('UNRESOLVED_DEPENDENCY_REFERENCE');safe(r);
});
it('R06 rejects invalid optional specs and suspicious optional package tarball substitution',()=>{
  const x=fixture();x.packages['node_modules/zod'].optionalDependencies={missing:''};
  expect(inspectR06ConsumerLock(x).reason).toBe('INVALID_DEPENDENCY_REFERENCE');
  const y=fixture();y.packages['node_modules/zod'].optionalDependencies={foo:'1.0.0'};
  y.packages['node_modules/foo']={version:'1.0.0',integrity:sri,
    resolved:'https://registry.npmjs.org/rogue/-/rogue-1.0.0.tgz'};
  const r=inspectR06ConsumerLock(y);
  expect(r.reason).toBe('UNVERIFIED_PACKAGE_SOURCE');safe(r);
});

it('R06 rejects exact optional native pin mismatching an internally consistent registry row',()=>{
  const x=fixture();x.packages['node_modules/@lydell/node-pty'].optionalDependencies={'@lydell/node-pty-win32-x64':'1.1.0'};
  x.packages['node_modules/@lydell/node-pty-win32-x64']={version:'1.1.1',integrity:sri,
    resolved:'https://registry.npmjs.org/@lydell/node-pty-win32-x64/-/node-pty-win32-x64-1.1.1.tgz'};
  const r=inspectR06ConsumerLock(x);expect(r.reason).toBe('DEPENDENCY_EXACT_VERSION_MISMATCH');safe(r);
});
it('R06 rejects mandatory exact pin mismatch even when tarball filename matches row',()=>{
  const x=fixture();x.packages['node_modules/zod'].dependencies={extra:'1.1.0'};
  x.packages['node_modules/extra']={version:'1.1.1',integrity:sri,
    resolved:'https://registry.npmjs.org/extra/-/extra-1.1.1.tgz'};
  const r=inspectR06ConsumerLock(x);expect(r.reason).toBe('DEPENDENCY_EXACT_VERSION_MISMATCH');safe(r);
});
it('R06 matching exact optional addon stays shape-only, never install-approved',()=>{
  const x=fixture();x.packages['node_modules/@lydell/node-pty'].optionalDependencies={'@lydell/node-pty-win32-x64':'1.1.0'};
  x.packages['node_modules/@lydell/node-pty-win32-x64']={version:'1.1.0',integrity:sri,
    resolved:'https://registry.npmjs.org/@lydell/node-pty-win32-x64/-/node-pty-win32-x64-1.1.0.tgz'};
  const r=inspectR06ConsumerLock(x);expect(r.decision).toBe('STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED');safe(r);
});
it('R06 exact prerelease pins are compared rather than silently bypassed',()=>{
  const x=fixture();x.packages['node_modules/zod'].dependencies={extra:'2.0.0-alpha.4'};
  x.packages['node_modules/extra']={version:'2.0.0-alpha.5',integrity:sri,
    resolved:'https://registry.npmjs.org/extra/-/extra-2.0.0-alpha.5.tgz'};
  const r=inspectR06ConsumerLock(x);expect(r.reason).toBe('DEPENDENCY_EXACT_VERSION_MISMATCH');safe(r);
});

it('R06 rejects ^1.2.3 when a valid registry package row resolves to a different major',()=>{
  const x=fixture();x.packages['node_modules/zod'].dependencies={extra:'^1.2.3'};
  x.packages['node_modules/extra']={version:'2.0.0',integrity:sri,
    resolved:'https://registry.npmjs.org/extra/-/extra-2.0.0.tgz'};
  const r=inspectR06ConsumerLock(x);expect(r.reason).toBe('DEPENDENCY_RANGE_MISMATCH');safe(r);
});
it('R06 rejects ^0.2.0 crossing minor boundary and ^0.0.3 crossing patch',()=>{
  for(const [spec,version] of [['^0.2.0','0.3.0'],['^0.0.3','0.0.4']]){
    const x=fixture();x.packages['node_modules/zod'].dependencies={extra:spec};
    x.packages['node_modules/extra']={version,integrity:sri,
      resolved:'https://registry.npmjs.org/extra/-/extra-'+version+'.tgz'};
    const r=inspectR06ConsumerLock(x);expect(r.reason).toBe('DEPENDENCY_RANGE_MISMATCH');safe(r);
  }
});
it('R06 rejects ~5.2.0 across minor boundary and major-only 1 across majors',()=>{
  for(const [spec,version] of [['~5.2.0','5.3.0'],['1','2.0.0']]){
    const x=fixture();x.packages['node_modules/zod'].dependencies={extra:spec};
    x.packages['node_modules/extra']={version,integrity:sri,
      resolved:'https://registry.npmjs.org/extra/-/extra-'+version+'.tgz'};
    const r=inspectR06ConsumerLock(x);expect(r.reason).toBe('DEPENDENCY_RANGE_MISMATCH');safe(r);
  }
});
it('R06 accepts supported ^, ~, and major-only versions only as static shapes',()=>{
  for(const [spec,version] of [['^1.2.3','1.9.0'],['^0.2.0','0.2.9'],['~5.2.0','5.2.8'],['1','1.4.2']]){
    const x=fixture();x.packages['node_modules/zod'].dependencies={extra:spec};
    x.packages['node_modules/extra']={version,integrity:sri,
      resolved:'https://registry.npmjs.org/extra/-/extra-'+version+'.tgz'};
    const r=inspectR06ConsumerLock(x);
    expect(r.decision).toBe('STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED');safe(r);
  }
});
it('R06 fails closed for unsupported semver expressions even on absent optional dependencies',()=>{
  for(const spec of ['>=1.0.0','file:./local.tgz','^1.2','*','npm:other@1.0.0']){
    const x=fixture();x.packages['node_modules/zod'].optionalDependencies={optional:spec};
    const r=inspectR06ConsumerLock(x);expect(r.reason).toBe('UNSUPPORTED_DEPENDENCY_SPEC');safe(r);
  }
});
it('R06 rejects ranged prerelease resolutions without a prerelease-aware full npm resolver',()=>{
  const x=fixture();x.packages['node_modules/zod'].dependencies={extra:'^2.0.0'};
  x.packages['node_modules/extra']={version:'2.1.0-beta.1',integrity:sri,
    resolved:'https://registry.npmjs.org/extra/-/extra-2.1.0-beta.1.tgz'};
  const r=inspectR06ConsumerLock(x);expect(r.reason).toBe('DEPENDENCY_RANGE_MISMATCH');safe(r);
});

it('R06 minimal consumer root rejects additional resolved top-level dependencies',()=>{
  const x=fixture();
  // Zod already has a valid row. Previously this extra install request passed.
  x.packages[''].dependencies.zod='4.4.3';
  const r=inspectR06ConsumerLock(x);
  expect(r).toMatchObject({decision:'REJECTED',reason:'CONSUMER_ROOT_SCOPE_DRIFT'});
  safe(r);
});
it('R06 minimal consumer root rejects top-level optional, dev and peer request maps',()=>{
  for(const kind of ['optionalDependencies','devDependencies','peerDependencies']){
    const x=fixture();
    x.packages[''][kind]={zod:'4.4.3'};
    const r=inspectR06ConsumerLock(x);
    expect(r).toMatchObject({decision:'REJECTED',reason:'CONSUMER_ROOT_SCOPE_DRIFT'});
    safe(r);
  }
});
it('R06 minimal consumer root rejects install scripts and workspace/bundled inputs',()=>{
  for(const extra of [
    {hasInstallScript:true},
    {scripts:{preinstall:'echo NEVER_EXECUTE'}},
    {workspaces:['./untrusted']},
    {bundleDependencies:['zod']},
    {bundledDependencies:['zod']}
  ]){
    const x=fixture();
    Object.assign(x.packages[''],extra);
    const r=inspectR06ConsumerLock(x);
    expect(r).toMatchObject({decision:'REJECTED',reason:'CONSUMER_ROOT_SCOPE_DRIFT'});
    expect(JSON.stringify(r)).not.toContain('NEVER_EXECUTE');
    safe(r);
  }
});
it('R06 minimal locked root still never claims install safety after scope-closure checks',()=>{
  const x=fixture();
  const r=inspectR06ConsumerLock(x);
  expect(r.decision).toBe('STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED');
  expect(r).toMatchObject({sourceAuthenticated:false,installed:false,
    actualSbomVerified:false,leaseOwned:false,installAuthorized:false});
  safe(r);
});

it('R06 rejects injected required peer edge on an otherwise pinned transitive package',()=>{
  const x=fixture();
  x.packages['node_modules/zod'].peerDependencies={untrusted:'^1.0.0'};
  x.packages['node_modules/untrusted']={version:'1.2.0',integrity:sri,
    resolved:'https://registry.npmjs.org/untrusted/-/untrusted-1.2.0.tgz'};
  const r=inspectR06ConsumerLock(x);
  expect(r).toMatchObject({decision:'REJECTED',reason:'PEER_DEPENDENCY_SCOPE_DRIFT'});
  safe(r);
});
it('R06 accepts only the three optional upstream peer declarations as source shape',()=>{
  const x=fixture();
  x.packages['node_modules/ajv-formats'].peerDependencies={ajv:'^8.0.0'};
  x.packages['node_modules/ajv-formats'].peerDependenciesMeta={ajv:{optional:true}};
  x.packages['node_modules/ws'].peerDependencies={'bufferutil':'^4.0.1',
    'utf-8-validate':'>=5.0.2'};
  x.packages['node_modules/ws'].peerDependenciesMeta={
    bufferutil:{optional:true},'utf-8-validate':{optional:true}};
  const r=inspectR06ConsumerLock(x);
  expect(r.decision).toBe('STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED');
  expect(r.counts).toMatchObject({peerDeclarations:3,missingOptionalPeers:2});
  safe(r);
});
it('R06 rejects required or undeclared optional peer metadata in pinned packages',()=>{
  for(const mutate of [
    (x:any)=>{x.packages['node_modules/ws'].peerDependencies={bufferutil:'^4.0.1'};},
    (x:any)=>{x.packages['node_modules/ws'].peerDependencies={bufferutil:'^4.0.1'};x.packages['node_modules/ws'].peerDependenciesMeta={bufferutil:{optional:false}};},
    (x:any)=>{x.packages['node_modules/ws'].peerDependenciesMeta={unknown:{optional:true}};},
    (x:any)=>{x.packages['node_modules/zod'].peerDependenciesMeta={hidden:{optional:true}};}
  ]){
    const x=fixture();mutate(x);
    const r=inspectR06ConsumerLock(x);
    expect(r).toMatchObject({decision:'REJECTED',reason:'PEER_DEPENDENCY_SCOPE_DRIFT'});safe(r);
  }
});
it('R06 rejects present optional peer with incompatible resolved version',()=>{
  const x=fixture();
  x.packages['node_modules/ws'].peerDependencies={'utf-8-validate':'>=5.0.2'};
  x.packages['node_modules/ws'].peerDependenciesMeta={'utf-8-validate':{optional:true}};
  x.packages['node_modules/utf-8-validate']={
    version:'5.0.0',integrity:sri,
    resolved:'https://registry.npmjs.org/utf-8-validate/-/utf-8-validate-5.0.0.tgz'};
  const r=inspectR06ConsumerLock(x);
  expect(r).toMatchObject({decision:'REJECTED',reason:'PEER_DEPENDENCY_VERSION_MISMATCH'});safe(r);
});
it('R06 >=5.0.2 optional peer admits matching synthetic row without host proof',()=>{
  const x=fixture();
  x.packages['node_modules/ws'].peerDependencies={'utf-8-validate':'>=5.0.2'};
  x.packages['node_modules/ws'].peerDependenciesMeta={'utf-8-validate':{optional:true}};
  x.packages['node_modules/utf-8-validate']={version:'5.0.2',integrity:sri,
    resolved:'https://registry.npmjs.org/utf-8-validate/-/utf-8-validate-5.0.2.tgz'};
  const r=inspectR06ConsumerLock(x);
  expect(r.decision).toBe('STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED');
  expect(r.counts).toMatchObject({peerDeclarations:1,missingOptionalPeers:0});safe(r);
});

it('R06 hostile getter/proxy input is rejected instead of throwing or leaking',()=>{
 const poisoned=(message:string)=>{throw new Error(message);};
 const top=Object.defineProperty({},'lockfileVersion',{get(){return poisoned('SENSITIVE_LOCKFIELD');}});
 const packages=Object.defineProperty({lockfileVersion:3},'packages',{get(){return poisoned('SENSITIVE_PACKAGES');}});
 const proxied=new Proxy({}, {get(){return poisoned('SENSITIVE_PROXY');}});
 const nested=fixture();
 Object.defineProperty(nested.packages,'node_modules/rea-agents',{
  get(){return poisoned('SENSITIVE_ROW');}
 });
 for(const input of [top,packages,proxied,nested]){
  let result:any;
  expect(()=>{result=inspectR06ConsumerLock(input);}).not.toThrow();
  expect(result).toMatchObject({decision:'REJECTED',reason:'INVALID_UNTRUSTED_LOCK_OBJECT'});
  expect(JSON.stringify(result)).not.toMatch(/SENSITIVE_/);
  safe(result);
 }
});
it('R06 hostile packages ownKeys Proxy is rejected before lock can be trusted',()=>{
 const hostile=fixture();
 hostile.packages=new Proxy(hostile.packages,{ownKeys(){throw new Error('SENSITIVE_KEYS');}});
 let r:any;
 expect(()=>{r=inspectR06ConsumerLock(hostile);}).not.toThrow();
 expect(r).toMatchObject({decision:'REJECTED',reason:'INVALID_UNTRUSTED_LOCK_OBJECT'});
 safe(r);
});

it('R06 rejects root overrides that could redirect transitive npm resolution',()=>{
 for(const key of ['zod','@lydell/node-pty']){
  const x=fixture();
  x.packages[''].overrides={[key]:'npm:untrusted-replacement@1.0.0'};
  const r=inspectR06ConsumerLock(x);
  expect(r).toMatchObject({decision:'REJECTED',reason:'CONSUMER_ROOT_SCOPE_DRIFT'});
  safe(r);
 }
});
it('R06 rejects inherited REA request despite a single own extra root dependency',()=>{
 const x=fixture();
 const inherited=Object.create({'rea-agents':'6.4.0'});
 inherited.zod='4.4.3';
 x.packages[''].dependencies=inherited;
 const r=inspectR06ConsumerLock(x);
 expect(r).toMatchObject({decision:'REJECTED',reason:'REA_ARTIFACT_PIN_MISMATCH'});
 safe(r);
});
it('R06 permits an empty overrides map and an explicit own REA pin as shape only',()=>{
 const x=fixture();
 x.packages[''].overrides={};
 const r=inspectR06ConsumerLock(x);
 expect(r.decision).toBe('STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED');
 safe(r);
});
