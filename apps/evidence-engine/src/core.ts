import { isPassingEvidence,type EvidenceRecord } from '../../../packages/evidence/src/index.js';

export interface ReviewResult {reviewerId:string;reviewerModelId:string;authorModelId?:string;passed:boolean;findings:string[];recordedAt:string;}
export interface EvidenceBundle {version:1;subjectId:string;records:EvidenceRecord[];reviews:ReviewResult[];judge?:{decision:'pass'|'fix'|'blocked'|'authorization';reason:string;recordedAt:string};}
export interface EvidencePolicy {requiredGates:string[];minIndependentReviews:number;requireJudge:boolean;}

const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
function validId(value:string):boolean{return typeof value==='string'&&idPattern.test(value);}
function validTime(value:string):boolean{return !Number.isNaN(Date.parse(value));}

/** Keeps the existing packages/evidence EvidenceRecord as the only low-level machine evidence schema. */
export function appendEvidenceRecord(bundle:EvidenceBundle,record:EvidenceRecord):EvidenceBundle{
  if(bundle.version!==1||bundle.subjectId!==record.workOrderId)throw new Error('EVIDENCE_SUBJECT_MISMATCH');
  if(!validId(record.id)||!validTime(record.timestamp))throw new Error('INVALID_EVIDENCE_RECORD');
  const existing=bundle.records.find(row=>row.id===record.id);
  if(existing){
    if(JSON.stringify(existing)!==JSON.stringify(record))throw new Error('EVIDENCE_ID_CONFLICT');
    return bundle;
  }
  return {...bundle,records:[...bundle.records,record]};
}

export function addReview(bundle:EvidenceBundle,review:ReviewResult):EvidenceBundle{
  if(!validId(review.reviewerId)||!validId(review.reviewerModelId)||!Array.isArray(review.findings)||!validTime(review.recordedAt))throw new Error('INVALID_REVIEW');
  if(review.authorModelId&&review.authorModelId===review.reviewerModelId)throw new Error('SELF_REVIEW_FORBIDDEN');
  const exists=bundle.reviews.some(row=>row.reviewerId===review.reviewerId);
  if(exists)throw new Error('DUPLICATE_REVIEWER');
  return {...bundle,reviews:[...bundle.reviews,review]};
}

function latestGateRecord(records:EvidenceRecord[],gate:string):EvidenceRecord|undefined{
  return records.filter(record=>record.gate===gate).sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp))[0];
}

export function evaluateEvidence(bundle:EvidenceBundle,policy:EvidencePolicy):{ready:boolean;reason:string}{
  if(policy.minIndependentReviews<0||policy.minIndependentReviews>16)throw new Error('INVALID_EVIDENCE_POLICY');
  for(const gate of policy.requiredGates){
    const latest=latestGateRecord(bundle.records,gate);
    if(!latest)return {ready:false,reason:`missing_evidence:${gate}`};
    if(!isPassingEvidence(latest))return {ready:false,reason:`failed_evidence:${gate}`};
  }
  const independentPassed=bundle.reviews.filter(review=>review.passed&&(!review.authorModelId||review.authorModelId!==review.reviewerModelId)).length;
  if(independentPassed<policy.minIndependentReviews)return {ready:false,reason:'insufficient_independent_reviews'};
  if(bundle.reviews.some(review=>!review.passed))return {ready:false,reason:'review_failed'};
  if(policy.requireJudge&&!bundle.judge)return {ready:false,reason:'judge_missing'};
  if(bundle.judge&&bundle.judge.decision!=='pass')return {ready:false,reason:`judge_${bundle.judge.decision}`};
  return {ready:true,reason:'evidence_complete'};
}

export function finalDoneAllowed(bundle:EvidenceBundle,policy:EvidencePolicy):boolean{return evaluateEvidence(bundle,policy).ready;}
