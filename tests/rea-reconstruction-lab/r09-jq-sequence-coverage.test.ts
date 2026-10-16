import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
// @ts-ignore Standalone JavaScript source-only classifier intentionally has no TS declarations.
import { inspectR09JqSeqCoverage } from '../../projects/rea-reconstruction-lab/r09-jq-sequence-coverage.mjs';
// @ts-ignore Standalone JavaScript evidence gate intentionally has no TS declarations.
import { inspectR09PackedEvidence } from '../../projects/rea-reconstruction-lab/r09-jq-evidence-gate.mjs';

const packed=readFileSync(new URL('../../projects/rea-reconstruction-lab/r09-jq-observation-16.zlib.b64',import.meta.url),'utf8');
const original=JSON.parse(inflateSync(Buffer.from(packed.trim(),'base64'),{maxOutputLength:131072}).toString('utf8'));
const scan=(x:any)=>inspectR09JqSeqCoverage(x);
const safe=(result:any)=>{
  for(const flag of ['reaExecuted','r09Accepted','coreLeaseOwned','deviceAuthorized','installAuthorized','mutated'])
    expect(result[flag],flag).toBe(false);
};
const byId=(result:any,id:string)=>result.cases.find((c:any)=>c.id===id);

it('R09 authenticated upstream oracle fixture is not a new REA runtime execution',()=>{
  expect(inspectR09PackedEvidence(packed).observationIntegrityOnly).toBe(true);
  const r=scan(original);
  expect(r.decision).toBe('R09_SOURCE_ORACLE_PARTIAL_DATA_RISKS_VERIFIED');
  expect(r.observationalOnly).toBe(true);
  expect(r.caseCount).toBe(4);expect(r.completeInputSemanticsVerified).toBe(false);safe(r);
});
it('R09 silent loss: exit zero and empty stderr do not certify all RS-framed records',()=>{
  const r=byId(scan(original),'B07_JSON_SEQ_RESYNC');
  expect(r).toMatchObject({inputFrames:3,outputFrames:2,missingFrames:1,
    stderrNonempty:false,exitCode:0,kind:'SILENT_RECORD_LOSS'});
});
it('R09 recoverable parser errors still exit zero, dropping one record with stderr',()=>{
  const r=scan(original);
  for(const id of ['B15_SEQ_INVALID_TOKEN','B16_SEQ_MALFORMED_BRACE'])
    expect(byId(r,id)).toMatchObject({inputFrames:3,outputFrames:2,missingFrames:1,
      stderrNonempty:true,exitCode:0,kind:'RECORD_LOSS_WITH_DIAGNOSTIC'});
});
it('R09 NaN input normalized as null must not be called strict JSON conformance',()=>{
  const r=byId(scan(original),'B13_SEQ_ERROR');
  expect(r).toMatchObject({inputFrames:3,outputFrames:3,missingFrames:0,
    stderrNonempty:false,exitCode:0,kind:'COUNT_MATCHED_NONJSON_NAN_NORMALIZATION'});
});
it('R09 summary never describes silent or warned partial outputs as accepted work',()=>{
  const r=scan(original);
  expect(r.silentLossCases).toBe(1);
  expect(r.warnedLossCases).toBe(2);
  expect(r.normalizedNonJsonCases).toBe(1);
  expect(r.completeInputSemanticsVerified).toBe(false);safe(r);
});
it('R09 tampered exit codes and per-stream bytes fail source evidence verification first',()=>{
  const a=structuredClone(original);
  a.cases.find((c:any)=>c.id==='B07_JSON_SEQ_RESYNC').exit_code=5;
  expect(scan(a).reason).toBe('PINNED_ORACLE_NOT_VERIFIED');
  const b=structuredClone(original);
  b.cases.find((c:any)=>c.id==='B15_SEQ_INVALID_TOKEN').stderr_hex='ff';
  expect(scan(b).reason).toBe('PINNED_ORACLE_NOT_VERIFIED');
});
it('R09 falsified REA/host execution or deleted cases cannot pass completeness gate',()=>{
  const a=structuredClone(original);a.rea_runtime_used=true;
  expect(scan(a).decision).toBe('REJECTED');
  const b=structuredClone(original);b.cases.pop();
  expect(scan(b).decision).toBe('REJECTED');
  const c=structuredClone(original);c.core_or_pc01_used=true;
  expect(scan(c).decision).toBe('REJECTED');
});
it('R09 output is bounded summaries, not raw inputs or secrets or R05/R06 permission',()=>{
  const r=scan(original), txt=JSON.stringify(r);
  expect(r.cases).toHaveLength(4);
  expect(txt).not.toContain('"good"');
  expect(txt).not.toContain('NaN');
  expect(txt).not.toContain('stderr_hex');
  expect(r.nativeBuildProvenance).toBe(false);safe(r);
});
