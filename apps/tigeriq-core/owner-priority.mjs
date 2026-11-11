// Canonical GitHub issue priority mutation. Pure helpers; no side-effect or new control plane.
const VALUES = Object.freeze(['P0','P1','P2','P3','P4','P5']);
const field = (body,key) => String(body||'').match(new RegExp('^'+key+'=([^\\r\\n]+)$','m'))?.[1]?.trim()||'';
const invalid=(msg)=>{const e=new Error(msg);e.status=400;throw e};
export function validateOwnerPriorityInput(payload){
 const issueNumber=Number(payload?.issueNumber);
 if(!Number.isSafeInteger(issueNumber)||issueNumber<1||issueNumber>99999999)invalid('ISSUE_NUMBER_INVALID');
 const priority=String(payload?.priority||'');
 if(!VALUES.includes(priority))invalid('PRIORITY_INVALID');
 const expectedUpdatedAt=String(payload?.expectedUpdatedAt||'');
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(expectedUpdatedAt))
   invalid('EXPECTED_REVISION_INVALID');
 const expectedPriority=String(payload?.expectedPriority||'');
 if(!VALUES.includes(expectedPriority))invalid('EXPECTED_PRIORITY_INVALID');
 return {issueNumber,priority,expectedPriority,expectedUpdatedAt};
}
export function eligibleOwnerPriorityIssue(issue){
 const body=String(issue?.body||'');
 return Boolean(issue && issue.state==='open'&&!issue.pull_request&&
   /^RESOURCE_SCOPE=/m.test(body) &&
   (/^PROJECT_ID=/m.test(body)||/(?:^|\n)TIGERIQ_JOB_V1(?:\r?\n|$)/.test(body)) &&
   VALUES.includes(priorityFromIssue(issue)));
}
export function priorityFromIssue(issue){
 const b=String(issue?.body||'');
 const flat=field(b,'PRIORITY');
 if(VALUES.includes(flat))return flat;
 const legacy=b.match(/^## Priority\s*\n\s*(P[0-5])(?:\r?\n|$)/m);
 if(legacy)return legacy[1];
 const title=String(issue?.title||'');
 return title.match(/\[(P[0-5])\]/i)?.[1]?.toUpperCase()||null;
}
function putField(body,key,value){
 const rx=new RegExp('^'+key+'=[^\\r\\n]*$','gm');
 const matches=[...body.matchAll(rx)];
 if(matches.length>1)invalid('AMBIGUOUS_FIELD_'+key);
 return matches.length?body.replace(rx,key+'='+value):body.trimEnd()+'\n'+key+'='+value+'\n';
}
export function priorityMutation(issue,target){
 if(!eligibleOwnerPriorityIssue(issue))invalid('WORK_ORDER_NOT_ELIGIBLE');
 if(!VALUES.includes(target))invalid('PRIORITY_INVALID');
 const previous=priorityFromIssue(issue);
 if(previous===target)return {previous,priority:target,title:issue.title,body:issue.body,changed:false};
 let body=String(issue.body);
 body=putField(body,'PRIORITY',target);
 // Legacy ## Priority must not contradict canonical PRIORITY.
 body=body.replace(/(^## Priority\s*\n\s*)P[0-5](?=\s*(?:\n|$))/m,'$1'+target);
 body=putField(body,'PRIORITY_CHANGE_SOURCE','OWNER_DASHBOARD_GITHUB_AUTH');
 if(target==='P0'){
   body=putField(body,'OWNER_CONTROLLED','true');
   body=putField(body,'OWNER_POLICY','VY_DIRECT');
   body=putField(body,'TIGERIQ_EXECUTABLE','false');
   body=putField(body,'AUTO_QUEUE','EXCLUDED_P0_OWNER_VY_ONLY');
   body=putField(body,'P0_CONTROL','ANH_SON_AND_VY_ONLY');
   body=putField(body,'CORE_AUTO_CLAIM','FORBIDDEN_P0_OWNER_VY');
 }else if(previous==='P0'){
   // Lower priority does not silently authorize automation. Explicit delegation remains required.
   body=body.replace(/^P0_CONTROL=[^\r\n]*\r?\n?/m,'');
   body=body.replace(/^CORE_AUTO_CLAIM=[^\r\n]*\r?\n?/m,'');
   if(field(body,'AUTO_QUEUE')==='EXCLUDED_P0_OWNER_VY_ONLY')
     body=putField(body,'AUTO_QUEUE','EXCLUDED_OWNER_DIRECT_PENDING_EXPLICIT_DELEGATION');
 }
 let title=String(issue.title||'').replace(/\[P[0-5]\]/i,'['+target+']');
 if(title===issue.title)title='['+target+'] '+title;
 return {previous,priority:target,title,body,changed:true};
}
