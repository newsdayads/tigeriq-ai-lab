const $=id=>document.getElementById(id);
const current={devices:[],selected:new Set(),sizes:new Map(),cards:new Map(),screenBusy:0,screenCursor:0,group:'all',groups:{},macroId:null,refreshMs:4000};
function loadGroups(){try{const v=JSON.parse(localStorage.getItem('tigeriqGroups')||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}catch{return {}}}
current.groups=loadGroups();
const toast=(message,isError=false)=>{
  $('notice').textContent=message;
  $('notice').className='notice visible'+(isError?' error':'');
  $('bottomMessage').textContent=message;
};
async function api(url,payload){
  const response=await fetch(url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||('HTTP '+response.status));
  return data;
}
const online=()=>current.devices.filter(d=>d.state==='device');
const active=()=>online().filter(d=>current.selected.has(d.serial)).map(d=>d.serial);
const serialText=d=>d.label||d.model||d.serial;
const matchGroup=d=>current.group==='all'||(current.groups[current.group]||[]).includes(d.serial);
function setTab(name){
  for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('active',b.dataset.tab===name);
  for(const p of document.querySelectorAll('[data-panel]'))p.classList.toggle('active',p.dataset.panel===name);
}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
function selectedDisplay(){
  $('chosenCount').textContent=current.selected.size+' selected';
  $('selectionText').textContent=current.selected.size+' device(s) selected';
  for(const [s,c] of current.cards){
    c.classList.toggle('selected',current.selected.has(s));
    const input=c.querySelector('input[type=checkbox]');
    if(input)input.checked=current.selected.has(s);
  }
}
function changeSelect(serial,flag){
  if(flag)current.selected.add(serial);else current.selected.delete(serial);
  selectedDisplay();renderNumbers();
}
function renderNumbers(){
  const host=$('deviceNumberGrid');host.textContent='';
  current.devices.filter(matchGroup).forEach((d,i)=>{
    const b=document.createElement('button');
    b.className='number'+(current.selected.has(d.serial)?' chosen':'');
    b.textContent=String(i+1).padStart(2,'0');
    b.title=serialText(d)+' / '+d.serial;b.onclick=()=>changeSelect(d.serial,!current.selected.has(d.serial));
    host.append(b);
  });
}
function renderGroups(){
  const container=$('groupList');container.textContent='';
  for(const [name,serials] of [['all',current.devices.map(x=>x.serial)],...Object.entries(current.groups)]){
    const line=document.createElement('div');line.className='group-item';
    const b=document.createElement('button');b.textContent=(name==='all'?'All devices':name)+' ('+serials.length+')';
    b.style.fontWeight=current.group===name?'750':'450';
    b.onclick=()=>{current.group=name;renderGroups();renderDevices()};
    line.append(b);
    if(name!=='all'){
      const add=document.createElement('button');add.textContent='Set';add.title='Gán thiết bị đã chọn vào nhóm này';
      add.onclick=()=>{current.groups[name]=[...current.selected];localStorage.setItem('tigeriqGroups',JSON.stringify(current.groups));renderGroups();renderDevices();toast('Đã cập nhật nhóm '+name)};
      line.append(add);
      const del=document.createElement('button');del.textContent='×';del.title='Xóa nhóm';
      del.onclick=()=>{if(!confirm('Xóa nhóm '+name+'?'))return;delete current.groups[name];if(current.group===name)current.group='all';localStorage.setItem('tigeriqGroups',JSON.stringify(current.groups));renderGroups();renderDevices()};
      line.append(del);
    }
    container.append(line);
  }
}
$('groupAdd').onclick=()=>{
  const value=prompt('Tên nhóm mới (tối đa 35 ký tự)','Phone Farm 01');
  if(value===null)return;const name=value.trim();
  if(!name||name.length>35||name==='all'||Object.hasOwn(current.groups,name)){toast('Tên nhóm không hợp lệ hoặc bị trùng',true);return}
  current.groups[name]=[...current.selected];
  localStorage.setItem('tigeriqGroups',JSON.stringify(current.groups));
  current.group=name;renderGroups();renderDevices();
};
$('groupAll').onclick=()=>{current.group='all';renderGroups();renderDevices()};
$('selectAll').onclick=()=>{current.devices.filter(matchGroup).filter(d=>d.state==='device').forEach(d=>current.selected.add(d.serial));selectedDisplay();renderNumbers()};
$('selectNone').onclick=()=>{current.selected.clear();selectedDisplay();renderNumbers()};
$('invertSelection').onclick=()=>{current.devices.filter(matchGroup).forEach(d=>{if(current.selected.has(d.serial))current.selected.delete(d.serial);else if(d.state==='device')current.selected.add(d.serial)});selectedDisplay();renderNumbers()};
function cardActions(card,d){
  const buttons=card.querySelector('.phone-footer');
  const make=(symbol,title,fn)=>{
    const b=document.createElement('button');b.textContent=symbol;b.title=title;b.onclick=fn;buttons.append(b);
  };
  make('□','Mở cửa sổ điều khiển riêng',()=>openMirror(d.serial));
  make('⌂','Trang chủ',()=>sendInput([d.serial],{action:'key',key:'HOME'}));
  make('↶','Quay lại',()=>sendInput([d.serial],{action:'key',key:'BACK'}));
  make('✎','Đổi tên',async()=>{const label=prompt('Đặt tên thiết bị',d.label||d.model||'');if(label===null)return;try{await api('/api/label',{serial:d.serial,label});d.label=label;renderDevices()}catch(e){toast(e.message,true)}});
  const s=document.createElement('span');s.className='devstat';s.textContent=d.state==='device'?'●':'○';buttons.append(s);
}
function renderDevices(){
  const host=$('grid');host.textContent='';current.cards.clear();
  const query=$('search').value.trim().toLowerCase();
  const list=current.devices.filter(matchGroup).filter(d=>(d.serial+' '+d.model+' '+d.label).toLowerCase().includes(query));
  if(!list.length){
    const e=document.createElement('div');e.className='placeholder';
    const h=document.createElement('h2');h.textContent=current.devices.length?'Không tìm thấy thiết bị':'Chưa có thiết bị Android';
    const sub=document.createElement('span');sub.textContent='Kết nối USB, bật USB Debugging và nhấn Refresh USB.';
    e.append(h,sub);host.append(e);
  }
  list.forEach((d,i)=>{
    const card=document.createElement('article');card.className='phone'+(current.selected.has(d.serial)?' selected':'')+(d.state!=='device'?' offline':'');
    const top=document.createElement('div');top.className='phone-header';
    const label=document.createElement('label');const check=document.createElement('input');check.type='checkbox';check.checked=current.selected.has(d.serial);
    check.onchange=()=>changeSelect(d.serial,check.checked);
    const no=document.createElement('span');no.className='phone-num';no.textContent=String(i+1).padStart(2,'0');
    const name=document.createElement('span');name.textContent=serialText(d);
    label.append(check,no,name);top.append(label);
    const screen=document.createElement('div');screen.className='screen';
    if(d.state==='device'){
      const img=document.createElement('img');img.alt='Android '+d.serial;img.draggable=false;
      img.dataset.serial=d.serial;
      img.onload=()=>{img.dataset.busy='';img.dataset.retryAt='0';current.sizes.set(d.serial,{width:img.naturalWidth,height:img.naturalHeight})};
      img.onerror=()=>{img.dataset.busy='';img.dataset.retryAt=String(Date.now()+6000);img.alt='Chưa tải được màn hình';img.title='Ảnh lỗi, sẽ tự thử lại'};
      img.onpointerdown=e=>{img.dataset.startX=String(e.clientX);img.dataset.startY=String(e.clientY);try{img.setPointerCapture(e.pointerId)}catch{}};
      img.onpointerup=e=>{if(!img.dataset.startX)return;performPointer(img,e).catch(err=>toast(err.message,true))};
      screen.append(img);
    }else{const empty=document.createElement('div');empty.className='empty-screen';empty.textContent='Device '+d.state;screen.append(empty)}
    const footer=document.createElement('div');footer.className='phone-footer';
    card.append(top,screen,footer);cardActions(card,d);
    current.cards.set(d.serial,card);host.append(card);
  });
  renderNumbers();selectedDisplay();
  refreshScreens();
}
async function performPointer(img,e){
  const serial=img.dataset.serial;
  const rect=img.getBoundingClientRect();
  const size=current.sizes.get(serial)||{width:img.naturalWidth,height:img.naturalHeight};
  if(!rect.width||!rect.height||!size.width||!size.height)throw Error('Chưa đọc được độ phân giải');
  const clamp=(v)=>Math.max(0,Math.min(1,v));
  // The image is object-fit:contain; exclude black letterboxing from tap/swipe coordinates.
  const scale=Math.min(rect.width/size.width,rect.height/size.height);
  const displayedWidth=size.width*scale,displayedHeight=size.height*scale;
  const left=rect.left+(rect.width-displayedWidth)/2;
  const top=rect.top+(rect.height-displayedHeight)/2;
  const norm=(x,y)=>[clamp((x-left)/displayedWidth),clamp((y-top)/displayedHeight)];
  const a=norm(Number(img.dataset.startX),Number(img.dataset.startY)),b=norm(e.clientX,e.clientY);
  delete img.dataset.startX;delete img.dataset.startY;
  const isSwipe=Math.hypot((a[0]-b[0])*size.width,(a[1]-b[1])*size.height)>18;
  const serials=$('sync').checked?active():[serial];
  if(!serials.length)throw Error('Chọn các thiết bị để đồng bộ chuột');
  const outputs=await Promise.all(serials.map(async s=>{
    const sz=s===serial?size:await api('/api/size?serial='+encodeURIComponent(s));
    const action={action:isSwipe?'swipe':'tap',x:Math.round(a[0]*sz.width),y:Math.round(a[1]*sz.height)};
    if(isSwipe)Object.assign(action,{toX:Math.round(b[0]*sz.width),toY:Math.round(b[1]*sz.height),ms:350});
    return api('/api/input',{serials:[s],...action});
  }));
  const failed=outputs.flatMap(x=>x.results).filter(x=>!x.ok);
  toast(failed.length?'Thao tác lỗi '+failed[0].error:'Đã gửi lệnh '+(isSwipe?'vuốt':'chạm')+' tới '+serials.length+' máy; chờ kiểm tra màn hình',failed.length>0);
  refreshOne(img);
}
function refreshOne(img){
  if(img.dataset.busy||!img.isConnected||Number(img.dataset.retryAt||0)>Date.now())return;
  img.dataset.busy='1';
  img.src='/api/screen?serial='+encodeURIComponent(img.dataset.serial)+'&ts='+Date.now();
}
function refreshScreens(){
  if(document.hidden||!$('autoRefresh').checked)return;
  const images=Array.from($('grid').querySelectorAll('.screen img'));
  const busy=images.filter(img=>img.dataset.busy==='1').length;
  const capacity=Math.max(0,2-busy); // Backend permits three concurrent screenshots; leave one slot for manual actions.
  if(!capacity)return;
  const visible=images.filter(img=>{
    const r=img.getBoundingClientRect();
    return r.bottom>=30&&r.top<=window.innerHeight&&r.right>=0&&r.left<=window.innerWidth;
  });
  if(!visible.length)return;
  const start=current.screenCursor%visible.length;
  let scheduled=0,scanned=0;
  while(scanned<visible.length&&scheduled<capacity){
    const i=(start+scanned)%visible.length,img=visible[i];
    scanned++;
    if(img.dataset.busy||Number(img.dataset.retryAt||0)>Date.now())continue;
    if(img.dataset.nextAt&&Number(img.dataset.nextAt)>Date.now())continue;
    img.dataset.nextAt=String(Date.now()+current.refreshMs);
    refreshOne(img);
    scheduled++;
  }
  current.screenCursor=(start+scanned)%visible.length;
}
async function refresh(){
  try{
    const data=await api('/api/devices');
    const signature=list=>list.map(d=>[d.serial,d.state,d.model,d.label].join('|')).join('\n');
    const changed=signature(current.devices)!==signature(data.devices)||current.cards.size===0;
    current.devices=data.devices;
    for(const serial of [...current.selected])if(!current.devices.some(d=>d.serial===serial))current.selected.delete(serial);
    $('count').textContent=data.count+' devices';
    $('onlineCount').textContent=online().length+' online';
    $('lastRefresh').textContent='Updated '+new Date().toLocaleTimeString('vi-VN');
    if(changed){renderGroups();renderDevices()}
    else selectedDisplay();
  }catch(e){toast('ADB: '+e.message,true)}
}
async function sendInput(serials,params){
  try{
    if(!serials.length)throw Error('Vui lòng chọn ít nhất một thiết bị');
    const result=await api('/api/input',{serials,...params});
    const fail=result.results.filter(x=>!x.ok);
    toast(fail.length?'Lỗi '+fail.length+'/'+serials.length+' • '+fail[0].error:'Đã gửi '+params.action+' tới '+serials.length+' thiết bị',fail.length>0);
  }catch(e){toast(e.message,true)}
}
async function openMirror(serial){
  try{const x=await api('/api/open',{serial});toast(x.already?'Cửa sổ đã mở':'Đã gửi lệnh mở cửa sổ Android')}catch(e){toast(e.message,true)}
}
$('mirrorSelected').onclick=async()=>{const ss=active();if(!ss.length)return toast('Chọn thiết bị',true);for(const s of ss.slice(0,8))await openMirror(s);if(ss.length>8)toast('Đã mở 8 thiết bị đầu tiên; giới hạn để tránh quá tải')};
$('openFirst').onclick=()=>{const s=active()[0];if(!s)return toast('Chọn thiết bị',true);openMirror(s)};
document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>sendInput($('syncKeys').checked?active():active().slice(0,1),{action:'key',key:b.dataset.key}));
$('sendText').onclick=()=>{
  const text=$('sendValue').value;
  sendInput($('syncKeys').checked?active():active().slice(0,1),{action:'text',text});
};
async function batch(action){
  const serials=active();if(!serials.length)return toast('Chọn thiết bị trước',true);
  const fileMode=['upload','install'].includes(action);
  const name=prompt(fileMode?'Tên tệp trong thư mục drop':'Android package ID (vd: com.example.app)');
  if(name===null)return;
  try{
    const result=await api('/api/batch',{action,serials,...(fileMode?{file:name}:{package:name})});
    const failed=result.results.filter(x=>!x.ok);
    toast(failed.length?'Thất bại '+failed.length+'/'+serials.length+': '+failed[0].error:'Hoàn tất '+serials.length+'/'+serials.length,failed.length>0);
  }catch(e){toast(e.message,true)}
}
for(const id of ['install','upload','launch','forceStop'])$(id).onclick=()=>batch(id);
let recordId=null;
async function checkRecording(){
  if(!recordId)return;
  try{
    const r=await api('/api/record/status?id='+encodeURIComponent(recordId));
    $('recordStatus').textContent=(r.state==='recording'?'Đang ghi: ':r.state==='completed'?'Đã ghi xong: ':'Ghi thất bại: ')+
      r.serial+' • '+r.seconds+'s'+(r.bytes?' • '+Math.ceil(r.bytes/1024)+' KB':'')+
      (r.state==='completed'?' • '+r.file:'')+(r.error?' • '+r.error:'');
    if(r.state!=='recording'){$('recordStop').disabled=true;recordId=null}
  }catch(e){$('recordStatus').textContent=e.message;recordId=null;$('recordStop').disabled=true}
}
$('recordStart').onclick=async()=>{
  const serial=active()[0];if(!serial)return toast('Chọn một thiết bị để ghi',true);
  try{
    const seconds=Number($('recordSeconds').value);
    const r=await api('/api/record/start',{serial,seconds});
    recordId=r.id;$('recordStop').disabled=false;setTab('toolbox');
    $('recordStatus').textContent='Đang ghi '+serial+' • '+seconds+'s';
  }catch(e){toast(e.message,true)}
};
$('recordStop').onclick=async()=>{
  if(!recordId)return;
  try{await api('/api/record/stop',{id:recordId});await checkRecording()}catch(e){toast(e.message,true)}
};
setInterval(checkRecording,2000);
$('listPackages').onclick=async()=>{const s=active()[0];if(!s)return toast('Chọn thiết bị trước',true);try{const r=await api('/api/packages?serial='+encodeURIComponent(s));$('appInfo').textContent='Đã tìm thấy '+r.packages.length+' ứng dụng. '+r.packages.slice(0,12).join(' • ')}catch(e){toast(e.message,true)}};
$('apps').onclick=()=>setTab('toolbox');
$('viewDevices').onclick=()=>{setTab('general');document.querySelector('.workspace').scrollTo({top:0,behavior:'smooth'})};
$('macroTab').onclick=()=>setTab('tasks');
$('scheduleTab').onclick=()=>{setTab('tasks');showSchedules()};
$('screenInfo').onclick=async()=>{try{const x=await api('/api/health');toast('ADB '+(x.adbExists?'OK':'MISSING')+' • scrcpy '+(x.scrcpyExists?'OK':'MISSING')+' • '+online().length+' máy online')}catch(e){toast(e.message,true)}};
$('scanWifi').onclick=async()=>{
  const address=prompt('Nhập IP:port của Android đã bật/ghép đôi Wireless ADB trong LAN (vd 192.168.1.20:5555)');
  if(address===null)return;
  try{const r=await api('/api/wifi/connect',{address:address.trim()});toast('Đã kết nối WiFi ADB: '+r.address);await refresh()}
  catch(e){toast('WiFi ADB: '+e.message,true)}
};
$('screenshots').onclick=()=>{
  const list=active();if(!list.length)return toast('Chọn thiết bị trước',true);
  list.slice(0,10).forEach((serial,i)=>{
    const a=document.createElement('a');a.href='/api/screen?serial='+encodeURIComponent(serial);a.download='TigerIQ-'+serial+'.png';
    document.body.append(a);a.click();a.remove();
  });
  toast('Đã yêu cầu tải ảnh chụp '+Math.min(10,list.length)+' máy');
};
$('refresh').onclick=refresh;$('refreshMain').onclick=refresh;
$('search').oninput=renderDevices;
$('tileSize').oninput=e=>{const size=Number(e.target.value);document.documentElement.style.setProperty('--tile',size+'px');$('tileValue').textContent=size+'px'};
$('refreshRate').onchange=e=>{current.refreshMs=Number(e.target.value)};
let macroId=null;
async function checkMacro(){
  if(!macroId)return;
  try{
    const r=await api('/api/macro/status?id='+encodeURIComponent(macroId));
    $('macroStatus').textContent=r.state+' '+r.done+'/'+r.total+(r.error?' • '+r.error:'');
    if(r.state!=='running'){macroId=null;$('stopMacro').disabled=true}
  }catch(e){macroId=null;$('stopMacro').disabled=true;toast(e.message,true)}
}
$('runMacro').onclick=async()=>{
  try{
    const serials=active();if(!serials.length)throw Error('Chọn thiết bị trước');
    const steps=JSON.parse($('macroSteps').value);
    const r=await api('/api/macro/start',{serials,steps});
    macroId=r.id;$('stopMacro').disabled=false;await checkMacro();setTab('tasks');
  }catch(e){toast(e.message,true)}
};
$('stopMacro').onclick=async()=>{if(!macroId)return;try{await api('/api/macro/stop',{id:macroId});await checkMacro()}catch(e){toast(e.message,true)}};
async function showSchedules(){
  try{
    const result=await api('/api/schedules'),host=$('scheduleList');host.textContent='';
    if(!result.schedules.length){host.textContent='Chưa có lịch';return}
    for(const x of result.schedules){
      const row=document.createElement('div');row.className='schedule-item';
      const label=document.createElement('span');label.textContent=x.name+' • '+new Date(x.nextAt).toLocaleString('vi-VN')+(x.enabled?'':' • stopped');
      const del=document.createElement('button');del.textContent='Xóa';
      del.onclick=async()=>{try{await api('/api/schedules/delete',{id:x.id});await showSchedules()}catch(e){toast(e.message,true)}};
      row.append(label,del);host.append(row);
    }
  }catch(e){toast(e.message,true)}
}
$('saveSchedule').onclick=async()=>{
  try{
    const serials=active();if(!serials.length)throw Error('Chọn thiết bị trước');
    const steps=JSON.parse($('macroSteps').value);
    const mins=Number(prompt('Chạy sau bao nhiêu phút?','5'));
    if(!Number.isInteger(mins)||mins<1||mins>525600)throw Error('Thời gian không hợp lệ');
    const repeatMinutes=Number(prompt('Lặp sau bao nhiêu phút? (0 = chỉ một lần)','0'));
    if(!Number.isInteger(repeatMinutes)||repeatMinutes<0||repeatMinutes>1440)throw Error('Chu kỳ không hợp lệ');
    await api('/api/schedules',{name:'TigerIQ '+new Date().toLocaleString('vi-VN'),serials,steps,runAt:new Date(Date.now()+mins*60000).toISOString(),repeatMinutes});
    toast('Đã lưu lịch cục bộ');await showSchedules();setTab('tasks');
  }catch(e){toast(e.message,true)}
};
$('refreshSchedules').onclick=showSchedules;
api('/api/health').then(x=>{$('health').textContent='ADB: '+(x.adbExists?'ready':'missing')+' • scrcpy: '+(x.scrcpyExists?'ready':'missing')+' • Local only'}).catch(e=>toast(e.message,true));
refresh();showSchedules();
setInterval(()=>{if(document.hidden)return;refreshScreens()},2000);
setInterval(()=>{if(!document.hidden)refresh()},25000);
setInterval(checkMacro,1200);
