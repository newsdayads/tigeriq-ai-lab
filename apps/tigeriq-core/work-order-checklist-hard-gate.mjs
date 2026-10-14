// Readback-only gate: checklist assertions are not proof of runtime acceptance.
// Caller MUST supply the fresh GitHub issue fetched after the attempted checkbox write.
const STEP=/^\s*[-*]\s+\[([ xX])\]\s+([A-Z][A-Z0-9_-]{1,15})\b\s*(.*)$/;
const MARKDOWN_LINK=/\[[^\]]+\]\((https:\/\/[^\s)]+)\)/g;
function sectionName(line){
 const m=String(line).match(/^\s{0,3}#{2,6}\s+(.+)$/);
 if(!m)return null;
 const name=m[1].trim().toUpperCase();
 return /^(?:STRUCTURED_PROGRESS_CHECKLIST|KẾ HOẠCH TUẦN TỰ VÀ TIÊU CHÍ NGHIỆM THU|DANH SÁCH BƯỚC THỰC HIỆN)$/.test(name)?'checklist':'other';
}
export function workOrderChecklistSteps(body=''){
 const lines=String(body||'').split(/\r?\n/);
 let found=false,inside=false;
 const steps=[];
 for(const line of lines){
  const heading=sectionName(line);
  if(heading!==null){if(inside)break;if(!found&&heading==='checklist'){found=true;inside=true;}continue;}
  if(!inside)continue;
  const m=line.match(STEP);
  if(!m)continue;
  steps.push({id:m[2],checked:m[1].toLowerCase()==='x',
   evidenceUrls:[...line.matchAll(MARKDOWN_LINK)].map(v=>v[1]),line});
 }
 return {found,steps};
}
// Does NOT acquire a lease, mutate GitHub, attest evidence content or authorize DONE.
export function workOrderChecklistGate(issue,{stepId='',expectedEvidenceUrl='',requireAll=true}={}){
 if(!issue||!Number.isInteger(Number(issue.number))||Number(issue.number)<1||typeof issue.body!=='string')
  return {ok:false,reason:'GITHUB_ISSUE_READBACK_REQUIRED'};
 const {found,steps}=workOrderChecklistSteps(issue.body);
 if(!found||steps.length<1)return {ok:false,reason:'CHECKLIST_MISSING',steps:steps.length};
 const ids=steps.map(x=>x.id);
 if(new Set(ids).size!==ids.length)return {ok:false,reason:'DUPLICATE_STEP_ID'};
 const requested=String(stepId||'').trim().toUpperCase();
 if(requested&&!ids.includes(requested))return {ok:false,reason:'STEP_NOT_FOUND',stepId:requested};
 const selected=requested?steps.filter(x=>x.id===requested):steps;
 if(!requested&&!requireAll)return {ok:false,reason:'STEP_ID_REQUIRED'};
 const unchecked=selected.filter(x=>!x.checked).map(x=>x.id);
 if(unchecked.length)return {ok:false,reason:'STEP_UNCHECKED_ON_GITHUB',missing:unchecked};
 const unlinked=selected.filter(x=>x.evidenceUrls.length===0).map(x=>x.id);
 if(unlinked.length)return {ok:false,reason:'CHECKED_WITHOUT_RECEIPT_LINK',missing:unlinked};
 if(expectedEvidenceUrl&&!selected.every(x=>x.evidenceUrls.includes(expectedEvidenceUrl)))
  return {ok:false,reason:'EXPECTED_RECEIPT_NOT_ON_CARD',stepId:requested};
 if(requireAll){
  const otherUnchecked=steps.filter(x=>!x.checked).map(x=>x.id);
  if(otherUnchecked.length)return {ok:false,reason:'STEP_UNCHECKED_ON_GITHUB',missing:otherUnchecked};
  const otherUnlinked=steps.filter(x=>x.evidenceUrls.length===0).map(x=>x.id);
  if(otherUnlinked.length)return {ok:false,reason:'CHECKED_WITHOUT_RECEIPT_LINK',missing:otherUnlinked};
 }
 return {ok:true,verifiedCheckboxCount:selected.length,total:steps.length,scope:requested||'ALL_STEPS',
  caution:'LINK_AND_CHECKBOX_READBACK_ONLY_NOT_INDEPENDENT_RUNTIME_EVIDENCE'};
}
