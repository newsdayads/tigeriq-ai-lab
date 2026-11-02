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
  if(!response.ok){
    const error=Error(data.error||('HTTP '+response.status));
    error.status=response.status;
    for(const key of ['reason','address','detail'])if(typeof data[key]==='string'&&data[key])error[key]=data[key].slice(0,key==='detail'?250:120);
    throw error;
  }
  return data;
}
const wifiReasonLabel={
  ADB_ENDPOINT_UNREACHABLE:'Endpoint LAN không phản hồi',
  ADB_CONNECT_REFUSED:'Kết nối bị từ chối',
  ADB_CONNECT_TIMEOUT:'Hết thời gian chờ',
  ADB_CONNECT_UNREACHABLE:'Không tới được endpoint',
  ADB_CONNECT_UNAUTHORIZED:'Thiết bị chưa cấp quyền ADB',
  ADB_CONNECT_FAILED:'ADB chưa kết nối'
};
function wifiFailureText(prefix,error,fallbackAddress=''){
  const address=error?.address||fallbackAddress;
  const reason=error?.reason?(wifiReasonLabel[error.reason]||error.reason):'';
  const detail=error?.detail&&error.detail!==error.message?error.detail:'';
  return prefix+(address?' • '+address:'')+(reason?' • '+reason:'')+': '+error.message+(detail?' • '+detail:'');
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
  make('▣','Điều khiển video thời gian thực (scrcpy)',()=>openMirror(d.serial));
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
      img.onload=()=>{settleScreen(img,true);current.sizes.set(d.serial,{width:img.naturalWidth,height:img.naturalHeight})};
      img.onerror=()=>{settleScreen(img,false);img.alt='Chưa tải được màn hình';img.title='Ảnh lỗi, sẽ tự thử lại'};
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
  const startX=Number(img.dataset.startX),startY=Number(img.dataset.startY);
  const a=norm(startX,startY),b=norm(e.clientX,e.clientY);
  delete img.dataset.startX;delete img.dataset.startY;
  // Mouse jitter must be measured in CSS pixels, not 1080/1440 Android pixels.
  const isSwipe=Math.hypot(e.clientX-startX,e.clientY-startY)>8;
  const syncEnabled=img.id==='controlImage'?$('controlSync').checked:$('sync').checked;
  const serials=syncEnabled?[...new Set([serial,...active()])]:[serial];
  if(!serials.length)throw Error('Chọn các thiết bị để đồng bộ chuột');
  const outputs=await Promise.all(serials.map(async s=>{
    const sz=s===serial?size:await api('/api/size?serial='+encodeURIComponent(s));
    const action={action:isSwipe?'swipe':'tap',x:Math.round(a[0]*sz.width),y:Math.round(a[1]*sz.height)};
    if(isSwipe)Object.assign(action,{toX:Math.round(b[0]*sz.width),toY:Math.round(b[1]*sz.height),ms:350});
    return api('/api/input',{serials:[s],...action});
  }));
  const failed=outputs.flatMap(x=>x.results).filter(x=>!x.ok);
  toast(failed.length?'ADB lỗi '+failed.length+'/'+serials.length+': '+failed[0].error:'ADB nhận '+(isSwipe?'vuốt':'chạm')+'; đang tải ảnh kiểm tra (không phải video trực tiếp)',failed.length>0);
  for(const s of serials.slice(0,4)){
    const target=current.cards.get(s)?.querySelector('.screen img');
    if(target)refreshOne(target,true);
  }
  if(img.id==='controlImage')refreshOne(img,true);
}
function settleScreen(img,ok){
  img.dataset.busy='';
  img.dataset.retryAt=ok?'0':String(Date.now()+6000);
  if(img.dataset.forceAfterBusy==='1'){
    img.dataset.forceAfterBusy='';
    setTimeout(()=>refreshOne(img,true),200);
  }
}
function refreshOne(img,priority=false){
  if(!img.isConnected)return;
  if(img.dataset.busy==='1'){
    if(priority)img.dataset.forceAfterBusy='1';
    return;
  }
  if(!priority&&Number(img.dataset.retryAt||0)>Date.now())return;
  img.dataset.busy='1';
  img.src='/api/screen?serial='+encodeURIComponent(img.dataset.serial)+'&ts='+Date.now();
}
function refreshScreens(){
  if(document.hidden||!$('autoRefresh').checked||!$('controlOverlay').hidden)return;
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
    toast(fail.length?'ADB lỗi '+fail.length+'/'+serials.length+' • '+fail[0].error:'ADB nhận '+params.action+' trên '+serials.length+' máy; đang cập nhật ảnh',fail.length>0);
    for(const serial of serials.slice(0,4)){
      const img=current.cards.get(serial)?.querySelector('.screen img');
      if(img)refreshOne(img,true);
    }
    if(controlSerial&&serials.includes(controlSerial))refreshOne($('controlImage'),true);
  }catch(e){toast(e.message,true)}
}

let controlSerial=null;
function hideControl(){
  controlSerial=null;
  $('controlOverlay').hidden=true;
  const img=$('controlImage');img.removeAttribute('src');img.dataset.busy='';
}
function showControl(serial){
  const device=online().find(x=>x.serial===serial);
  if(!device)return toast('Thiết bị chưa kết nối',true);
  controlSerial=serial;
  $('controlOverlay').hidden=false;
  $('controlTitle').textContent=(device.label||device.model||'Android')+' / '+serial;
  const img=$('controlImage');
  img.dataset.serial=serial;img.dataset.busy='';img.dataset.retryAt='0';img.dataset.nextAt='0';
  img.onpointerdown=e=>{img.dataset.startX=String(e.clientX);img.dataset.startY=String(e.clientY);try{img.setPointerCapture(e.pointerId)}catch{}};
  img.onpointerup=e=>{if(!img.dataset.startX)return;performPointer(img,e).catch(err=>toast(err.message,true))};
  img.onload=()=>{settleScreen(img,true);current.sizes.set(serial,{width:img.naturalWidth,height:img.naturalHeight})};
  img.onerror=()=>{settleScreen(img,false);$('controlNote').textContent='Không tải được màn hình; đang thử lại.'};
  $('controlNote').textContent='Chạm hoặc vuốt trực tiếp. Ảnh làm mới định kỳ, không phải video trực tiếp.';
  refreshOne(img);
}
$('controlClose').onclick=hideControl;
$('controlOverlay').addEventListener('click',e=>{if(e.target===$('controlOverlay'))hideControl()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&controlSerial)hideControl()});
for(const [id,key] of [['controlHome','HOME'],['controlBack','BACK'],['controlRecent','APP_SWITCH']]){
  $(id).onclick=()=>{if(!controlSerial)return;const serials=$('controlSync').checked?[...new Set([controlSerial,...active()])]:[controlSerial];sendInput(serials,{action:'key',key}).then(()=>refreshOne($('controlImage')))};
}
$('controlRefresh').onclick=()=>{if(controlSerial){$('controlImage').dataset.retryAt='0';refreshOne($('controlImage'))}};
setInterval(()=>{
  if(!controlSerial||document.hidden)return;
  const img=$('controlImage');
  if(img.dataset.busy||Number(img.dataset.retryAt||0)>Date.now())return;
  refreshOne(img);
},1600);

async function openMirror(serial){
  const payload={serial,maxFps:Number($('mirrorFps').value),maxSize:Number($('mirrorSize').value),videoBitRateMbps:Number($('mirrorBitrate').value)};
  try{const x=await api('/api/open',payload);toast(x.already?'Đã có tiến trình phản chiếu của máy này':'Đã yêu cầu mở cửa sổ scrcpy; kiểm tra hiển thị và chạm thực tế')}catch(e){toast(e.message,true)}
}
$('mirrorSelected').onclick=()=>{const ss=active();if(!ss.length)return toast('Chọn thiết bị trước',true);void openMirror(ss[0])};
$('openFirst').onclick=()=>{const s=active()[0];if(!s)return toast('Chọn thiết bị',true);showControl(s)};
$('openScrcpy').onclick=()=>{const s=active()[0];if(!s)return toast('Chọn thiết bị',true);openMirror(s)};
document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>sendInput($('syncKeys').checked?active():active().slice(0,1),{action:'key',key:b.dataset.key}));
$('sendText').onclick=()=>{
  const text=$('sendValue').value;
  sendInput($('syncKeys').checked?active():active().slice(0,1),{action:'text',text});
};
$('pasteClipboard').onclick=async()=>{
  const serials=$('syncKeys').checked?active():active().slice(0,1);
  if(!serials.length)return toast('Chọn thiết bị trước',true);
  try{
    const text=await navigator.clipboard.readText();
    if(!text||text.length>200||!/^[\x20-\x7e]+$/.test(text))throw Error('Clipboard phải là ASCII và tối đa 200 ký tự');
    $('sendValue').value=text;
    await sendInput(serials,{action:'text',text});
    toast('Đã dán clipboard PC tới '+serials.length+' máy');
  }catch(e){toast('Clipboard: '+e.message,true)}
};
async function batch(action){
  const serials=active();if(!serials.length)return toast('Chọn thiết bị trước',true);
  const fileMode=['upload','install'].includes(action);
  const name=prompt(fileMode?'Tên tệp trong thư mục drop':'Android package ID (vd: com.example.app)');
  if(name===null)return;
  if(action==='uninstall'&&!confirm('Gỡ '+name+' khỏi '+serials.length+' thiết bị?'))return;
  try{
    const result=await api('/api/batch',{action,serials,...(fileMode?{file:name}:{package:name})});
    const failed=result.results.filter(x=>!x.ok);
    toast(failed.length?'Thất bại '+failed.length+'/'+serials.length+': '+failed[0].error:'Hoàn tất '+serials.length+'/'+serials.length,failed.length>0);
  }catch(e){toast(e.message,true)}
}
for(const id of ['install','upload','launch','forceStop','uninstall'])$(id).onclick=()=>batch(id);
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
async function managePackages(){
  const serial=active()[0];
  if(!serial)return toast('Chọn thiết bị trước',true);
  const host=$('appInfo');
  host.textContent='Đang đọc ứng dụng của '+serial+'...';
  try{
    const result=await api('/api/packages?serial='+encodeURIComponent(serial));
    if(!active().includes(serial))return toast('Danh sách chọn đã thay đổi, vui lòng mở lại',true);
    const packages=result.packages.filter(x=>typeof x==='string').sort();
    host.textContent='';
    const summary=document.createElement('div');
    summary.textContent=packages.length+' ứng dụng • nguồn '+serial+' • mở/dừng trên các máy đang chọn';
    const search=document.createElement('input');
    search.className='field';search.placeholder='Lọc theo package ID';
    search.setAttribute('aria-label','Lọc ứng dụng đã cài');
    search.style.marginTop='6px';
    const items=document.createElement('div');
    items.style.cssText='max-height:230px;overflow:auto;margin-top:6px';
    host.append(summary,search,items);
    async function command(action,pkg){
      const serials=active();
      if(!serials.length)return toast('Chưa chọn thiết bị',true);
      if(action==='forceStop'&&!confirm('Dừng '+pkg+' trên '+serials.length+' thiết bị?'))return;
      if(action==='uninstall'&&!confirm('Gỡ '+pkg+' khỏi '+serials.length+' thiết bị?'))return;
      try{
        const r=await api('/api/batch',{action,serials,package:pkg});
        const failed=r.results.filter(x=>!x.ok);
        toast(failed.length?'Lỗi '+failed.length+'/'+serials.length+': '+failed[0].error:
          (action==='launch'?'Đã gửi lệnh mở ':action==='uninstall'?'Đã gỡ ':'Đã gửi lệnh dừng ')+pkg+' • '+serials.length+' máy',failed.length>0);
      }catch(e){toast(e.message,true)}
    }
    function draw(){
      items.textContent='';
      const query=search.value.trim().toLowerCase();
      const filtered=packages.filter(x=>x.toLowerCase().includes(query));
      if(!filtered.length){items.textContent='Không có ứng dụng phù hợp';return}
      const fragment=document.createDocumentFragment();
      for(const pkg of filtered.slice(0,80)){
        const line=document.createElement('div');
        line.style.cssText='display:flex;align-items:center;gap:5px;padding:4px 0;border-bottom:1px solid #d5e3f1';
        const label=document.createElement('span');
        label.textContent=pkg;label.style.cssText='flex:1;overflow-wrap:anywhere';
        for(const [action,title] of [['launch','Mở'],['forceStop','Dừng'],['uninstall','Gỡ']]){
          const button=document.createElement('button');
          button.className='action soft';button.textContent=title;
          button.title=title+' '+pkg+' trên các máy đang chọn';
          button.onclick=()=>command(action,pkg);
          line.append(button);
        }
        line.prepend(label);
        fragment.append(line);
      }
      items.append(fragment);
      if(filtered.length>80){
        const more=document.createElement('div');
        more.textContent='Hiển thị 80/'+filtered.length+' • lọc để xem thêm';
        items.append(more);
      }
    }
    search.oninput=draw;draw();
  }catch(e){host.textContent='Không đọc được ứng dụng';toast(e.message,true)}
}
$('listPackages').onclick=managePackages;
$('apps').onclick=()=>setTab('toolbox');
$('viewDevices').onclick=()=>{setTab('general');document.querySelector('.workspace').scrollTo({top:0,behavior:'smooth'})};
$('macroTab').onclick=()=>setTab('tasks');
$('scheduleTab').onclick=()=>{setTab('tasks');showSchedules()};
$('screenInfo').onclick=async()=>{try{const x=await api('/api/health');const policy=x.runtimeNetworkPolicy||{};toast('ADB '+(x.adbExists?'OK':'MISSING')+' • scrcpy '+(x.scrcpyExists?'OK':'MISSING')+' • '+online().length+' máy online • WiFi nhớ '+Number(x.rememberedWifi||0)+' • Internet runtime '+(policy.internetRequired===false?'không bắt buộc':'chưa xác minh'))}catch(e){toast(e.message,true)}};
$('scanWifi').onclick=async()=>{
  const usbSerial=active().find(serial=>!serial.includes(':'));
  if(usbSerial){
    try{
      const candidate=await api('/api/wifi/candidate?serial='+encodeURIComponent(usbSerial));
      if(!confirm('Đã tìm thấy WiFi ADB '+candidate.address+' từ '+usbSerial+'. Kết nối ngay?'))return;
      const r=await api('/api/wifi/connect',{address:candidate.address});
      toast('Đã kết nối WiFi ADB: '+r.address);
      await refresh();
    }catch(e){toast(wifiFailureText('Dò WiFi ADB',e),true)}
    return;
  }
  const address=prompt('Chọn một thiết bị USB để tự dò, hoặc nhập IP:port Wireless ADB đã bật sẵn trong LAN (vd 192.168.1.20:5555)');
  if(address===null)return;
  const requestedAddress=address.trim();
  try{const r=await api('/api/wifi/connect',{address:requestedAddress});toast('Đã kết nối WiFi ADB: '+r.address);await refresh()}
  catch(e){toast(wifiFailureText('WiFi ADB',e,requestedAddress),true)}
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
