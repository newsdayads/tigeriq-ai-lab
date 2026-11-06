(()=>{
'use strict';
const $=id=>document.getElementById(id);
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const on=(el,event,fn,opts)=>el&&el.addEventListener(event,fn,opts);
const escape=s=>String(s||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const ownerPhone='0392960003';
const mediaRoot='/assets/manufacturer';
const clipList=[
{id:'dex-five-apps',name:'5 ứng dụng trên một màn hình',group:'ỨNG DỤNG',poster:mediaRoot+'/assets/hero/ultracar-cockpit-1600.webp',desc:'Quan sát cách bố trí ứng dụng và bản đồ trên Samsung DeX.'},
{id:'magnetic-mount',name:'Kết nối nam châm & Pogo PIN',group:'CẤU TẠO',poster:mediaRoot+'/assets/models/ultracar-13-3-front.webp',desc:'Tìm hiểu cơ chế gắn màn hình và tiếp điểm nguồn.'},
{id:'reverse-camera',name:'Camera lùi trên màn hình UltraCar',group:'CAMERA',poster:mediaRoot+'/assets/screen-front.png',desc:'Xem tình huống chuyển sang góc nhìn phía sau xe.'},
{id:'sliding-screen',name:'Cơ cấu trượt ngang màn hình',group:'GIẢI PHÁP',poster:mediaRoot+'/assets/models/ultracar-13-3-front.webp',desc:'Minh họa khả năng bố trí màn hình thêm trong khoang lái.'},
{id:'installation-demo',name:'Hướng dẫn vị trí và cách lắp',group:'LẮP ĐẶT',poster:mediaRoot+'/assets/product-guides/combo-vf5.webp',desc:'Tham khảo quy trình thử và kiểm tra bộ gá.'},
{id:'screen-walkaround',name:'Chi tiết màn hình nhìn nhiều góc',group:'SẢN PHẨM',poster:mediaRoot+'/assets/ultracar-16-inch.png',desc:'Xem các cạnh và kết cấu màn hình.'},
{id:'touch-controls',name:'Trải nghiệm thao tác cảm ứng',group:'THAO TÁC',poster:mediaRoot+'/assets/screen-front.png',desc:'Quan sát thao tác trực tiếp với giao diện UltraCar.'},
{id:'customer-review',name:'Trải nghiệm khách hàng',group:'TRẢI NGHIỆM',poster:mediaRoot+'/assets/product-guides/minio-integrated.webp',desc:'Tư liệu hình ảnh và trải nghiệm sử dụng do hãng công bố.'}
];
const progress=$('ucProgress');
if(progress){
 let ticking=false;
 on(window,'scroll',()=>{if(ticking)return;ticking=true;requestAnimationFrame(()=>{const max=document.documentElement.scrollHeight-innerHeight;progress.style.width=(max>0?Math.min(100,Math.max(0,scrollY/max*100)):0)+'%';ticking=false;})},{passive:true});
}
const reveals=document.querySelectorAll('[data-reveal]');
if(!reduced&&'IntersectionObserver'in window){
 document.body.classList.add('uc-effects');
 const observer=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');observer.unobserve(e.target)}})},{threshold:.07,rootMargin:'0px 0px -36px 0px'});
 reveals.forEach(x=>observer.observe(x));
}else reveals.forEach(x=>x.classList.add('is-visible'));
const hero=document.querySelector('.hero-visual');
if(hero&&!reduced&&window.matchMedia('(pointer:fine)').matches){
 on(hero,'pointermove',e=>{const b=hero.getBoundingClientRect(),nx=(e.clientX-b.left)/b.width-.5,ny=(e.clientY-b.top)/b.height-.5;hero.style.transform='perspective(1100px) rotateY('+(-6+nx*9)+'deg) rotateX('+(3-ny*8)+'deg)'});
 on(hero,'pointerleave',()=>{hero.style.transform='perspective(1100px) rotateY(-6deg) rotateX(3deg)'});
}
const stage=$('holoStage'),holoImage=$('holoImage'),range=$('holoRotation'),spin=$('holoAuto');
const presets={13:mediaRoot+'/assets/models/ultracar-13-3-front.webp',16:mediaRoot+'/assets/screen-front.png'};
let auto=false,dragging=false,startX=0,startAngle=-13;
const showRotation=angle=>{const x=Math.max(-28,Math.min(28,Number(angle)));if(stage)stage.style.setProperty('--uc-y',x+'deg');if(range)range.value=String(x);if($('holoAngle'))$('holoAngle').textContent=(x>0?'+':'')+x+'°';return x};
on(range,'input',v=>{if(auto)toggleAuto(false);showRotation(v.target.value)});
document.querySelectorAll('[data-holo-angle]').forEach(b=>on(b,'click',()=>{if(auto)toggleAuto(false);showRotation(b.dataset.holoAngle);document.querySelectorAll('[data-holo-angle]').forEach(c=>c.setAttribute('aria-pressed',String(c===b)))}));
document.querySelectorAll('[data-holo-size]').forEach(b=>on(b,'click',()=>{
 const key=b.dataset.holoSize;if(!presets[key])return;
 holoImage.src=presets[key];holoImage.alt='Hình ảnh UltraCar nhóm '+(key==='16'?'16':'13,3')+' inch';
 document.querySelectorAll('[data-holo-size]').forEach(c=>c.setAttribute('aria-pressed',String(c===b)));
 if($('holoSizeValue'))$('holoSizeValue').textContent=(key==='16'?'16 inch':'13,3 inch');
}));
function toggleAuto(value){auto=!!value;stage?.classList.toggle('is-auto',auto);if(spin){spin.textContent=auto?'Dừng tự xoay':'Tự xoay';spin.setAttribute('aria-pressed',String(auto));}}
on(spin,'click',()=>toggleAuto(!auto));
if(stage){
 on(stage,'pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;if(auto)toggleAuto(false);dragging=true;startX=e.clientX;startAngle=Number(range?.value||0);stage.setPointerCapture?.(e.pointerId)});
 on(stage,'pointermove',e=>{if(dragging){showRotation(startAngle+(e.clientX-startX)/3)}});
 on(stage,'pointerup',()=>{dragging=false});on(stage,'pointercancel',()=>{dragging=false});
 on(stage,'keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();if(auto)toggleAuto(false);showRotation(Number(range?.value||0)+(e.key==='ArrowRight'?4:-4))}});
}
const grid=$('ucVideoGrid'),dlg=$('ucVideoDialog'),player=$('ucVideoPlayer');
if(grid){
 grid.innerHTML=clipList.map((v,i)=>'<button type="button" class="video-card" data-uc-video="'+escape(v.id)+'" aria-label="Phát video '+escape(v.name)+'"><div class="video-thumb"><img loading="lazy" decoding="async" src="'+escape(v.poster)+'" alt="Tư liệu '+escape(v.name)+'"/><span class="video-type">'+escape(v.group)+'</span><span class="video-play" aria-hidden="true">▶</span></div><strong>'+escape(v.name)+'</strong><small>Phát tại UltraCarHCM · '+String(i+1).padStart(2,'0')+'</small></button>').join('');
 on(grid,'click',e=>{const b=e.target.closest('[data-uc-video]');if(!b||!dlg||!player)return;const entry=clipList.find(x=>x.id===b.dataset.ucVideo);if(!entry)return;
 $('ucVideoTitle').textContent=entry.name;$('ucVideoDesc').textContent=entry.desc;
 player.src='/assets/motion/'+entry.id+'.mp4';player.poster=entry.poster;player.currentTime=0;
 try{dlg.showModal()}catch{dlg.setAttribute('open','')}
 player.play().catch(()=>{});
 });
}
function closeVideo(){if(player){player.pause();player.removeAttribute('src');player.load()}if(dlg?.open)dlg.close()}
on($('ucVideoClose'),'click',closeVideo);
on(dlg,'click',e=>{if(e.target===dlg)closeVideo()});
on(dlg,'cancel',e=>{e.preventDefault();closeVideo()});
const ownerPhoneEls=document.querySelectorAll('[data-owner-phone]');
ownerPhoneEls.forEach(x=>{x.textContent='0392 960 003';x.href='tel:+84'+ownerPhone.slice(1)});
})();