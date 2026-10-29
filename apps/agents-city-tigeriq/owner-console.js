// Actual Owner action console. No simulated employee dispatch or DONE claims.
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const status=$('ownerStatus'),form=$('ownerForm'),submit=$('ownerSubmit');
  const recent=$('recentGoals');
  let token=null,pending=false;
  const node=(tag,text,cls)=>{
    const e=document.createElement(tag);
    if(text!==undefined)e.textContent=String(text);
    if(cls)e.className=cls;
    return e;
  };
  function inform(text,error=false){
    status.textContent=text;
    status.classList.toggle('error',error);
  }
  function renderRecent(data){
    recent.replaceChildren();
    const items=data?.objectives||[];
    if(!items.length){
      recent.append(node('p','Chưa có mục tiêu Animal City trong dữ liệu Core mới nhất.','empty'));
      return;
    }
    for(const item of items){
      const el=node('article',undefined,'recent-item');
      el.append(node('strong',item.objective));
      const jobs=item.jobs||[];
      const summary=item.id+' · Trạng thái Core: '+item.state+' · '+jobs.length+' job trong cửa sổ dữ liệu';
      el.append(node('div',summary,'meta'));
      for(const job of jobs.slice(0,4)){
        el.append(node('div','Job '+job.id+': '+job.status+' · '+(job.employeeId||'chưa gán nhân viên'),'meta'));
      }
      if(item.summary)el.append(node('div',item.summary,'meta'));
      recent.append(el);
    }
  }
  async function loadRecent(){
    try{
      const r=await fetch('/api/owner-objectives',{cache:'no-store',credentials:'same-origin'});
      const data=await r.json();
      if(!r.ok||!data.ok)throw Error(data.reason||'CORE_UNVERIFIED');
      renderRecent(data);
    }catch{
      recent.replaceChildren(node('p','Chưa đọc được trạng thái mục tiêu từ Core; không hiển thị kết quả giả.','empty'));
    }
  }
  async function initialize(){
    try{
      const response=await fetch('/api/owner-config',{cache:'no-store',credentials:'same-origin'});
      const data=await response.json();
      if(!response.ok||data.ok!==true||data.mode!=='LOCAL_ONLY_P2'||data.writeAllowed!==true||!data.token)
        throw Error('DISPATCH_NOT_ALLOWED');
      token=data.token;
      submit.disabled=false;
      inform('Sẵn sàng nhận mục tiêu LOCAL · Bấm GIAO rồi xác nhận để Core nhận việc.');
    }catch{
      token=null;submit.disabled=true;
      inform('CHƯA THỂ GIAO VIỆC — chưa xác minh quyền hoặc kết nối Core.',true);
    }
    await loadRecent();
  }
  submit.disabled=true;
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(pending||!token)return;
    const objective=$('ownerObjective').value.trim();
    if(objective.length<12||objective.length>2000){
      inform('Mục tiêu phải dài từ 12 đến 2000 ký tự.',true);return;
    }
    const approved=window.confirm(
      'Giao mục tiêu này cho TigerIQ Core?\nChỉ dùng AI LOCAL, ưu tiên P2.\nĐây là hành động TẠO MỤC TIÊU THẬT; không xác nhận đã hoàn thành.');
    if(!approved)return;
    pending=true;submit.disabled=true;
    inform('Đang gửi yêu cầu tạo mục tiêu đến Core…');
    const key=crypto.randomUUID();
    try{
      const r=await fetch('/api/owner-objectives',{
        method:'POST',credentials:'same-origin',redirect:'error',
        headers:{'content-type':'application/json','x-tigeriq-action':token,'x-request-id':key},
        body:JSON.stringify({objective,priority:'P2',routingProfile:'LOCAL'}),
      });
      const data=await r.json();
      if(!r.ok||data.ok!==true||data.receiptVerified!==true)
        throw Error(data.reason||'CORE_REJECTED');
      inform('CORE ĐÃ NHẬN: '+data.objectiveId+' · LOCAL P2. Đây là biên nhận tiếp nhận, không phải DONE.');
      $('ownerObjective').value='';
      await loadRecent();
      window.dispatchEvent(new Event('tigeriq:refresh'));
    }catch(error){
      inform('GIAO VIỆC THẤT BẠI / CHƯA XÁC MINH — '+String(error.message||error).slice(0,95)+
        '. Kiểm tra Core trước khi gửi lại để tránh tạo việc trùng.',true);
    }finally{pending=false;submit.disabled=false;}
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')loadRecent();
  });
  setInterval(()=>{if(document.visibilityState==='visible')loadRecent()},20000);
  initialize();
})();