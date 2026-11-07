/* Original UltraCarHCM browser for manufacturer-attributed images already self-hosted and licensed only for current scope. */
(()=>{
'use strict';
const mount=document.querySelector('#thu-vien');
if(!mount)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const cutTitle=title=>String(title||'').replace(/^Màn hình taplo\s*/i,'').replace(/\s+13[.,]3\s*&\s*16\s*inch.*$/i,'').replace(/\s*·\s*Ảnh lắp đặt.*$/i,'').trim();
const host=document.createElement('section');
host.className='uc-vehicles section';host.id='hinh-theo-xe';
host.innerHTML=[
 '<div class="container">',
 '<div class="uc-vehicle-head"><span class="kicker">THƯ VIỆN KHOANG LÁI</span><h2>Hình ảnh theo từng dòng xe.</h2><p>Chọn xe để xem hình minh họa mà hãng đã công khai. Vị trí lắp và giá đỡ vẫn phải kiểm tra theo đời xe, phiên bản táp-lô và thiết bị thực tế.</p></div>',
 '<div class="uc-vehicle-toolbar"><label for="ucVehicleFind">Tìm xe<input type="search" id="ucVehicleFind" placeholder="Ví dụ: VF5, Limo Green, Ford Ranger…" autocomplete="off" /></label>',
 '<label for="ucVehicleBrand">Hãng xe<select id="ucVehicleBrand"><option value="">Tất cả hãng xe</option></select></label></div>',
 '<p class="uc-vehicle-total" id="ucVehicleCount" role="status" aria-live="polite">Đang tải bộ sưu tập…</p>',
 '<div id="ucVehicleGrid" class="uc-vehicle-grid"></div><button type="button" id="ucVehicleMore" class="btn btn-outline">Xem thêm xe</button>',
 '<p class="uc-vehicle-foot">Ảnh công khai do UltraCar giới thiệu, không đại diện cho ảnh lắp đặt của UltraCarHCM. Vui lòng cung cấp ảnh táp-lô của chính xe bạn để xác nhận cấu hình.</p>',
 '</div>'
].join('');
mount.parentNode.insertBefore(host,mount);
const find=host.querySelector('#ucVehicleFind'),brand=host.querySelector('#ucVehicleBrand'),grid=host.querySelector('#ucVehicleGrid'),count=host.querySelector('#ucVehicleCount'),more=host.querySelector('#ucVehicleMore');
let all=[],visible=12;
const brandName=p=>{const name=p.split('/').filter(Boolean).pop()||'';const first=name.split('-')[0];const named={'vinfast':'VinFast','kia':'Kia','mg':'MG','bmw':'BMW','ford':'Ford','hyundai':'Hyundai','toyota':'Toyota','mazda':'Mazda','honda':'Honda','suzuki':'Suzuki','mitsubishi':'Mitsubishi','peugeot':'Peugeot','geely':'Geely','bestune':'Bestune','hino':'Hino','chevrolet':'Chevrolet','citroen':'Citroën','isuzu':'Isuzu','lexus':'Lexus','renault':'Renault','skoda':'Skoda','volkswagen':'Volkswagen'};return named[first]||first.toUpperCase();};
function render(){
 const term=norm(find.value.trim()),selected=brand.value;
 const matches=all.filter(row=>(!selected||brandName(row.path)===selected)&&(!term||norm(row.title+' '+row.path).includes(term)));
 count.textContent=matches.length+' dòng xe có hình minh họa · Đang xem '+Math.min(visible,matches.length)+' mẫu';
 const rows=matches.slice(0,visible);
 grid.innerHTML=rows.map(row=>{
   const thumb='/assets/manufacturer'+row.image;
   const label=cutTitle(row.title);
   return '<a class="uc-vehicle-card" href="/chi-tiet.html?page='+encodeURIComponent(row.path)+'"><div class="uc-vehicle-photo"><img src="'+esc(thumb)+'" alt="'+esc('Hình minh họa màn hình trên '+label)+'" loading="lazy" decoding="async" /><span>'+esc(brandName(row.path))+'</span></div><div class="uc-vehicle-body"><strong>'+esc(label)+'</strong><small>Xem tư vấn &amp; cấu hình →</small></div></a>';
 }).join('')||'<p class="uc-vehicle-empty">Không có hình ảnh phù hợp. Thử tên xe khác hoặc liên hệ tư vấn.</p>';
 more.hidden=matches.length<=visible;
}
Promise.resolve().then(()=>fetch('/source-details.json?v=20261107r2',{credentials:'same-origin'})).then(r=>{if(!r.ok)throw Error('SOURCE_HTTP_'+r.status);return r.json();}).then(db=>{
 all=(db.pages||[]).filter(p=>p.group==='dong-xe'&&typeof p.image==='string'&&/^\/assets\/[a-zA-Z0-9_./-]+\.(?:webp|jpe?g|png)$/i.test(p.image));
 const names=[...new Set(all.map(p=>brandName(p.path)))].sort((a,b)=>a.localeCompare(b,'vi'));
 brand.insertAdjacentHTML('beforeend',names.map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join(''));
 render();
}).catch(()=>{count.textContent='Không tải được thư viện ảnh. Vui lòng thử lại sau.';grid.innerHTML='';more.hidden=true;});
find.addEventListener('input',()=>{visible=12;render();});brand.addEventListener('change',()=>{visible=12;render();});more.addEventListener('click',()=>{visible+=12;render();});
})();