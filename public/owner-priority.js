(()=>{
'use strict';
const $=id=>document.getElementById(id),q=new URLSearchParams(location.search);
const issue=Number(q.get('issue'));let snapshot=null;
function msg(s){$('status').textContent=s}
const request=async (url,options={})=>{
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
 const result=await response.json().catch(()=>({error:'RESPONSE_INVALID'}));
 if(!response.ok){const error=new Error(result.error||'HTTP_'+response.status);error.status=response.status;throw error}
 return result;
};
async function load(){
 if(!Number.isSafeInteger(issue)||issue<1||issue>99999999){msg('S? h? s? kh?ng h?p l?.');return}
 try{
  snapshot=await request('/api/control?operation=owner-priority&issue='+issue);
  $('issueTitle').textContent='#'+issue+' ? '+snapshot.title;
  const suggested=q.get('priority');
  $('priority').value=/^P[0-5]$/.test(suggested||'')?suggested:snapshot.priority;
  $('github').href=snapshot.githubUrl;
  $('controls').hidden=false;
  msg('?? x?c th?c Owner. ?u ti?n tr?n GitHub hi?n t?i: '+snapshot.priority);
 }catch(e){
  if(e.status===401){$('login').hidden=false;msg('C?n ??ng nh?p Owner ?? thay ??i m?c ?u ti?n.')}
  else msg('Kh?ng t?i ???c h? s?: '+e.message);
 }
}
$('save').addEventListener('click',async ()=>{
 if(!snapshot)return;
 const target=$('priority').value;
 if(!/^P[0-5]$/.test(target))return;
 if(target===snapshot.priority){msg('Kh?ng ??i: h? s? ?ang l? '+target);return}
 $('save').disabled=true;
 msg('?ang ghi v? x?c minh tr?n GitHub?');
 try{
  const r=await request('/api/control',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({operation:'owner-priority',issueNumber:issue,priority:target,
    expectedPriority:snapshot.priority,expectedUpdatedAt:snapshot.updatedAt})});
  if(r.verified!==true)throw Error('READBACK_UNVERIFIED');
  snapshot={...snapshot,priority:r.priority,updatedAt:r.updatedAt,title:r.title};
  $('issueTitle').textContent='#'+issue+' ? '+r.title;
  msg('?? L?U & X?C MINH: '+r.previous+' ? '+r.priority+' tr?n GitHub. T?i l?i Dashboard ?? c?p nh?t.');
 }catch(e){
  if(e.message==='ISSUE_CHANGED_REFRESH_REQUIRED')msg('H? s? v?a thay ??i. T?i l?i trang tr??c khi ghi.');
  else if(e.status===401){$('login').hidden=false;msg('Phi?n Owner h?t h?n. Vui l?ng ??ng nh?p l?i.')}
  else msg('CH?A L?U: '+e.message);
 }finally{$('save').disabled=false}
});
load();
})();
