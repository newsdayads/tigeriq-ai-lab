// #4532: fail-closed comparison of independently attested, real PC01 lane receipts.
// This module does not execute agents, tests, shell, Docker or access any host.
export const REQUIRED_FIXTURES = Object.freeze([
  'strict-count-parser', 'bounded-tag-normalizer', 'shared-metric-sum-refactor',
]);
const HASH=/^[a-f0-9]{64}$/i;
const finite=(x)=>typeof x==='number'&&Number.isFinite(x);
const object=(x)=>x!=null&&typeof x==='object'&&!Array.isArray(x);

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
  if(!object(score)||score.lane!==expected||score.total!==3||
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
    const valid=row.testsPass&&!row.testsMutated&&!row.taskMutated&&row.unexpectedFiles.length===0;
    if(row.completed!==valid)issues.push(expected+':COMPLETION_MISMATCH');
    if(row.testsMutated||row.taskMutated||row.unexpectedFiles.length!==0)
      issues.push(expected+':FIXTURE_TAMPERING');
    if(valid)completed++;
  }
  if(score.completed!==completed||score.qualityPass!==true)
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
