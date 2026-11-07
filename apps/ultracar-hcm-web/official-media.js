/* UltraCarHCM: original UI + source-attributed YouTube playback. No manufacturer MP4/model/policy files are copied or rehosted. */
(()=>{
'use strict';
const $=(s,root=document)=>root.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const VIDEOS=[
 {id:'FSJdq_Yi_G8',title:'Hướng dẫn lắp đặt Limo / VF3',group:'guide'},
 {id:'hcc0Hu5tVjc',title:'Màn hình UltraCar trên VF5 / Herio Green',group:'car'},
 {id:'vd4kEQceM9U',title:'Sử dụng camera trên màn hình',group:'guide'},
 {id:'PWhSrOk5CYw',title:'Màn hình UltraCar 16 inch thực tế',group:'product'},
 {id:'IdEzIAl2DgA',title:'Thao tác lắp SIM vào màn hình',group:'guide'},
 {id:'XniB7rDY1Ds',title:'Điều chỉnh độ sáng màn hình',group:'guide'},
 {id:'jll0l0QBUG4',title:'Phát Wi-Fi từ màn hình UltraCar',group:'guide'},
 {id:'FTiAXfHQvU0',title:'Bộ giá đỡ màn hình ghế sau',group:'product'},
 {id:'qVc_VzdJ7AY',title:'UltraCar trên VinFast Minio Green / VF2',group:'car'},
 {id:'Z_19E88ylgc',title:'UltraCar trên Honda CR-V 2024',group:'car'},
 {id:'-NPSwCjCqJM',title:'UltraCar trên VinFast VF6 / VF7 — phần 1',group:'car'},
 {id:'TbwsSx8-38Q',title:'UltraCar trên VinFast VF6 / VF7 — phần 2',group:'car'},
 {id:'G9N03nbuzbY',title:'UltraCar trên Hyundai Accent 2024',group:'car'},
 {id:'r9p3uNJZWew',title:'Giá đỡ đa năng — phần 1',group:'product'},
 {id:'I5W8ma8lGII',title:'Tham quan trụ sở UltraCar',group:'brand'}
];
const POLICIES=[
 {name:'Điều kiện bảo hành',local:'/chinh-sach/bao-hanh/',official:'https://ultracar.vn/chinh-sach/bao-hanh/',desc:'Tra cứu hướng dẫn chuẩn bị chứng từ và liên hệ bảo hành.'},
 {name:'Đổi trả sản phẩm',local:'/chinh-sach/doi-tra/',official:'https://ultracar.vn/chinh-sach/doi-tra/',desc:'Xác minh điều kiện áp dụng và thủ tục đổi trả mới nhất.'},
 {name:'Điều khoản sử dụng',local:'/chinh-sach/dieu-khoan/',official:'https://ultracar.vn/chinh-sach/dieu-khoan/',desc:'Tìm hiểu phạm vi đặt hàng, xác nhận giá và quyền sử dụng nội dung.'},
 {name:'Chính sách bảo mật',local:'/chinh-sach/bao-mat/',official:'https://ultracar.vn/chinh-sach/bao-mat/',desc:'Xem cách nhà sản xuất tiếp nhận và xử lý thông tin cá nhân.'}
];
function videoCards(host,maxCount){
 let filter='all',limit=maxCount||6;
 const count=$('.uc-video-count',host),grid=$('.uc-video-grid',host),more=$('.uc-video-more',host);
 const names={all:'Tất cả',guide:'Hướng dẫn',car:'Theo xe',product:'Sản phẩm',brand:'Thương hiệu'};
 const controls=$('.uc-video-tabs',host);
 controls.innerHTML=Object.entries(names).map(([key,v])=>'<button type="button" class="uc-video-tab'+(key===filter?' active':'')+'" data-category="'+key+'" aria-pressed="'+(key===filter)+'">'+v+'</button>').join('');
 function card(v){
  const url='https://www.youtube.com/shorts/'+v.id;
  return '<article class="uc-video-card"><div class="uc-video-visual" data-frame="'+esc(v.id)+'"><img alt="" loading="lazy" decoding="async" src="https://i.ytimg.com/vi/'+esc(v.id)+'/hqdefault.jpg"/><button class="uc-video-play" type="button" data-play="'+esc(v.id)+'" aria-label="Phát video '+esc(v.title)+'">▶ <span>Phát video</span></button></div><div class="uc-video-info"><small>'+esc(names[v.group])+' · Nguồn UltraCar.vn</small><h3>'+esc(v.title)+'</h3><a href="'+url+'" target="_blank" rel="noopener noreferrer">Mở video trên YouTube</a></div></article>';
 }
 function draw(){
  const items=VIDEOS.filter(v=>filter==='all'||v.group===filter),portion=items.slice(0,limit);
  count.textContent='Đang hiển thị '+portion.length+' / '+items.length+' video được UltraCar.vn giới thiệu';
  grid.innerHTML=portion.map(card).join('');
  more.hidden=items.length<=limit;
 }
 controls.addEventListener('click',e=>{const btn=e.target.closest('[data-category]');if(!btn)return;filter=btn.dataset.category;limit=maxCount||6;controls.querySelectorAll('button').forEach(x=>{const current=x===btn;x.classList.toggle('active',current);x.setAttribute('aria-pressed',String(current));});draw();});
 more.addEventListener('click',()=>{limit+=6;draw();});
 grid.addEventListener('click',e=>{const b=e.target.closest('[data-play]');if(!b)return;const id=b.dataset.play;if(!VIDEOS.some(v=>v.id===id))return;
  const frame=b.closest('[data-frame]');const video=VIDEOS.find(v=>v.id===id);
  frame.innerHTML='<iframe class="uc-video-iframe" loading="eager" title="'+esc(video.title)+'" src="https://www.youtube-nocookie.com/embed/'+id+'?autoplay=1&playsinline=1&rel=0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
 });
 draw();
}
function videoLayout(id,maxCount){
 const section=document.createElement('section');section.id=id;section.className='uc-video-section section';
 section.innerHTML='<div class="container"><div class="uc-video-head"><span class="kicker">VIDEO TỪ KÊNH CHÍNH THỨC ĐƯỢC HÃNG GIỚI THIỆU</span><h2>Trải nghiệm UltraCar qua video.</h2><p>Phát trực tiếp bằng trình phát YouTube khi bạn chọn video. UltraCarHCM không tải, sao chép hoặc lưu trữ bản MP4 của hãng.</p></div><div class="uc-video-tabs" role="group" aria-label="Lọc video theo nội dung"></div><p class="uc-video-count" aria-live="polite"></p><div class="uc-video-grid"></div><button type="button" class="btn btn-outline uc-video-more">Xem thêm video</button><p class="uc-video-foot">Video thuộc kênh/nguồn bên thứ ba và có thể bị chặn phát nhúng. Khi đó chọn “Mở video trên YouTube”. Không thao tác giải trí khi đang điều khiển xe.</p></div>';
 videoCards(section,maxCount);
 return section;
}
function policyLayout(){
 const section=document.createElement('section');section.id='chinh-sach-chinh-hang';section.className='uc-terms-section section';
 section.innerHTML='<div class="container"><span class="kicker">CHÍNH SÁCH VÀ ĐIỀU KHOẢN</span><h2>Xem chính sách từ nhà sản xuất.</h2><p>UltraCarHCM cung cấp bản tóm lược để tham khảo. Khi cần điều khoản nguyên văn, sử dụng liên kết đến trang chính thức có thể cập nhật của hãng; nội dung không tự động thay thế xác nhận giao dịch tại đại lý.</p><div class="uc-terms-grid">'+POLICIES.map(p=>'<article class="uc-terms-card"><h3>'+esc(p.name)+'</h3><p>'+esc(p.desc)+'</p><div class="uc-terms-links"><a href="/chi-tiet.html?page='+encodeURIComponent(p.local)+'">Đọc hướng dẫn tại UltraCarHCM</a><a href="'+p.official+'" target="_blank" rel="noopener noreferrer">Văn bản gốc của hãng ↗</a></div></article>').join('')+'</div></div>';
 return section;
}
const target=$('#thu-vien');
if(target&&target.parentNode){
 const section=videoLayout('video-thuc-te',6);
 target.parentNode.insertBefore(section,target);
 target.parentNode.insertBefore(policyLayout(),target);
}
function detailAddons(){
 const art=$('#internalArticle');if(!art)return;
 const p=new URLSearchParams(location.search).get('page')||'';
 if(!(p==='/video/'||p==='/tvc/'||p==='/ho-tro/'||p.startsWith('/chinh-sach/')||p==='/trai-nghiem-3d/'))return;
 let installed=false;
 const add=()=>{
  if(installed||!art.querySelector('.data-origin'))return;
  installed=true;
  if(p==='/video/'||p==='/tvc/'||p==='/ho-tro/'){
   const s=videoLayout('huong-dan-video',p==='/tvc/'?6:15);
   s.classList.add('uc-video-detail');s.querySelector('.container').classList.add('uc-detail-inner');
   art.appendChild(s);
  }
  const policy=POLICIES.find(x=>x.local===p);
  if(policy){
   const box=document.createElement('div');box.className='uc-policy-original';
   box.innerHTML='<strong>Toàn văn điều khoản do UltraCar công bố</strong><p>Để tránh cung cấp bản chép lỗi thời hoặc không đúng quyền, mở bản mới nhất từ chính nhà sản xuất. UltraCarHCM sẽ xác nhận điều kiện cụ thể của đơn hàng trước khi giao dịch.</p><a href="'+policy.official+'" target="_blank" rel="noopener noreferrer">Đọc toàn văn '+esc(policy.name)+' của hãng ↗</a>';
   art.appendChild(box);
  }
  if(p==='/trai-nghiem-3d/')build3D(art);
 };
 const observer=new MutationObserver(()=>{if(art.querySelector('.data-origin')){add();observer.disconnect();}});
 observer.observe(art,{childList:true,subtree:true});add();
}
function build3D(article){
 const wrap=document.createElement('section');wrap.className='uc-original-3d';wrap.innerHTML=[
 '<h2>Mô hình 3D tương tác dựng riêng</h2>',
 '<p>Mô phỏng hình khối màn hình có thể xoay bằng tay, giúp hình dung góc đặt; đây không phải tệp CAD/3D gốc, không phản ánh kích thước hoặc cổng kết nối chính xác của UltraCar.</p>',
 '<div class="uc3d-stage" tabindex="0" role="img" aria-label="Mô hình màn hình minh họa xoay được. Dùng phím mũi tên hoặc kéo để xoay">',
 '<div class="uc3d-scene"><div class="uc3d-device"><div class="uc3d-front"><div class="uc3d-display"><span>ULTRACAR</span><small>Ảnh khối minh họa</small></div></div><div class="uc3d-back"></div><div class="uc3d-left"></div><div class="uc3d-right"></div><div class="uc3d-top"></div><div class="uc3d-bottom"></div></div></div>',
 '</div><div class="uc3d-actions"><span>Kéo để xoay / dùng phím mũi tên</span><button class="btn btn-outline" type="button" data-reset-3d>Đặt lại góc xem</button></div>'
 ].join('');
 article.appendChild(wrap);
 const stage=$('.uc3d-stage',wrap),device=$('.uc3d-device',wrap);
 let rotX=-9,rotY=-24,active=false,startX=0,startY=0,baseX=0,baseY=0;
 const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
 function update(){device.style.setProperty('--rx',rotX+'deg');device.style.setProperty('--ry',rotY+'deg');}
 update();
 stage.addEventListener('pointerdown',e=>{active=true;startX=e.clientX;startY=e.clientY;baseX=rotX;baseY=rotY;stage.setPointerCapture?.(e.pointerId);});
 stage.addEventListener('pointermove',e=>{if(!active)return;rotY=baseY+(e.clientX-startX)*0.4;rotX=clamp(baseX-(e.clientY-startY)*0.3,-75,75);update();});
 ['pointerup','pointercancel','lostpointercapture'].forEach(name=>stage.addEventListener(name,()=>{active=false;}));
 stage.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();rotY+=e.key==='ArrowLeft'?-8:e.key==='ArrowRight'?8:0;rotX=clamp(rotX+(e.key==='ArrowUp'?8:e.key==='ArrowDown'?-8:0),-75,75);update();});
 $('[data-reset-3d]',wrap).addEventListener('click',()=>{rotX=-9;rotY=-24;update();stage.focus();});
}
detailAddons();
})();