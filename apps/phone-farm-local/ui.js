const $=id=>document.getElementById(id);
const grid=$('grid'), selected=new Set(), sizes=new Map(), sessions=new Map();
let deviceRows=[], lastRefresh=0, pending=0;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notice=(s,bad=false)=>{$('msg').textContent=s;$('msg').className=bad?'bad':'good'};
async function api(url, data){
  const response=await fetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const value=await response.json();if(!response.ok)throw Error(value.error||('Mã lỗi '+response.status));return value;
}
const active=()=>deviceRows.filter(d=>selected.has(d.serial)&&d.state==='device').map(d=>d.serial);
async function action(b){
  if(!b.serials?.length)throw Error('Chưa chọn thiết bị nào');
  const x=await api('/api/input',b),err=x.results.filter(r=>!r.ok);
  notice(err.length?('Lỗi '+err.length+'/'+x.results.length+': '+err[0].error):('Đã gửi tới '+x.results.length+' thiết bị'),!!err.length);
}
async function refresh(){
  try{
    const data=await api('/api/devices');deviceRows=data.devices;
    for(const serial of [...selected])if(!deviceRows.some(d=>d.serial===serial))selected.delete(serial);
    $('count').textContent=data.count+' thiết bị';
    draw();lastRefresh=Date.now();
  }catch(e){notice('Không thể đọc danh sách: '+e.message,true)}
}
function draw(){
  const query=$('search').value.trim().toLowerCase();
  grid.textContent='';
  const display=deviceRows.filter(d=>(d.serial+' '+d.model+' '+d.label).toLowerCase().includes(query));
  if(!display.length){grid.innerHTML='<div class="empty">Không có thiết bị phù hợp</div>';return}
  for(const d of display){
    const card=document.createElement('div');card.className='device'+(d.state==='device'?'':' offline');
    const serial=d.serial,ready=d.state==='device',checked=selected.has(serial)?'checked':'';
    card.innerHTML='<div class="device-head"><div><strong>'+escape(d.label||d.model||serial)+'</strong><small>'+escape(serial)+'</small><small class="'+(ready?'good':'bad')+'">'+escape(d.state)+'</small></div><input type="checkbox" aria-label="Chọn '+escape(serial)+'" '+checked+'></div>'+
      '<div class="screenbox">'+(ready?'<img alt="Màn hình '+escape(serial)+'" draggable="false">':'<div class="empty">Thiết bị chưa sẵn sàng</div>')+'</div>'+
      '<div class="device-foot"><button data-open '+(ready?'':'disabled')+'>Mở điều khiển</button><button data-home '+(ready?'':'disabled')+'>Trang chủ</button><button data-label>Đổi tên</button></div>';
    card.querySelector('input').onchange=e=>{e.target.checked?selected.add(serial):selected.delete(serial)};
    card.querySelector('[data-open]').onclick=async()=>{try{const x=await api('/api/open',{serial});notice(x.already?'Đã có phiên điều khiển':'Đã gửi lệnh mở scrcpy cho '+serial)}catch(e){notice(e.message,true)}};
    card.querySelector('[data-home]').onclick=()=>action({serials:[serial],action:'key',key:'HOME'}).catch(e=>notice(e.message,true));
    card.querySelector('[data-label]').onclick=async()=>{
      const label=prompt('Tên thiết bị',d.label||d.model||'');if(label===null)return;
      try{await api('/api/label',{serial,label});d.label=label;draw()}catch(e){notice(e.message,true)}
    };
    grid.append(card);
    if(ready){
      const img=card.querySelector('img');
      const size={width:1,height:1}; sizes.set(serial,size);
      img.onload=()=>{size.width=img.naturalWidth;size.height=img.naturalHeight};
      img.onerror=()=>{img.alt='Chưa lấy được ảnh'};
      let drag=null;
      img.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY};img.setPointerCapture(e.pointerId)};
      img.onpointerup=async e=>{
        if(!drag||!size.width||!size.height)return;
        const box=img.getBoundingClientRect(),scaleX=size.width/box.width,scaleY=size.height/box.height;
        const start=[Math.max(0,Math.round((drag.x-box.left)*scaleX)),Math.max(0,Math.round((drag.y-box.top)*scaleY))];
        const end=[Math.max(0,Math.round((e.clientX-box.left)*scaleX)),Math.max(0,Math.round((e.clientY-box.top)*scaleY))];
        const swipe=Math.hypot(end[0]-start[0],end[1]-start[1])>12;drag=null;
        const targets=$('sync').checked?active():[serial];
        try {
          if(!targets.length)throw Error('Chọn thiết bị trước khi đồng bộ');
          const output=await Promise.all(targets.map(async s=>{
            let w=size.width,h=size.height;
            if(s!==serial){let z=sizes.get(s);if(!z?.width||z.width===1){z=await api('/api/size?serial='+encodeURIComponent(s))}w=z.width;h=z.height}
            const b={serials:[s],action:swipe?'swipe':'tap',x:Math.round(start[0]*w/size.width),y:Math.round(start[1]*h/size.height)};
            if(swipe)Object.assign(b,{toX:Math.round(end[0]*w/size.width),toY:Math.round(end[1]*h/size.height),ms:360});
            return api('/api/input',b);
          }));
          const errors=output.flatMap(o=>o.results).filter(x=>!x.ok);
          notice(errors.length?errors[0].error:('Đã '+(swipe?'vuốt':'chạm')+' '+targets.length+' thiết bị'),errors.length>0);
          loadScreen(img,serial);
        }catch(e){notice(e.message,true)}
      };
      loadScreen(img,serial);
    }
  }
}
function loadScreen(img,serial){
  if(img.dataset.busy==='1'||!img.isConnected)return;
  img.dataset.busy='1';
  img.onload=()=>{sizes.set(serial,{width:img.naturalWidth,height:img.naturalHeight});img.dataset.busy='0'};
  img.onerror=()=>{img.alt='Không tải được ảnh, đang thử lại';img.dataset.busy='0'};
  img.src='/api/screen?serial='+encodeURIComponent(serial)+'&ts='+Date.now();
}
$('refresh').onclick=refresh;$('all').onclick=()=>{deviceRows.filter(d=>d.state==='device').forEach(d=>selected.add(d.serial));draw()};
$('none').onclick=()=>{selected.clear();draw()};$('search').oninput=draw;
$('sendText').onclick=()=>action({serials:active(),action:'text',text:$('text').value}).catch(e=>notice(e.message,true));
async function batch(actionName){
  const serials=active();
  if(!serials.length){notice('Chọn thiết bị trước',true);return}
  const fileRequired=actionName==='install'||actionName==='upload';
  const value=prompt(fileRequired?'Nhập tên tệp trong thư mục drop trên PC01':'Nhập Android package ID (ví dụ com.example.app)');
  if(value===null)return;
  try{
    const b={serials,action:actionName};
    if(fileRequired)b.file=value;else b.package=value;
    const result=await api('/api/batch',b),bad=result.results.filter(x=>!x.ok);
    notice(bad.length?'Thất bại '+bad.length+'/'+serials.length+': '+bad[0].error:'Thành công '+serials.length+'/'+serials.length+' thiết bị',bad.length>0);
  }catch(e){notice(e.message,true)}
}
$('install').onclick=()=>batch('install');
$('upload').onclick=()=>batch('upload');
$('launch').onclick=()=>batch('launch');
$('forceStop').onclick=()=>batch('forceStop');
document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>action({serials:active(),action:'key',key:b.dataset.key}).catch(e=>notice(e.message,true)));
api('/api/health').then(x=>{$('health').textContent='ADB: '+(x.adbExists?'có':'thiếu')+'; scrcpy: '+(x.scrcpyExists?'có':'thiếu')+'; chế độ: chỉ nội bộ PC'}).catch(e=>notice(e.message,true));
refresh();
setInterval(()=>{if(document.hidden)return;if(Date.now()-lastRefresh>20000)refresh();else for(const img of grid.querySelectorAll('.screenbox img')){const box=img.closest('.device');const serial=box?.querySelector('.device-head small')?.textContent;if(serial)loadScreen(img,serial)}},4000);

