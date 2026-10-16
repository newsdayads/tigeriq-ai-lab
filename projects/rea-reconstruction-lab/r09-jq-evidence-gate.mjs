// GH-4780 R09: verify pinned jq observation bytes; never claim REA runtime, R05 or R06 authority.
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
const SHA256 = /^[0-9a-f]{64}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => ({ decision: 'REJECTED', reason, observationIntegrityOnly: false,
  sourceAuthenticated: false, nativeBuildProvenance: false, reaExecuted: false,
  coreLeaseOwned: false, deviceAuthorized: false, installAuthorized: false, mutated: false });
export const R09_NORMALIZED_EVIDENCE_SHA256 = '3d4fcfac3f98135ed282f581b58f2f35d743cd7f35d6e00d0f308ef877f5a514';
export const R09_ORIGINAL_EVIDENCE_SHA256 = 'c8bfee3f8720a10bd117a984e37a3a032191fdc635c3522916e6de1fca9a078e';
const field = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const record = x => x && typeof x === 'object' && !Array.isArray(x);
const boundedHex = v => typeof v==='string' && v.length <= 131072 && v.length % 2===0 && /^[0-9a-f]*$/.test(v);
export function inspectR09Snapshot(s) {
  if (!record(s) || s.case_count!==16 || !Array.isArray(s.cases) || s.cases.length!==16 ||
      s.binary!=='/usr/bin/jq' || s.version!=='jq-1.7' ||
      s.binary_sha256!=='5e1dcc8c21b9362013a1f30acb24c69a128cbd5238364b88803f4c60cd9376dd' ||
      s.source_repo!=='jqlang/jq' || s.source_commit!=='11c528d04d76c9b9553781aa76b073e4f40da008' ||
      s.original_evidence_sha256!==R09_ORIGINAL_EVIDENCE_SHA256 ||
      s.build_provenance_verified!==false || s.rea_runtime_used!==false || s.core_or_pc01_used!==false)
    return fail('SCOPE_OR_PROVENANCE_MISMATCH');
  const ids=new Set();
  for (const c of s.cases) {
    if (!record(c) || typeof c.id!=='string' || !/^B(0[1-9]|1[0-6])_[A-Z0-9_]+$/.test(c.id) ||
        ids.has(c.id) || !Array.isArray(c.argv) || c.argv.length>12 ||
        c.argv.some(a=>typeof a!=='string'||a.length>256) ||
        !Number.isInteger(c.exit_code) || c.exit_code<0 || c.exit_code>255 ||
        typeof c.purpose!=='string' || c.purpose.length>160)
      return fail('INVALID_CASE_SHAPE');
    ids.add(c.id);
    for(const stream of ['stdin','stdout','stderr']){
      const hex=c[stream+'_hex'], digest=c[stream+'_sha256'];
      if(!field(c,stream+'_hex')||!field(c,stream+'_sha256')||!boundedHex(hex)||
         typeof digest!=='string'||!SHA256.test(digest))return fail('INVALID_STREAM_SHAPE');
      if(sha(Buffer.from(hex,'hex'))!==digest)return fail('STREAM_DIGEST_MISMATCH');
    }
  }
  return { decision:'SOURCE_OBSERVATION_BYTES_VERIFIED_NOT_RUNTIME_ATTESTATION',
    observationIntegrityOnly:true, count:ids.size, sourceAuthenticated:false,
    nativeBuildProvenance:false, reaExecuted:false, coreLeaseOwned:false,
    deviceAuthorized:false, installAuthorized:false, mutated:false };
}
export function inspectR09PackedEvidence(encoded){
  if(typeof encoded!=='string')return fail('INVALID_PACKED_SHAPE');
  const v=encoded.trim();
  if(v.length<16||v.length>20000||v.length%4!==0||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(v))return fail('INVALID_PACKED_SHAPE');
  try {
    const compressed=Buffer.from(v,'base64');
    if(compressed.toString('base64')!==v)return fail('INVALID_PACKED_SHAPE');
    const bytes=inflateSync(compressed,{maxOutputLength:131072});
    if(sha(bytes)!==R09_NORMALIZED_EVIDENCE_SHA256)return fail('BUNDLE_DIGEST_MISMATCH');
    return inspectR09Snapshot(JSON.parse(bytes.toString('utf8')));
  } catch {return fail('INVALID_OR_OVERSIZED_PACKED_PAYLOAD');}
}
