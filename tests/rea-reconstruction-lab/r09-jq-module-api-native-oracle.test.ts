import {expect, it} from 'vitest';
// @ts-ignore Standalone source is .mjs and deliberately has no type declarations.
import {
  pinnedR09ModuleAPICases, inspectR09ModuleAPICases,
  replayR09ModuleAPIIsolated,
  R09_MODULE_API_UPSTREAM_COMMIT, R09_MODULE_API_FIXTURE_SHA256,
} from '../../projects/rea-reconstruction-lab/r09-jq-module-api-native-oracle.mjs';

const cases=()=>pinnedR09ModuleAPICases();
const noRuntimeClaims=(r:any)=>{
  for(const key of ['sourceBuildAuthenticated','reaExecuted','r09Accepted','coreLeaseOwned',
    'deviceAuthorized','installAuthorized','pc01Used','mutated'])
    expect(r[key],key).toBe(false);
};

it('pins exactly ten distinct jq 1.7 module/API native receipts by immutable SHA',()=>{
  const x=inspectR09ModuleAPICases(cases());
  expect(x).toMatchObject({decision:'R09_JQ_MODULE_API_ORACLE_BYTES_VERIFIED_NOT_REA_ACCEPTANCE',
    oracleIntegrityOnly:true,caseCount:10});
  expect(R09_MODULE_API_FIXTURE_SHA256).toMatch(/^[a-f0-9]{64}$/);
  expect(R09_MODULE_API_UPSTREAM_COMMIT).toMatch(/^[a-f0-9]{40}$/);
  noRuntimeClaims(x);
});

it('documents a distinct call chain for map/sort, get/set/del path, walk, reduce, try/catch, entries',()=>{
  const rows=cases();
  expect(rows.map((x:any)=>x[0].split('_').slice(1).join('_'))).toEqual([
    'MAP_DEFAULT','SORT_BY_COMPOUND','GETPATH','SETPATH','DELPATHS',
    'WALK_RECURSIVE','REDUCE_ACCUMULATE','TRY_CATCH',
    'ENTRIES_ROUNDTRIP','UPDATE_PATH_ERROR',
  ]);
  expect(rows.slice(0,9).every((x:any)=>x[5]===0)).toBe(true);
  expect(rows[9][5]).toBe(5);
  noRuntimeClaims(inspectR09ModuleAPICases(rows));
});

it('tampering any observed byte or command fails SHA gate',()=>{
  for(const field of [0,1,2,3,4,5]){
    const x=cases();
    if(field===1)x[0][1][1]='.';
    else if(field===5)x[0][5]=3;
    else x[0][field]+='TAMPER';
    const r=inspectR09ModuleAPICases(x);
    expect(r.decision).toBe('REJECTED');noRuntimeClaims(r);
  }
});

it('duplicate, missing and appended observations fail closed',()=>{
  for(const change of [
    (rows:any[])=>rows.pop(),
    (rows:any[])=>rows.push(rows[0]),
    (rows:any[])=>rows[1][0]=rows[0][0]
  ]){
    const x=cases();change(x);
    const r=inspectR09ModuleAPICases(x);
    expect(r.decision).toBe('REJECTED');noRuntimeClaims(r);
  }
});

it('caller cannot mutate the pinned source fixture through a returned clone',()=>{
  const x=cases();x[0][0]='malicious';
  expect(cases()[0][0]).toBe('M01_MAP_DEFAULT');
  expect(inspectR09ModuleAPICases(cases()).oracleIntegrityOnly).toBe(true);
});

it('hostile rows, cycles, getters and invalid shapes are rejected without leaking caller content',()=>{
  for(const bad of [null,undefined,{},[],42,'text',cases().slice(0,1)]){
    const r=inspectR09ModuleAPICases(bad);
    expect(r.decision).toBe('REJECTED');noRuntimeClaims(r);
  }
  const x=cases();Object.defineProperty(x[0],3,{get(){throw new Error('PRIVATE_TOKEN_MARKER')}});
  const r=inspectR09ModuleAPICases(x);
  expect(JSON.stringify(r)).not.toContain('PRIVATE_TOKEN_MARKER');
  expect(r.decision).toBe('REJECTED');noRuntimeClaims(r);
  const cycle=cases();cycle[0][1][0]=cycle;
  expect(inspectR09ModuleAPICases(cycle).decision).toBe('REJECTED');
});

it('native replay is fail closed for nonpinned binary path, without running a subprocess',()=>{
  const r=replayR09ModuleAPIIsolated(cases(),{binary:'/tmp/noncanonical-jq'});
  expect(r).toMatchObject({ok:false,reason:'NONPINNED_BINARY_PATH'});
  const x=cases();x[0][5]=42;
  expect(replayR09ModuleAPIIsolated(x)).toMatchObject({ok:false,reason:'UNVERIFIED_FIXTURES'});
});
