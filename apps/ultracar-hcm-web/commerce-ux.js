/* UltraCarHCM premium mobile commerce UX — clear cart -> checkout, scroll feedback. */
(()=>{
'use strict';
const $=s=>document.querySelector(s);
const drawer=$('#cartDrawer'),review=$('#ucCartReview'),checkout=$('#ucCheckoutStep');
if(!drawer||!review||!checkout)return;
const count=$('#cartCount'),next=$('#ucProceedCheckout'),back=$('#ucBackToCart'),close=$('#cartClose');
const summary=$('#ucCheckoutSummary'),title=$('#cartTitle'),subtitle=$('#ucCartSubtitle'),eyebrow=$('#ucCartEyebrow');
const number=()=>Math.max(0,Number(count?.textContent)||0);
const money=()=>$('#cartTotal')?.textContent||'0 đ';
let step='review';
function update(){
 const n=number(),subtotal=money();
 next.disabled=!n;
 next.textContent=n?'Tiến hành đặt hàng ('+n+') →':'Thêm sản phẩm để đặt hàng';
 const text=n+' sản phẩm · '+subtotal;
 summary.replaceChildren();
 const left=document.createElement('span');left.textContent='Giỏ hàng · '+n+' sản phẩm';
 const right=document.createElement('strong');right.textContent=subtotal;
 summary.append(left,right);
 review.querySelector('.uc-step-chip').textContent=n?'ĐÃ CÓ '+n+' SẢN PHẨM TRONG GIỎ':'GIỎ HÀNG ĐANG TRỐNG';
}
function go(to){
 step=to==='checkout'?'checkout':'review';
 const isCheckout=step==='checkout';
 review.hidden=isCheckout;checkout.hidden=!isCheckout;
 drawer.dataset.step=step;
 title.textContent=isCheckout?'Thông tin đặt hàng':'Giỏ hàng của bạn';
 eyebrow.textContent=isCheckout?'BƯỚC 2 / 2 · ĐẶT HÀNG':'BƯỚC 1 / 2 · GIỎ HÀNG';
 subtitle.textContent=isCheckout?'Nhập thông tin để gửi yêu cầu đặt hàng.':'Kiểm tra sản phẩm trước khi đặt.';
 if(isCheckout)checkout.scrollTop=0;else review.scrollTop=0;
 update();
}
next.addEventListener('click',()=>{if(number())go('checkout')});
back.addEventListener('click',()=>go('review'));
$('#ucContinueShopping').addEventListener('click',()=>close.click());
new MutationObserver(()=>{if(!drawer.hidden)go('review')}).observe(drawer,{attributes:true,attributeFilter:['hidden']});
if(count)new MutationObserver(update).observe(count,{subtree:true,childList:true,characterData:true});
$('#cartItems').addEventListener('click',()=>queueMicrotask(update));
window.addEventListener('ultracar:cart-added',e=>{
 update();
 const sku=e.detail?.sku;
 if(!sku)return;
 const all=document.querySelectorAll('.add-btn[data-add]');
 for(const button of all){
  if(button.getAttribute('data-add')!==sku)continue;
  button.classList.add('uc-added');
  button.textContent='Đã thêm ✓';
  window.setTimeout(()=>{
   if(button.isConnected){button.classList.remove('uc-added');button.textContent='Thêm giỏ hàng'}
  },1100);
 }
});
window.addEventListener('ultracar:order-saved',()=>{update();drawer.dataset.step='confirmed';title.textContent='Đã ghi nhận đơn hàng';eyebrow.textContent='ĐƠN CHỜ XÁC NHẬN';subtitle.textContent='Kiểm tra mã đơn và phương thức thanh toán bên dưới.'});
update();
/* Performance: only animate off-screen elements when they become visible.
 * On reduced-motion systems, show everything instantly. */
const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;
if(!reduce&&'IntersectionObserver'in window){
 const seen=new WeakSet();
 const io=new IntersectionObserver(entries=>{
  for(const e of entries){
   if(!e.isIntersecting)continue;
   e.target.classList.add('uc-revealed');
   io.unobserve(e.target);
  }
 },{rootMargin:'0px 0px 70px 0px',threshold:.06});
 let index=0;
 function discover(scope=document){
  const selector='.section-heading,.product-card,.compare-card,.media-tile,.uc-video-card,.uc-terms-card,.vehicle-card,.trust-grid>div,.bottom-cta h2';
  for(const el of scope.querySelectorAll(selector)){
   if(seen.has(el))continue;
   seen.add(el);
   el.style.setProperty('--uc-reveal-delay',((index++%4)*50)+'ms');
   el.classList.add('uc-reveal-ready');
   io.observe(el);
  }
 }
 discover();
 for(const selector of ['#productGrid','#sourceGrid','#thu-vien','.uc-video-grid','.uc-terms-grid']){
  const el=$(selector);if(!el)continue;
  new MutationObserver(()=>discover(el)).observe(el,{childList:true,subtree:true});
 }
}
/* Subtle page-position indicator; updated via one requestAnimationFrame per frame. */
const progress=document.createElement('div');progress.className='uc-scroll-progress';progress.setAttribute('aria-hidden','true');document.body.appendChild(progress);
let busy=false;
function updateProgress(){
 busy=false;
 const doc=document.documentElement,max=Math.max(0,doc.scrollHeight-innerHeight);
 const value=max?Math.min(1,Math.max(0,scrollY/max)):0;
 progress.style.transform='scaleX('+value.toFixed(4)+')';
 progress.style.opacity=document.body.classList.contains('lock')?'0':'1';
}
function schedule(){if(busy)return;busy=true;requestAnimationFrame(updateProgress)}
window.addEventListener('scroll',schedule,{passive:true});
window.addEventListener('resize',schedule,{passive:true});
new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
schedule();
})();