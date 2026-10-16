// GH-4780 R09: bounded observation classifier. NOT generic jq conformance or REA analysis.
import { inspectR09Snapshot } from './r09-jq-evidence-gate.mjs';
const EXPECTED = Object.freeze(['B07_JSON_SEQ_RESYNC','B13_SEQ_ERROR',
  'B15_SEQ_INVALID_TOKEN','B16_SEQ_MALFORMED_BRACE']);
const deny = reason => ({decision:'REJECTED', reason, observationalOnly:false,
  reaExecuted:false, r09Accepted:false, coreLeaseOwned:false,
  deviceAuthorized:false, installAuthorized:false, mutated:false});
const rs = b => [...b].filter(c=>c===0x1e).length;
export function inspectR09JqSeqCoverage(snapshot) {
  const verified = inspectR09Snapshot(snapshot);
  if (!verified || verified.observationIntegrityOnly!==true) return deny('PINNED_ORACLE_NOT_VERIFIED');
  const cases = snapshot.cases.filter(c=>c.argv.includes('--seq'));
  if(cases.length!==EXPECTED.length || EXPECTED.some(id=>!cases.some(c=>c.id===id)))
    return deny('SEQ_CASE_SCOPE_DRIFT');
  const records=[];
  for(const id of EXPECTED) {
    const c = cases.find(c=>c.id===id);
    // Pinned oracle uses exactly --seq -c '.' with JSON text-sequence RS framing.
    if(c.argv.length!==3||c.argv[0]!=='--seq'||c.argv[1]!=='-c'||c.argv[2]!=='.')
      return deny('SEQ_ARGUMENTS_UNEXPECTED');
    const input=Buffer.from(c.stdin_hex,'hex'), output=Buffer.from(c.stdout_hex,'hex');
    const error=Buffer.from(c.stderr_hex,'hex');
    const inFrames=rs(input),outFrames=rs(output);
    if(!inFrames||outFrames>inFrames||c.exit_code!==0)
      return deny('SEQ_ORACLE_SHAPE_DRIFT');
    const missing=inFrames-outFrames;
    let kind = 'COUNT_MATCHED_CONTENT_UNVERIFIED';
    if(missing>0)kind=error.length>0?'RECORD_LOSS_WITH_DIAGNOSTIC':'SILENT_RECORD_LOSS';
    else if(id==='B13_SEQ_ERROR' && input.includes(Buffer.from('NaN')) &&
            output.includes(Buffer.from('null')))
      kind='COUNT_MATCHED_NONJSON_NAN_NORMALIZATION';
    records.push({id, inputFrames:inFrames, outputFrames:outFrames, missingFrames:missing,
      exitCode:c.exit_code, stderrNonempty:error.length>0, kind});
  }
  return {decision:'R09_SOURCE_ORACLE_PARTIAL_DATA_RISKS_VERIFIED',
    observationalOnly:true, caseCount:records.length,
    cases:records, silentLossCases:records.filter(r=>r.kind==='SILENT_RECORD_LOSS').length,
    warnedLossCases:records.filter(r=>r.kind==='RECORD_LOSS_WITH_DIAGNOSTIC').length,
    normalizedNonJsonCases:records.filter(r=>r.kind==='COUNT_MATCHED_NONJSON_NAN_NORMALIZATION').length,
    completeInputSemanticsVerified:false, nativeBuildProvenance:false,
    reaExecuted:false, r09Accepted:false, coreLeaseOwned:false,
    deviceAuthorized:false, installAuthorized:false, mutated:false};
}
