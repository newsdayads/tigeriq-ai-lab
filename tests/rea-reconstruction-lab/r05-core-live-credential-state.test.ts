import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
const liveStart=source.indexOf('async function liveStatusSnapshot(){');
const liveEnd=source.indexOf('async function snapshot(){',liveStart);
const statusStart=source.indexOf('function publicStatus(r){');
const statusEnd=source.indexOf('async function publicJobEvidence(',statusStart);

it('R05 live-status reads credential_state internally before classifying readiness',()=>{
 expect(liveStart).toBeGreaterThan(0);
 expect(liveEnd).toBeGreaterThan(liveStart);
 const live=source.slice(liveStart,liveEnd);
 expect(live).toContain('provider,credential_state,health_state,work_state,current_job_id');
 expect(live).toContain('status:publicStatus(r)');
 expect(live).not.toMatch(/credential_state\s*:\s*r\.credential_state/);
 expect(live).toContain('sharedLeases');
});

it('Core publicStatus converts a real WAIT_KEY database state to blocked without leaking credentials',()=>{
 expect(statusStart).toBeGreaterThan(0);
 expect(statusEnd).toBeGreaterThan(statusStart);
 const snippet=source.slice(statusStart,statusEnd).trim();
 const classify=runInNewContext('('+snippet+')') as (row:Record<string,unknown>)=>string;
 const base={enabled:true,health_state:'ONLINE',work_state:'READY',current_job_id:null};
 expect(classify({...base,credential_state:'WAIT_KEY'})).toBe('WAIT_KEY');
 expect(classify({...base,credential_state:'READY'})).toBe('IDLE');
 expect(classify({...base,credential_state:'WAIT_KEY',current_job_id:'running'})).toBe('WAIT_KEY');
});

it('REA R05 reader treats WAIT_KEY as not ready and never grants a lease',()=>{
 const diagnostic=readFileSync(new URL('../../projects/rea-reconstruction-lab/r05-readonly-core-admission.mjs',import.meta.url),'utf8');
 expect(diagnostic).toContain("'WAIT_KEY', 'RATE_LIMITED', 'ERROR', 'OFFLINE'");
 expect(diagnostic).toContain('leaseOwned: false');
 expect(diagnostic).toContain('installAuthorized: false');
 expect(diagnostic).not.toContain('acquireSharedResourceLease(');
});
