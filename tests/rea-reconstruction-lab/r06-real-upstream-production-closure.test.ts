import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const path = new URL('../../projects/rea-reconstruction-lab/r06-real-upstream-production-closure.json', import.meta.url);
const e:any = JSON.parse(readFileSync(path,'utf8'));
it('R06 pinned real upstream reference does not impersonate consumer/install/lease evidence',()=>{
  expect(e.schemaVersion).toBe('TIGERIQ_REA_R06_REAL_UPSTREAM_SOURCE_CLOSURE_V1');
  expect(e.source.commit).toBe('a56f7bb668ab23fec8d33f7af353ac7ed2fe1895');
  expect(e.source.lockfileGitBlobSha1).toBe('3b28f2d827f3a7baad04e36ea2f4302427b5f567');
  expect(e.source.packageJsonGitBlobSha1).toBe('0947dd7c4577c93825b5804748c739010722a085');
  expect(Object.keys(e.directDependencies)).toHaveLength(35);
  expect(e.nonAcceptance.sourceOnly).toBe(true);
  for (const [key,v] of Object.entries(e.nonAcceptance)) if(key!=='sourceOnly')expect(v).toBe(false);
});
it('R06 immutable-source 148-row reference is internally consistent and scoped',()=>{
  const c=e.productionClosure;
  expect(c).toHaveLength(148);
  expect(new Set(c.map((v:any)=>v.path)).size).toBe(148);
  expect(c.map((v:any)=>v.path)).toEqual([...c.map((v:any)=>v.path)].sort());
  expect(c.filter((v:any)=>v.optionalFlag)).toHaveLength(6);
  expect(c.filter((v:any)=>v.devFlag || v.hasInstallScriptFlag)).toHaveLength(0);
  expect(e.totals.missingDependencyReferences).toBe(0);
  for (const v of c){
    expect(v.path).toMatch(/^node_modules\//);
    expect(v.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(v.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
    expect(v.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\/[^?#]+$/);
  }
});
it('R06 upstream development alias and flagged scripts remain clearly separated',()=>{
  expect(e.totals.allSourceDependencyRows).toBe(561);
  expect(e.totals.sourceInstallScriptFlagRows).toBe(2);
  expect(e.upstreamInstallScriptHints).toHaveLength(2);
  expect(e.upstreamInstallScriptHints.every((v:any)=>v.devFlag===true)).toBe(true);
  expect(e.devOnlyAlias.declaration).toBe('npm:typescript@5.9.3');
  expect(e.devOnlyAlias.absentFromProductionClosure).toBe(true);
});
