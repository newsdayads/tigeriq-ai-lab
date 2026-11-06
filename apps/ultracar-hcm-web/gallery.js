(()=>{
'use strict';
const $=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const root=$('ucGalleryGrid'),brand=$('ucGalleryBrand'),search=$('ucGallerySearch'),review=$('ucGalleryReview'),more=$('ucGalleryMore'),count=$('ucGalleryCount'),dlg=$('ucPhotoDialog'),photo=$('ucPhotoImg'),heading=$('ucPhotoTitle'),reviewBadge=$('ucPhotoReview');
if(!root||!brand||!search||!review||!more||!dlg)return;
let entries=[],filtered=[],visible=24,active=0;
const full=path=>path&&path.startsWith('/assets/')?'/assets/gallery'+path:'';
function paint(){
 const q=search.value.trim().toLocaleLowerCase('vi-VN'),b=brand.value,r=review.value;
 filtered=entries.filter(item=>(!b||item.brand===b)&&(!q||[item.title,item.brand,item.models].join(' ').toLocaleLowerCase('vi-VN').includes(q))&&(r==='all'||(r==='confirmed'?!item.review:item.review)));
 const current=filtered.slice(0,visible);
 root.innerHTML=current.map((item,index)=>'<button class="uc-gallery-card" type="button" data-index="'+index+'" aria-label="Phóng to ảnh '+escape(item.title)+'"><div class="uc-gallery-photo"><img src="'+escape(full(item.thumb||item.image))+'" loading="lazy" decoding="async" alt="'+escape(item.title)+'"/><span class="uc-gallery-zoom" aria-hidden="true">↗</span></div><div class="uc-gallery-info"><small>'+escape(item.brand||'Khác')+'</small><strong>'+escape(item.title)+'</strong>'+(item.review?'<span class="uc-gallery-review">Cần xác minh mẫu xe</span>':'')+'</div></button>').join('')||'<p class="uc-gallery-empty">Không tìm thấy ảnh phù hợp. Thử thay đổi hãng xe hoặc từ khóa.</p>';
 if(count)count.textContent='Đang xem '+current.length+' / '+filtered.length+' ảnh lắp đặt và sản phẩm';
 more.hidden=visible>=filtered.length;
 more.textContent='Xem thêm '+Math.min(24,filtered.length-visible)+' ảnh ↓';
}
function openPhoto(index){
 const item=filtered[index];if(!item)return;
 active=index;photo.src=full(item.image);photo.alt=item.title;
 heading.textContent=item.title;
 reviewBadge.hidden=!item.review;
 reviewBadge.textContent=item.review?'Ảnh chưa xác nhận chính xác mẫu xe / đời xe; chỉ tham khảo trước khi đặt.':'Ảnh tư liệu hãng – vui lòng đối chiếu đời xe khi tư vấn.';
 if(!dlg.open)dlg.showModal();
}
function move(step){if(!filtered.length)return;openPhoto((active+step+filtered.length)%filtered.length)}
root.addEventListener('click',e=>{const card=e.target.closest('[data-index]');if(card)openPhoto(Number(card.dataset.index))});
brand.addEventListener('change',()=>{visible=24;paint()});
review.addEventListener('change',()=>{visible=24;paint()});
search.addEventListener('input',()=>{visible=24;paint()});
more.addEventListener('click',()=>{visible+=24;paint()});
$('ucPhotoClose')?.addEventListener('click',()=>dlg.close());
$('ucPhotoPrev')?.addEventListener('click',()=>move(-1));
$('ucPhotoNext')?.addEventListener('click',()=>move(1));
dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close()});
dlg.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}else if(e.key==='ArrowRight'){e.preventDefault();move(1)}});
dlg.addEventListener('close',()=>{photo.removeAttribute('src')});
fetch('/gallery.json?v=20261106r6').then(r=>{if(!r.ok)throw Error('gallery '+r.status);return r.json()}).then(data=>{
 entries=(data.entries||[]).filter(item=>item.image&&item.thumb);
 const brands=[...new Set(entries.map(x=>x.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'vi'));
 brand.innerHTML='<option value="">Tất cả hãng xe</option>'+brands.map(b=>'<option value="'+escape(b)+'">'+escape(b)+'</option>').join('');
 if($('ucGalleryTotal'))$('ucGalleryTotal').textContent=String(entries.length);
 paint();
}).catch(()=>{root.innerHTML='<p class="uc-gallery-empty">Thư viện hình ảnh tạm thời chưa khả dụng. Liên hệ 0392 960 003 để xem ảnh lắp đặt theo dòng xe.</p>';more.hidden=true});
})();