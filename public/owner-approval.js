// Real click handlers for Vercel Owner-authenticated action screen.
// Only requests a scoped decision receipt; never claims a target permission grant.
'use strict';
const byId=(id)=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const issue=params.get('issue')||'';
let current=null;
function message(text){byId('message').textContent=text}
function setFields(card){
  for(const key of ['title','action','scope','impact','risk','cost','reversibility'])
    byId(key).textContent=String(card[key]||'');
  byId('issue').href=card.issueUrl;
}
async function getJson(url,init={}){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...init});
  const data=await response.json().catch(()=>({ok:false,error:'PHẢN HỒI KHÔNG HỢP LỆ'}));
  return {...data,httpStatus:response.status};
}
async function load(){
  if(!/^[1-9]\d{0,7}$/.test(issue)){message('Thiếu số hồ sơ hợp lệ.');return}
  const auth=await getJson('/api/owner-auth?action=status');
  if(auth.authenticated!==true){
    byId('login').hidden=false;
    message('Cần đăng nhập đúng tài khoản Owner. Sau khi đăng nhập, quay lại và tải lại trang này.');
    return;
  }
  const data=await getJson('/api/control?operation=owner-decision&issue='+encodeURIComponent(issue));
  if(!data.ok){message('Không thể xác minh yêu cầu: '+String(data.error||data.httpStatus));return}
  // Only a verified executable backend can ever advertise DUYỆT THỰC HIỆN.
  // This endpoint records a decision only; fail closed if its contract drifts.
  if(data.actionCapability!=='SCOPED_DECISION_ONLY'||data.executionAccepted!==false){
    message('Chưa xác minh được hành động thật. Không hiển thị nút duyệt.');return;
  }
  byId('approve').textContent='GỬI QUYẾT ĐỊNH DUYỆT';
  if(!data.pending){
    message('Yêu cầu này đã có quyết định được ghi nhận. Không cho gửi trùng.');
    return;
  }
  current={requestId:data.card.requestId,issueNumber:Number(issue),expectedUpdatedAt:data.updatedAt};
  setFields(data.card);
  byId('card').hidden=false;
  message('Đã xác minh yêu cầu đang chờ. Vui lòng chọn đúng một quyết định.');
}
async function choose(decision){
  if(!current)return;
  byId('approve').disabled=true;
  byId('reject').disabled=true;
  message('Đang gửi quyết định có xác thực…');
  const data=await getJson('/api/control?operation=owner-decision',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({...current,decision,operation:'owner-decision'})
  }).catch(()=>({ok:false,error:'KHÔNG KẾT NỐI ĐƯỢC'}));
  if(!data.ok||data.decisionRecorded!==true||data.actionCapability!=='SCOPED_DECISION_ONLY'||data.executionAccepted!==false){
    message('CHƯA XÁC MINH: '+String(data.error||data.httpStatus||'BIÊN NHẬN KHÔNG HỢP LỆ')+'. Tải lại hồ sơ để đối chiếu.');
    // Do not blindly retry after an ambiguous network error; request could have committed.
    return;
  }
  byId('card').hidden=true;
  byId('result').hidden=false;
  byId('outcome').textContent=decision==='APPROVE'?'ĐÃ GỬI QUYẾT ĐỊNH DUYỆT':'ĐÃ GỬI QUYẾT ĐỊNH TỪ CHỐI';
  byId('details').textContent='Đã ghi biên nhận quyết định. CHƯA giao Core, CHƯA xuất bản, CHƯA hoàn tất. Kiểm tra trạng thái công việc và cổng đích trước khi thực thi.';
  byId('receipt').href=data.evidenceUrl;
  message('Quyết định đã được ghi vào hồ sơ GitHub, không tự thực thi cổng hệ thống đích.');
}
byId('approve').addEventListener('click',()=>void choose('APPROVE'));
byId('reject').addEventListener('click',()=>void choose('REJECT'));
void load().catch(()=>message('Không kết nối được hệ thống. Chưa có quyết định nào được xác minh.'));
