// Read-only NV03 QA discovery. A review request is NOT a GitHub approval,
// accepted milestone, atomic claim, or permission to review one's own work.
// App Chrome never imports this module or dispatches on its behalf.
const PRIORITY={P1:1,P2:2,P3:3,P4:4,P5:5};
const SHA=/^[a-f0-9]{40}$/i;
const REVIEW_VALUE=new Set(['NOT_ACCEPTED','PENDING','REVIEW_REQUIRED','NOT_RECEIVED']);
const RECEIPT_MARKER='[TIGERIQ_NV03_MILESTONE_QA_V1]';

export function currentQaFields(body=''){
  const fields=new Map();
  let firstHeading=false;
  for(const line of String(body).split(/\r?\n/)){
    if(/^\s*#{1,6}\s+/.test(line)){
      if(firstHeading)break;
      firstHeading=true;
      continue;
    }
    if(/^\s*(?:---|\*\*\*|___)\s*$/.test(line))break;
    const m=line.match(/^([A-Z][A-Z0-9_]+)=([^\r\n]*)$/);
    if(m&&!fields.has(m[1]))fields.set(m[1],m[2].trim());
  }
  return fields;
}

function reviewPriority(issue,fields){
  const named=String(fields.get('PRIORITY')||'').trim().toUpperCase();
  const labels=(issue.labels||[]).map(x=>String(typeof x==='string'?x:x?.name||'').toUpperCase());
  const rank=Object.hasOwn(PRIORITY,named)?named:labels.find(x=>Object.hasOwn(PRIORITY,x));
  return rank||null;
}

function sourceUrl(issue,pr){
  const u=String(issue.html_url||issue.url||'');
  const m=u.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/\d+$/);
  if(!m||!Number.isInteger(pr)||pr<1)return null;
  return 'https://github.com/'+m[1]+'/'+m[2]+'/pull/'+pr;
}

// A receipt is only used to avoid presenting the identical SHA to NV03
// repeatedly. It does not confirm eligibility or advance Issue checklists.
export function nv03MilestoneQaReceiptMatches(comment,task){
  const body=String(comment?.body||'');
  if(!body.includes(RECEIPT_MARKER))return false;
  if(!comment?.user?.login&&!comment?.author?.login)return false;
  const f=currentQaFields(body);
  return f.get('WORKER')==='NV03'
    &&f.get('SOURCE_ISSUE')===String(task.issueNumber)
    &&f.get('MILESTONE')===task.milestone
    &&f.get('EXACT_SOURCE_SHA')===task.sourceSha
    &&['PRELIMINARY','CHANGES_REQUIRED','BLOCKED','REVIEWED'].includes(f.get('QA_RESULT'));
}

export function discoverNv03MilestoneQa(issues=[],{receiptsByIssue=new Map(),limit=25}={}){
  const rows=[];
  for(const issue of (Array.isArray(issues)?issues:[])){
    if(!issue||issue.state!=='open'||issue.pull_request)continue;
    const f=currentQaFields(issue.body||'');
    const priority=reviewPriority(issue,f);
    if(!priority||f.get('DONE')==='true'||f.get('OWNER_HOLD')==='true'||f.get('OWNER_CONTROLLED')==='true')continue;
    const currentState=String(f.get('CURRENT_STATE')||'').toUpperCase();
    if(/^(?:CLOSED|DONE|COMPLETED|CANCELLED|SUPERSEDED)(?:_|$)/.test(currentState))continue;
    const sourceSha=String(f.get('SOURCE_MERGE_SHA')||f.get('SOURCE_PR_HEAD')||'').toLowerCase();
    const pr=Number(f.get('SOURCE_PR'));
    const issueNumber=Number(issue.number);
    if(!Number.isInteger(issueNumber)||issueNumber<1)continue;
    for(const [key,value] of f){
      const m=key.match(/^([A-Z]\d{2})_INDEPENDENT_REVIEW$/);
      if(!m||!REVIEW_VALUE.has(value.toUpperCase()))continue;
      const milestone=m[1];
      const exactTarget=SHA.test(sourceSha);
      const task={
        kind:'MILESTONE_REVIEW',
        employeeId:'NV03',
        issueNumber,
        milestone,
        priority,
        title:String(issue.title||'').slice(0,180),
        issueUrl:String(issue.html_url||'').slice(0,250),
        sourcePr:Number.isInteger(pr)&&pr>0?pr:null,
        sourcePrUrl:sourceUrl(issue,pr),
        sourcePrClaim:String(f.get('SOURCE_PR_STATUS')||'UNVERIFIED').toUpperCase(),
        sourceSha:exactTarget?sourceSha:null,
        resourceScope:String(f.get('RESOURCE_SCOPE')||'').slice(0,150),
        canonicalReviewState:value,
        // A ChatGPT role review under the PR author's own GitHub login is
        // not independent non-author GitHub approval.
        canAcceptMilestone:false,
        requiresIndependentNonAuthorReviewer:true,
        claimState:'NOT_CLAIMED',
        proofStatus:exactTarget?'REVIEW_REQUEST_DISCOVERED':'MISSING_EXACT_SOURCE_SHA',
        dedupKey:exactTarget?'NV03_QA|'+issueNumber+'|'+milestone+'|'+sourceSha:null,
      };
      const receipts=receiptsByIssue instanceof Map?receiptsByIssue.get(issueNumber):null;
      const previouslyReviewed=(Array.isArray(receipts)?receipts:[]).some(x=>nv03MilestoneQaReceiptMatches(x,task));
      if(previouslyReviewed){task.proofStatus='REVIEW_EVIDENCE_ALREADY_RECORDED';task.claimState='WAIT_INDEPENDENT_ACCEPTANCE';}
      rows.push(task);
    }
  }
  rows.sort((a,b)=>PRIORITY[a.priority]-PRIORITY[b.priority]||a.issueNumber-b.issueNumber||a.milestone.localeCompare(b.milestone));
  const safeLimit=Number.isInteger(limit)?Math.max(0,Math.min(limit,50)):25;
  return rows.slice(0,safeLimit);
}

export const NV03_MILESTONE_QA_MARKER=RECEIPT_MARKER;
