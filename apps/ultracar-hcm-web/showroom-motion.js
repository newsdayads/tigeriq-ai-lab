/* UltraCarHCM premium interaction layer, 08/11/2026.
   Uses existing Owner/logo/media, no new external SDK, reduced-motion and keyboard support. */
(()=>{
'use strict';
const hero=document.querySelector('.hero');
const visual=hero?.querySelector('.hero-visual');
const photo=visual?.querySelector('img');
if(!hero||!visual||!photo)return;
const features=[
 {key:'screen',title:'Màn hình 13,3″ & 16″',body:'Chọn kích thước theo khoảng trống táp-lô, góc nhìn và nhu cầu sử dụng. Thông số phụ thuộc mã sản phẩm.',href:'/chi-tiet.html?page=%2Fman-hinh%2F',label:'Màn hình',x:43,y:37},
 {key:'dex',title:'Đa nhiệm với Samsung DeX',body:'Sắp xếp bản đồ và ứng dụng trên điện thoại Samsung hỗ trợ DeX. Kiểm tra model và phiên bản trước khi chọn.',href:'/chi-tiet.html?page=%2Fung-dung%2F',label:'DeX',x:75,y:49},
 {key:'camera',title:'Kết nối camera phù hợp',body:'Có giải pháp camera lùi theo bộ chuyển đổi và cấu hình. Cần xác nhận khả năng tương thích với xe và màn hình.',href:'/chi-tiet.html?page=%2Fcam-lui%2F',label:'Camera',x:25,y:66},
 {key:'mount',title:'Giá đỡ theo dòng xe',body:'Đối chiếu đời xe, vị trí lắp, nguồn điện và khoảng trượt trước khi đặt. Không mặc định mọi xe dùng chung một bộ gá.',href:'/chi-tiet.html?page=%2Fgia-do%2F',label:'Giá đỡ',x:63,y:78}
];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rm=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;
const shot=document.createElement('div');shot.className='uc-cinema-shot';
photo.parentNode.insertBefore(shot,photo);shot.appendChild(photo);
const layer=document.createElement('div');layer.className='uc-hotspot-layer';
layer.setAttribute('role','group');layer.setAttribute('aria-label','Các tính năng UltraCar — chọn điểm sáng để xem');
shot.appendChild(layer);
const marker=document.createElement('span');marker.className='uc-cinema-caption';marker.textContent='CHẠM ĐIỂM SÁNG ĐỂ KHÁM PHÁ';shot.appendChild(marker);
const description=document.createElement('div');description.className='uc-hotspot-info';description.id='ucHotspotInfo';
description.innerHTML='<div><small class="uc-hotspot-index">KHÁM PHÁ TÍNH NĂNG 01 / 04</small><strong id="ucHotspotHeading"></strong><p id="ucHotspotText"></p></div><a class="uc-hotspot-link" id="ucHotspotLink" href="/chi-tiet.html?page=%2Fman-hinh%2F">Xem chi tiết <span aria-hidden="true">→</span></a>';
visual.appendChild(description);
let selected=-1;
const buttons=features.map((f,i)=>{
 const button=document.createElement('button');
 button.type='button';button.className='uc-hotspot';button.dataset.index=String(i);
 button.style.left=f.x+'%';button.style.top=f.y+'%';
 button.setAttribute('aria-controls','ucHotspotInfo');button.setAttribute('aria-label','Xem tính năng '+f.title);
 button.setAttribute('aria-pressed','false');button.innerHTML='<span class="uc-hotspot-core" aria-hidden="true"></span><span class="uc-hotspot-name">'+esc(f.label)+'</span>';
 layer.appendChild(button);return button;
});
const title=description.querySelector('#ucHotspotHeading'),text=description.querySelector('#ucHotspotText'),link=description.querySelector('#ucHotspotLink'),count=description.querySelector('.uc-hotspot-index');
function activate(i){
 if(i<0||i>=features.length)return;
 selected=i;const f=features[i];
 title.textContent=f.title;text.textContent=f.body;link.href=f.href;
 count.textContent='KHÁM PHÁ TÍNH NĂNG '+String(i+1).padStart(2,'0')+' / 04';
 buttons.forEach((b,j)=>b.setAttribute('aria-pressed',String(j===i)));
}
layer.addEventListener('click',e=>{
 const button=e.target.closest('.uc-hotspot');
 if(!button)return;activate(Number(button.dataset.index));
});
layer.addEventListener('keydown',e=>{
 if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(e.key))return;
 e.preventDefault();
 const index=(Number(e.target.closest('.uc-hotspot')?.dataset.index)||0);
 const next=(index+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:features.length-1))%features.length;
 activate(next);buttons[next].focus();
});
activate(0);
if(!rm){
 requestAnimationFrame(()=>hero.classList.add('uc-cinematic'));
 if(window.matchMedia?.('(hover:hover) and (pointer:fine) and (min-width:1025px)').matches){
  let pending=false,px=0,py=0;
  function apply(){pending=false;visual.style.setProperty('--uc-tilt-x',(3-py*4).toFixed(2)+'deg');visual.style.setProperty('--uc-tilt-y',(-6+px*5).toFixed(2)+'deg');}
  hero.addEventListener('pointermove',e=>{
    const rect=hero.getBoundingClientRect();
    px=Math.max(-1,Math.min(1,((e.clientX-rect.left)/rect.width-.5)*2));
    py=Math.max(-1,Math.min(1,((e.clientY-rect.top)/rect.height-.5)*2));
    if(!pending){pending=true;requestAnimationFrame(apply);}
  },{passive:true});
  hero.addEventListener('pointerleave',()=>{
    px=0;py=0;
    visual.style.removeProperty('--uc-tilt-x');
    visual.style.removeProperty('--uc-tilt-y');
  },{passive:true});
 }
}
/* A small, functional mobile consultation dock; don't obscure a modal/cart. */
const dock=document.createElement('nav');dock.id='ucMobileDock';dock.className='uc-mobile-dock';
dock.setAttribute('aria-label','Thao tác nhanh khi xem UltraCarHCM');
const icon=(kind)=>({
 catalog:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
 cart:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4A2 2 0 0 0 9.7 16H20a2 2 0 0 0 2-1.7l1-7H6"/></svg>',
 chat:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9 8.38 8.38 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8v.5Z"/></svg>'
})[kind];
dock.innerHTML='<a href="#danh-muc" class="uc-dock-item">'+icon('catalog')+'<span>Sản phẩm</span></a><button type="button" class="uc-dock-item" id="ucDockCart">'+icon('cart')+'<span>Giỏ hàng</span><b id="ucDockCartCount" hidden></b></button><a href="https://zalo.me/0392960003" class="uc-dock-item uc-dock-primary" target="_blank" rel="noopener noreferrer">'+icon('chat')+'<span>Nhắn Zalo</span></a>';
document.body.appendChild(dock);
const cart=document.querySelector('#cartToggle'),cartCount=document.querySelector('#cartCount'),cartBadge=dock.querySelector('#ucDockCartCount');
dock.querySelector('#ucDockCart').addEventListener('click',()=>cart?.click());
function updateCartCount(){
 const n=Number(cartCount?.textContent||0);cartBadge.hidden=!n;cartBadge.textContent=n>99?'99+':String(n);
}
updateCartCount();
if(cartCount&&'MutationObserver'in window)new MutationObserver(updateCartCount).observe(cartCount,{childList:true,characterData:true,subtree:true});
let heroVisible=true;
function dockUpdate(){
 const width=window.matchMedia?.('(max-width:650px)').matches;
 const open=document.body.classList.contains('lock')||document.querySelector('#mobileNav')?.hidden===false;
 const show=!!width&&!heroVisible&&!open;
 dock.classList.toggle('uc-dock-show',show);
 document.body.classList.toggle('uc-dock-visible',show);
}
if('IntersectionObserver'in window){
 const obs=new IntersectionObserver(entries=>{heroVisible=entries[0].isIntersecting;dockUpdate();},{threshold:.08});
 obs.observe(hero);
}else{const onScroll=()=>{heroVisible=window.scrollY<Math.max(300,hero.offsetHeight*.7);dockUpdate();};window.addEventListener('scroll',onScroll,{passive:true});onScroll();}
const bodyWatch=new MutationObserver(dockUpdate);bodyWatch.observe(document.body,{attributes:true,attributeFilter:['class']});
const mobileMenu=document.querySelector('#mobileMenu');mobileMenu?.addEventListener('click',()=>requestAnimationFrame(dockUpdate));
dock.querySelector('a[href="#danh-muc"]').addEventListener('click',()=>{dockUpdate();});
window.addEventListener('resize',dockUpdate,{passive:true});dockUpdate();
})();
