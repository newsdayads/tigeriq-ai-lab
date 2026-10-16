// Readback-only gate: checklist assertions are not proof of runtime acceptance.
// Caller MUST supply the fresh GitHub issue fetched after the attempted checkbox write.
const STEP=/^ {0,3}[-*]\s+\[([ xX])\]\s+\*{0,2}([A-Z][A-Za-z0-9_-]{1,15})\*{0,2}\b\s*(.*)$/;
const MARKDOWN_LINK=/\[[^\]]+\]\((https:\/\/[^\s)]+)\)/g;
function sectionName(line){
 const m=String(line).match(/^\s{0,3}#{2,6}\s+(.+)$/);
 if(!m)return null;
 const name=m[1].trim().toUpperCase();
 return /^(?:STRUCTURED_PROGRESS_CHECKLIST|KẾ HOẠCH TUẦN TỰ VÀ TIÊU CHÍ NGHIỆM THU|DANH SÁCH BƯỚC THỰC HIỆN|THEO DÕI TIẾN ĐỘ)\b/i.test(name)?'checklist':'other';
}
export function workOrderChecklistSteps(body=''){
 const lines=String(body||'').split(/\r?\n/);
 let found=false,inside=false;
 const steps=[];
 // Read only canonical root checklist entries, never checkbox illustrations in
 // fenced/indented Markdown code. Match CommonMark's 0-3-space fence boundary;
 // a longer opening fence cannot be closed by a shorter marker.
 let fence=null,htmlComment=false,rawHtmlTag=null,rawHtmlDepth=0;
 // HTML blocks contain literal content, not authorized Markdown checklist
 // receipts. Track nested same-tag elements so an inner close cannot release
 // a forged checked stage before the outer HTML block closes.
 const HTML_BLOCK_OPEN=/^ {0,3}<(pre|script|style|textarea|code|details|div|section|article|aside|template|table|blockquote|ul|ol|main|nav|header|footer|form)(?=[\s/>])[^>]*>/i;
 const htmlTagMatches=(line,tag)=>{
  const pattern=new RegExp('<(/?)'+tag+'(?=[\\s/>])[^>]*>','gi');
  return [...line.matchAll(pattern)].map(match=>({
   closing:match[1]==='/',selfClosing:/\/\s*>$/.test(match[0])
  }));
 };
 for(const rawLine of lines){
  // Markdown fenced code is literal: its comment markers are not HTML syntax.
  if(fence){
   const closing=rawLine.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
   if(closing&&closing[1][0]===fence.char&&closing[1].length>=fence.length&&
      closing[2].trim()==='')fence=null;
   continue;
  }
  // Strip HTML comments, including multiline blocks, before considering a
  // heading or checked receipt. Never count hidden examples as acceptance.
  let line='',rest=rawLine;
  while(rest.length){
   if(htmlComment){
    const end=rest.indexOf('-->');
    if(end<0)break;
    rest=rest.slice(end+3);htmlComment=false;
   }else{
    const begin=rest.indexOf('<!--');
    if(begin<0){line+=rest;break;}
    line+=rest.slice(0,begin);
    rest=rest.slice(begin+4);htmlComment=true;
   }
  }
  if(rawHtmlTag){
   for(const tag of htmlTagMatches(line,rawHtmlTag)){
    if(tag.closing)rawHtmlDepth--;
    else if(!tag.selfClosing)rawHtmlDepth++;
   }
   if(rawHtmlDepth<=0){rawHtmlTag=null;rawHtmlDepth=0;}
   continue;
  }
  const htmlOpener=line.match(HTML_BLOCK_OPEN);
  if(htmlOpener){
   rawHtmlTag=htmlOpener[1].toLowerCase();
   rawHtmlDepth=0;
   for(const tag of htmlTagMatches(line,rawHtmlTag)){
    if(tag.closing)rawHtmlDepth--;
    else if(!tag.selfClosing)rawHtmlDepth++;
   }
   if(rawHtmlDepth<=0){rawHtmlTag=null;rawHtmlDepth=0;}
   continue;
  }
  const marker=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if(marker){fence={char:marker[1][0],length:marker[1].length};continue;}
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
 const ids=steps.map(x=>x.id.toUpperCase());
 if(new Set(ids).size!==ids.length)return {ok:false,reason:'DUPLICATE_STEP_ID'};
 const requested=String(stepId||'').trim().toUpperCase();
 if(requested&&!ids.includes(requested))return {ok:false,reason:'STEP_NOT_FOUND',stepId:requested};
 const selected=requested?steps.filter(x=>x.id.toUpperCase()===requested):steps;
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
