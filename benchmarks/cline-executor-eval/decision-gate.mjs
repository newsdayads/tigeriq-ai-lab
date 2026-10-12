// #4532: fail-closed comparison of independently attested, real PC01 lane receipts.
// This module does not execute agents, tests, shell, Docker or access any host.
export const REQUIRED_FIXTURES = Object.freeze([
  'strict-count-parser', 'bounded-tag-normalizer', 'shared-metric-sum-refactor',
]);
const HASH=/^[a-f0-9]{64}$/i;
const finite=(x)=>typeof x==='number'&&Number.isFinite(x);
const object=(x)=>x!=null&&typeof x==='object'&&!Array.isArray(x);

// Validate the native Node TAP trailer, rather than the writable lane's booleans.
function readTapTrailer(text){
  if(typeof text!=='string'||text.length>1200)return null;
  const lines=text.split(/\r?\n/);
  const read=(name)=>{
    const prefix='# '+name+' ';
    const matches=lines.filter(line=>line.startsWith(prefix));
    if(matches.length!==1)return null;
    const value=matches[0].slice(prefix.length).trim();
    return /^\d+$/.test(value)?Number(value):null;
  };
  const names=['tests','pass','fail','cancelled','skipped','todo'];
  const values=names.map(read);
  if(!values.every(Number.isSafeInteger))return null;
  return Object.fromEntries(names.map((name,i)=>[name,values[i]]));
}
function validRawFixture(row,expectedLane,issues,fixtureId){
  const fail=(reason)=>{issues.push(expectedLane+':'+fixtureId+':'+reason);return false;};
  if(!Number.isSafeInteger(row.testExitCode)||row.testExitCode<0||row.testExitCode>255||
     !Number.isSafeInteger(row.filesChanged)||row.filesChanged<0||
     !Number.isSafeInteger(row.linesChanged)||row.linesChanged<0||
     typeof row.stdoutTail!=='string'||typeof row.stderrTail!=='string'||
     row.stdoutTail.length>1200||row.stderrTail.length>1200)
    return fail('RAW_SCORER_FIELDS_MISSING');
  const tap=readTapTrailer(row.stdoutTail);
  if(!tap||tap.tests!==row.testCount||tap.tests<1||
     tap.pass+tap.fail+tap.cancelled+tap.skipped+tap.todo!==tap.tests)
    return fail('TAP_SUMMARY_INCOMPLETE');
  const pass=tap.pass===tap.tests&&tap.fail===0&&tap.cancelled===0&&
    tap.skipped===0&&tap.todo===0&&row.testExitCode===0;
  if(row.testsPass!==pass||(row.testsPass&&row.filesChanged<1)||
     (row.testExitCode===0&&!pass)||
     (row.testExitCode!==0&&tap.fail===0&&tap.cancelled===0))
    return fail('RAW_SCORER_CONTRADICTION');
  return true;
}

function inspectLane(lane,expected,issues){
  if(!object(lane)){issues.push(expected+':RECEIPT_MISSING');return null;}
  if(lane.lane!==expected)issues.push(expected+':LANE_ID_INVALID');
  if(lane.device!=='PC01'||lane.provider!=='ollama'||!HASH.test(String(lane.modelDigest||'')))
    issues.push(expected+':PROVIDER_OR_DEVICE_NOT_ATTESTED');
  if(!HASH.test(String(lane.manifestSha256||''))||!HASH.test(String(lane.traceSha256||'')))
    issues.push(expected+':SOURCE_OR_TRACE_HASH_MISSING');
  if(!finite(lane.elapsedMs)||lane.elapsedMs<=0||
     !finite(lane.cpuMs)||lane.cpuMs<0||
     !finite(lane.peakRssBytes)||lane.peakRssBytes<=0||
     lane.paidCostUsd!==0)issues.push(expected+':METRICS_INVALID_OR_PAID');
  const score=lane.score;
  if(!object(score)||score.lane!==expected||score.version!==1||score.total!==3||
     !Array.isArray(score.fixtures)||score.fixtures.length!==3){
    issues.push(expected+':SCORE_NOT_CANONICAL');return null;
  }
  const ids=score.fixtures.map(x=>x?.fixtureId);
  if(ids.some((id,i)=>id!==REQUIRED_FIXTURES[i]))issues.push(expected+':FIXTURE_ORDER_OR_ID_INVALID');
  let completed=0;
  for(const row of score.fixtures){
    if(!object(row)||typeof row.testsPass!=='boolean'||
       !Number.isSafeInteger(row.testCount)||row.testCount<1||
       typeof row.testsMutated!=='boolean'||typeof row.taskMutated!=='boolean'||
       !Array.isArray(row.unexpectedFiles)||typeof row.completed!=='boolean'){
      issues.push(expected+':RAW_SCORE_INCOMPLETE');continue;
    }
    const rawValid=validRawFixture(row,expected,issues,row.fixtureId);
    const valid=rawValid&&row.testsPass&&!row.testsMutated&&!row.taskMutated&&row.unexpectedFiles.length===0;
    if(row.completed!==valid)issues.push(expected+':COMPLETION_MISMATCH');
    if(row.testsMutated||row.taskMutated||row.unexpectedFiles.length!==0)
      issues.push(expected+':FIXTURE_TAMPERING');
    if(valid)completed++;
  }
  if(score.completed!==completed||score.completionRate!==completed/3||score.qualityPass!==true)
    issues.push(expected+':SCORE_AGGREGATE_INVALID');
  if(!Array.isArray(lane.attempts)||lane.attempts.length!==3||
     lane.attempts.some((r,i)=>r?.fixtureId!==REQUIRED_FIXTURES[i]||
       !Number.isSafeInteger(r?.count)||r.count<1||r.count>10))
    issues.push(expected+':ATTEMPTS_NOT_MEASURED');
  return {completed,elapsedMs:lane.elapsedMs,modelDigest:lane.modelDigest,manifestSha256:lane.manifestSha256};
}

/**
 * verifyTrustedReceipt MUST be provided by the privileged, isolated runner.
 * It must compare original receipt hashes with immutable PC01 execution logs,
 * OS filesystem/process/network containment evidence and the source manifest.
 * Self-asserted JSON booleans never authorize a benchmark decision.
 */
export function evaluateBenchmarkComparison({cline,nv09,verifyTrustedReceipt}={}){
  const issues=[];
  const a=inspectLane(cline,'cline-local-ollama',issues);
  const b=inspectLane(nv09,'current-coding-lane',issues);
  if(a&&b&&(a.modelDigest!==b.modelDigest||a.manifestSha256!==b.manifestSha256))
    issues.push('LANES_NOT_COMPARABLE');
  if(issues.length)return {status:'BLOCKED',decision:null,issues};
  if(a.completed===0&&b.completed===0)
    return {status:'BLOCKED',decision:null,issues:['BOTH_LANES_HAVE_ZERO_VALID_COMPLETIONS']};
  if(typeof verifyTrustedReceipt!=='function')
    return {status:'BLOCKED',decision:null,issues:['TRUSTED_OS_ISOLATION_VERIFIER_MISSING']};
  let proof;
  try{proof=verifyTrustedReceipt({cline,nv09});}catch{
    return {status:'BLOCKED',decision:null,issues:['ISOLATION_VERIFICATION_ERROR']};
  }
  const expected=['filesystem','process','network','resourceLimits','noCredentials','sourceHashes','pc01Runtime'];
  if(!object(proof)||proof.verified!==true||
     expected.some(key=>proof[key]!==true))
    return {status:'BLOCKED',decision:null,issues:['ISOLATION_OR_RECEIPT_NOT_VERIFIED']};
  // A candidate decision, not permission for production rollout.
  let decision='KEEP';
  if(a.completed<b.completed)decision='REJECT';
  else if(a.completed>b.completed||(a.completed===3&&b.completed===3&&a.elapsedMs<=b.elapsedMs*0.8))
    decision='CANARY';
  return {status:'MEASURED',decision,issues:[],clineCompleted:a.completed,
    nv09Completed:b.completed,clineElapsedMs:a.elapsedMs,nv09ElapsedMs:b.elapsedMs};
}
