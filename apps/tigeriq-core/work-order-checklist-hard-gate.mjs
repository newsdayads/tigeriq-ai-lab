// Readback-only gate: checklist assertions are not proof of runtime acceptance.
// Caller MUST supply the fresh GitHub issue fetched after the attempted checkbox write.
const STEP=/^ {0,3}[-*]\s+\[([ xX])\]\s+\*{0,2}([A-Z][A-Za-z0-9_-]{1,15})\*{0,2}\b\s*(.*)$/;
const MARKDOWN_LINK=/\[[^\]]+\]\((https:\/\/[^\s)]+)\)/g;

function markdownEscaped(text,index){
 let n=0;
 for(let i=index-1;i>=0&&text[i]==='\\';i--)n++;
 return n%2===1;
}
// Evidence links must be visible Markdown hyperlinks, not inline code,
// literal escaped link syntax, image embeds, or raw HTML code samples.
function receiptLinksFromLine(line){
 const input=String(line||'').replace(/<code\b[^>]*>[\s\S]*?<\/code\s*>/gi,'');
 let visible='';
 for(let i=0;i<input.length;){
  if(input[i]!=='\x60'||markdownEscaped(input,i)){visible+=input[i++];continue;}
  let endOpen=i;
  while(input[endOpen]==='\x60')endOpen++;
  const width=endOpen-i;
  let k=endOpen,close=-1,closeEnd=-1;
  while(k<input.length){
   const at=input.indexOf('\x60',k);
   if(at<0)break;
   let end=at;
   while(input[end]==='\x60')end++;
   if(end-at===width&&!markdownEscaped(input,at)){close=at;closeEnd=end;break;}
   k=end;
  }
  if(close<0){visible+=input.slice(i,endOpen);i=endOpen;}
  else{visible+=' '.repeat(closeEnd-i);i=closeEnd;}
 }
 // A Markdown-looking link within raw inline HTML is not reliable visible
 // evidence. Reject the whole row on ambiguous inline HTML; the canonical
 // checklist can be rewritten as plain Markdown with an explicit receipt.
 // Inline <code>...</code> samples were already removed above.
 if(/<\/?[A-Za-z][A-Za-z0-9:-]*(?=[\s/>])[^>]*>/.test(visible))return [];
 const found=[];
 for(const match of visible.matchAll(MARKDOWN_LINK)){
  if(markdownEscaped(visible,match.index))continue;
  const image=match.index>0&&visible[match.index-1]==='!'&&!markdownEscaped(visible,match.index-1);
  if(!image)found.push(match[1]);
 }
 return found;
}

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
 // Protect every standalone opening HTML element, not a selective tag list.
 // Fail closed even for uncommon CommonMark/raw/custom tags such as iframe.
 const HTML_BLOCK_OPEN=/^ {0,3}<([a-z][a-z0-9:-]*)(?=[\s/>])[^>]*>/i;
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
   const tagName=htmlOpener[1].toLowerCase();
   // Void elements do not hide subsequent canonical checklist rows.
   if(new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']).has(tagName))continue;
   rawHtmlTag=tagName;
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
   evidenceUrls:receiptLinksFromLine(line),line});
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
 // V2 cards whose progress is defined by this canonical checklist must not
 // accept a checked step while the owner's verified counter is inconsistent.
 // A partial step is NOT an exception: count drift can hide an unaccepted step.
 // Older cards without STRUCTURED_PROGRESS_CHECKLIST as progress source retain
 // the existing checkbox-and-receipt readback contract.
 const progressSource=issue.body.match(/^PROGRESS_SOURCE=([^\r\n]*)$/m)?.[1]?.trim();
 if(progressSource==='STRUCTURED_PROGRESS_CHECKLIST'){
  const rawCompleted=issue.body.match(/^PROGRESS_COMPLETED=([^\r\n]*)$/m)?.[1]?.trim();
  const rawTotal=issue.body.match(/^PROGRESS_TOTAL=([^\r\n]*)$/m)?.[1]?.trim();
  if(!/^\d+$/.test(rawCompleted||'')||!/^\d+$/.test(rawTotal||''))
   return {ok:false,reason:'CHECKLIST_PROGRESS_COUNTER_MISSING'};
  const completed=Number(rawCompleted),total=Number(rawTotal);
  const checked=steps.filter(x=>x.checked).length;
  if(!Number.isSafeInteger(completed)||!Number.isSafeInteger(total)||
     completed!==checked||total!==steps.length)
   return {ok:false,reason:'CHECKLIST_PROGRESS_COUNTER_MISMATCH',
    statedCompleted:completed,checked,total,steps:steps.length};
 }
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
