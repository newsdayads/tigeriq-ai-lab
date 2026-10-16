import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
// @ts-ignore Standalone JavaScript evidence gate intentionally has no TypeScript declarations.
import {inspectR09PackedEvidence, inspectR09Snapshot} from '../../projects/rea-reconstruction-lab/r09-jq-evidence-gate.mjs';

const packed=readFileSync(new URL('../../projects/rea-reconstruction-lab/r09-jq-observation-16.zlib.b64',import.meta.url),'utf8');
const fixture=JSON.parse(inflateSync(Buffer.from(packed.trim(),'base64'),{maxOutputLength:131072}).toString('utf8'));
const safe=(r:any)=>{
  for(const key of ['sourceAuthenticated','nativeBuildProvenance','reaExecuted','coreLeaseOwned','deviceAuthorized','installAuthorized','mutated'])
    expect(r[key],key).toBe(false);
};

it('R09 authentic pinned bundled 16-case byte data remains observation-only',()=>{
  const r=inspectR09PackedEvidence(packed);
  expect(r.decision).toBe('SOURCE_OBSERVATION_BYTES_VERIFIED_NOT_RUNTIME_ATTESTATION');
  expect(r.count).toBe(16);expect(r.observationIntegrityOnly).toBe(true);safe(r);
});
it('R09 source-only in-memory record validates its 16 streams without a jq rerun',()=>{
  const r=inspectR09Snapshot(fixture);expect(r.count).toBe(16);safe(r);
});
it('R09 tampered native stdout must be rejected even if other fixture metadata looks valid',()=>{
  const x=structuredClone(fixture);x.cases[0].stdout_hex='61';
  const r=inspectR09Snapshot(x);expect(r.reason).toBe('STREAM_DIGEST_MISMATCH');safe(r);
});
it('R09 tampered native stderr must be rejected',()=>{
  const x=structuredClone(fixture);x.cases[14].stderr_hex='61';
  const r=inspectR09Snapshot(x);expect(r.reason).toBe('STREAM_DIGEST_MISMATCH');safe(r);
});
it('R09 duplicate, missing cases and false REA/build/PC01 claims fail closed',()=>{
  for(const modify of [
    (x:any)=>{x.cases.pop();},
    (x:any)=>{x.cases[1].id=x.cases[0].id;},
    (x:any)=>{x.rea_runtime_used=true;},
    (x:any)=>{x.build_provenance_verified=true;},
    (x:any)=>{x.core_or_pc01_used=true;},
  ]){
    const x=structuredClone(fixture);modify(x);
    const r=inspectR09Snapshot(x);expect(r.decision).toBe('REJECTED');safe(r);
  }
});
it('R09 modified evidence still fails immutable bundle SHA even if internally self-consistent',()=>{
  const x=structuredClone(fixture);x.cases[0].exit_code=0;
  const modified=deflateSync(Buffer.from(JSON.stringify(x))).toString('base64');
  const r=inspectR09PackedEvidence(modified);
  expect(r.reason).toBe('BUNDLE_DIGEST_MISMATCH');safe(r);
});
it('R09 malformed base64, excessive input and invalid compression fail without echoing secrets',()=>{
  for(const input of ['PRIVATE_SECRET', 'A'.repeat(30000), 'AAAA']){
    const r=inspectR09PackedEvidence(input);
    expect(r.decision).toBe('REJECTED');safe(r);
    expect(JSON.stringify(r)).not.toContain('PRIVATE_SECRET');
  }
});
