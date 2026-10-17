import { expect, it } from 'vitest';
// @ts-ignore Standalone .mjs source deliberately has no TS declaration file.
import {inspectR09ExitStreamCases, pinnedR09ExitStreamCases} from '../../projects/rea-reconstruction-lab/r09-jq-exit-stream-native-oracle.mjs';
const cases=()=>pinnedR09ExitStreamCases();
const denyFlags=(r:any)=>{
  for(const key of ['sourceBuildAuthenticated','reaExecuted','r09Accepted','coreLeaseOwned',
    'deviceAuthorized','installAuthorized','pc01Used','mutated'])expect(r[key],key).toBe(false);
};
it('13 actual pinned jq 1.7 oracle cases pass static bytes-integrity gate, never REA',()=>{
  const r=inspectR09ExitStreamCases(cases());
  expect(r).toMatchObject({decision:'R09_NATIVE_JQ_ORACLE_BYTES_VERIFIED_NOT_REA_ACCEPTANCE',
    oracleIntegrityOnly:true,caseCount:13,zeroExitErrorDataCases:2,nonzeroExitCases:5});
  denyFlags(r);
});
it('jq -e explicitly distinguishes false/null, zero outputs and parse failure',()=>{
  const rows=cases();
  expect(rows.slice(0,7).map((r:any)=>r[5])).toEqual([1,1,0,4,1,0,5]);
  expect(rows[3][3]).toBe('');expect(rows[6][4]).toContain('parse error');
});
it('--stream-errors emits parse failures as stdout data despite exit=0',()=>{
  const rows=cases();
  for(const index of [8,9]){
    expect(rows[index][1]).toContain('--stream-errors');
    expect(rows[index][5]).toBe(0);
    expect(rows[index][3]).toContain('Unfinished JSON term');
    expect(rows[index][4]).toBe('');
  }
});
it('changed native output and parsed stream markers fail immutable SHA',()=>{
  for(const field of [2,3,4,5,0,1]){
    const x=cases();
    x[0][field]=field===1?['--fake']:field===5?0:'TAMPERED';
    const r=inspectR09ExitStreamCases(x);
    expect(r.decision).toBe('REJECTED');denyFlags(r);
  }
});
it('missing, duplicate or appended cases are rejected',()=>{
  for(const mutate of [
    (x:any[])=>x.pop(),
    (x:any[])=>x.push(x[0]),
    (x:any[])=>x[1][0]=x[0][0]
  ]){
    const x=cases();mutate(x);
    const r=inspectR09ExitStreamCases(x);expect(r.decision).toBe('REJECTED');denyFlags(r);
  }
});
it('hostile getters and cyclic data are rejected without exposing private markers',()=>{
  const first=cases();Object.defineProperty(first[0],3,{get(){throw new Error('SECRET_MARKER');}});
  const second=cases();second[0][1].push(second);
  for(const x of [first,second]){
    const r=inspectR09ExitStreamCases(x);
    expect(r.decision).toBe('REJECTED');expect(JSON.stringify(r)).not.toContain('SECRET_MARKER');
    denyFlags(r);
  }
});
it('invalid shapes and non-JSON coercions fail closed',()=>{
  for(const bad of [null,{},[],42,'string',cases().slice(0,5)]){
    const r=inspectR09ExitStreamCases(bad);expect(r.decision).toBe('REJECTED');denyFlags(r);
  }
});
