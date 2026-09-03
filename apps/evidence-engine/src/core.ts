export type EvidenceKind='test'|'artifact'|'commit'|'runtime'|'review'|'judge';
export interface EvidenceItem {evidenceId:string;kind:EvidenceKind;subjectId:string;passed:boolean;source:string;recordedAt:string;summary:string;}
export interface ReviewResult {reviewerId:string;reviewerModelId:string;authorModelId?:string;passed:boolean;findings:string[];}
export interface EvidenceBundle {version:1;subjectId:string;items:EvidenceItem[];reviews:ReviewResult[];judge?:{decision:'pass'|'fix'|'blocked'|'authorization';reason:string};}
export interface EvidencePolicy {requiredKinds:EvidenceKind[];minIndependentReviews:number;requireJudge:boolean;}

const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
function validId(value:string):boolean{return typeof value==='string'&&idPattern.test(value);}

export function validateEvidence(item:EvidenceItem):void{
  if(!validId(item.evidenceId)||!validId(item.subjectId)||!item.source.trim()||!item.summary.trim()||Number.isNaN(Date.parse(item.recordedAt)))throw new Error('INVALID_EVIDENCE_ITEM');
}

export function appendEvidence(bundle:EvidenceBundle,item:EvidenceItem):EvidenceBundle{
  validateEvidence(item);
  if(bundle.version!==1||bundle.subjectId!==item.subjectId)throw new Error('EVIDENCE_SUBJECT_MISMATCH');
  const existing=bundle.items.find(row=>row.evidenceId===item.evidenceId);
  if(existing){
    if(JSON.stringify(existing)!==JSON.stringify(item))throw new Error('EVIDENCE_ID_CONFLICT');
    return bundle;
  }
  return {...bundle,items:[...bundle.items,item]};
}

export function addReview(bundle:EvidenceBundle,review:ReviewResult):EvidenceBundle{
  if(!validId(review.reviewerId)||!validId(review.reviewerModelId)||!Array.isArray(review.findings))throw new Error('INVALID_REVIEW');
  if(review.authorModelId&&review.authorModelId===review.reviewerModelId)throw new Error('SELF_REVIEW_FORBIDDEN');
  const exists=bundle.reviews.some(row=>row.reviewerId===review.reviewerId);
  if(exists)throw new Error('DUPLICATE_REVIEWER');
  return {...bundle,reviews:[...bundle.reviews,review]};
}

export function evaluateEvidence(bundle:EvidenceBundle,policy:EvidencePolicy):{ready:boolean;reason:string}{
  if(policy.minIndependentReviews<0||policy.minIndependentReviews>16)throw new Error('INVALID_EVIDENCE_POLICY');
  for(const kind of policy.requiredKinds){
    const items=bundle.items.filter(item=>item.kind===kind);
    if(items.length===0)return {ready:false,reason:`missing_evidence:${kind}`};
    if(items.some(item=>!item.passed))return {ready:false,reason:`failed_evidence:${kind}`};
  }
  const independentPassed=bundle.reviews.filter(review=>review.passed&&(!review.authorModelId||review.authorModelId!==review.reviewerModelId)).length;
  if(independentPassed<policy.minIndependentReviews)return {ready:false,reason:'insufficient_independent_reviews'};
  if(bundle.reviews.some(review=>!review.passed))return {ready:false,reason:'review_failed'};
  if(policy.requireJudge&&!bundle.judge)return {ready:false,reason:'judge_missing'};
  if(bundle.judge&&bundle.judge.decision!=='pass')return {ready:false,reason:`judge_${bundle.judge.decision}`};
  return {ready:true,reason:'evidence_complete'};
}

export function finalDoneAllowed(bundle:EvidenceBundle,policy:EvidencePolicy):boolean{return evaluateEvidence(bundle,policy).ready;}
