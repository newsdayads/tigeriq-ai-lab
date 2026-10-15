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
