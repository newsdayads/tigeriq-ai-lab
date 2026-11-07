/* UltraCarHCM original showroom: factual highlights and product comparison, 07/11/2026. */
(function(){
'use strict';
var products=Array.isArray(window.ULTRACAR_PRODUCTS)?window.ULTRACAR_PRODUCTS:[];
var media=window.ULTRACAR_MEDIA||{};
var query=function(s){return document.querySelector(s);};
var clean=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
var money=function(n){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(n);};
var before=query('#hinh-anh');
if(!before||!before.parentNode||!products.length)return;
var section=document.createElement('section');
section.id='trai-nghiem';section.className='uc-experience section';
section.setAttribute('aria-label','Khám phá và so sánh sản phẩm UltraCarHCM');
section.innerHTML=[
'<div class="container">',
'<div class="uc-head uc-reveal"><div><span class="kicker">HIỂU RÕ TRƯỚC KHI NÂNG CẤP</span><h2>Không chỉ là màn hình.<br><em>Là trải nghiệm dành riêng cho xe bạn.</em></h2><p>Khám phá cấu hình, phụ kiện và các bước chọn thiết bị. Dữ liệu biên tập từ danh mục công khai của UltraCar, không thay cho xác nhận kỹ thuật theo xe.</p></div><a class="uc-head-link" href="#danh-muc">Xem toàn bộ '+products.length+' mã →</a></div>',
'<div class="uc-benefits uc-reveal">',
'<a href="/chi-tiet.html?page=%2Fsan-pham%2F" class="uc-benefit"><span class="uc-benefit-index">01 / HIỂN THỊ</span><strong>13,3″ FHD hoặc 16″ 2.5K</strong><p>Màn 13,3″ có cấu hình 60Hz; mẫu 16″ công bố 144Hz. Chọn theo khoang lái và cách bố trí.</p><span>Khám phá màn hình →</span></a>',
'<a href="/chi-tiet.html?page=%2Fcam-lui%2F" class="uc-benefit"><span class="uc-benefit-index">02 / HỖ TRỢ LÙI</span><strong>Camera lùi & bộ chuyển đổi</strong><p>Kiểm tra cổng kết nối, hiển thị khi vào số lùi và công lắp thực tế trước khi đặt.</p><span>Xem giải pháp camera →</span></a>',
'<a href="/chi-tiet.html?page=%2Fphu-kien%2F" class="uc-benefit"><span class="uc-benefit-index">03 / SỬ DỤNG LINH HOẠT</span><strong>Pin rời 20.000mAh · 45W</strong><p>Hãng giới thiệu nguồn rời cho một số màn hình. Cần xác minh pin, tiếp điểm và phụ kiện tương thích.</p><span>Tìm hiểu phụ kiện →</span></a>',
'<a href="/chi-tiet.html?page=%2Fung-dung%2F" class="uc-benefit"><span class="uc-benefit-index">04 / SAMSUNG DeX</span><strong>Ứng dụng chia bố cục</strong><p>Cần điện thoại hỗ trợ Samsung DeX và phiên bản One UI tương thích. Dùng giải trí khi xe đã dừng.</p><span>Tìm hiểu ứng dụng →</span></a>',
'</div>',
'<div class="uc-showcase uc-reveal"><div class="uc-showcase-media"><img id="ucSlide" src="/assets/manufacturer/assets/hero/ultracar-cockpit-1600.webp" alt="Màn hình UltraCar trong khoang lái" decoding="async" loading="lazy"/><div class="uc-image-shine" aria-hidden="true"></div><div class="uc-picture-label">Ảnh minh họa công khai của hãng</div></div><div class="uc-showcase-copy"><span class="kicker">GÓC NHÌN THỰC TẾ</span><div class="uc-slide-count" id="ucSlideCount">01 / 04</div><h3 id="ucSlideTitle">UltraCar trong khoang lái</h3><p id="ucSlideDesc">Cách bố trí màn hình UltraCar bên cạnh hệ thống nguyên bản.</p><div class="uc-slide-control"><button type="button" id="ucPrev" aria-label="Hình trước">←</button><button type="button" id="ucNext" aria-label="Hình tiếp theo">→</button></div><p class="uc-showcase-note">Hình ảnh chỉ minh họa; giá đỡ cần đối chiếu theo dòng và đời xe.</p></div></div>',
'<div class="uc-compare uc-reveal" id="so-sanh"><div class="uc-compare-header"><div><span class="kicker">CÔNG CỤ TƯ VẤN</span><h2>So sánh cấu hình trong vài giây.</h2><p>Đối chiếu các mã sản phẩm ngay tại UltraCarHCM; giá chỉ là tham khảo.</p></div><span class="uc-compare-tag">Danh mục '+products.length+' mã</span></div>',
'<div class="uc-compare-select"><label for="ucCompareA">Sản phẩm thứ nhất<select id="ucCompareA"></select></label><span aria-hidden="true" class="uc-compare-vs">VS</span><label for="ucCompareB">Sản phẩm thứ hai<select id="ucCompareB"></select></label></div><div id="ucCompareResult" aria-live="polite"></div><div class="uc-footnote">Tồn kho, giá bán thực tế, phí lắp, điều kiện bảo hành và ưu đãi mua kèm cần xác nhận qua UltraCarHCM trước giao dịch.</div></div>',
'<div class="uc-journey uc-reveal"><span class="kicker">CHỌN ĐÚNG, TRÁNH MUA NHẦM</span><h2>Ba bước chọn cấu hình phù hợp.</h2><div class="uc-journey-grid"><div><b>01</b><strong>Gửi thông tin xe</strong><p>Hãng, dòng, đời xe, ảnh táp-lô và vị trí dự kiến lắp.</p></div><div><b>02</b><strong>Đối chiếu thiết bị</strong><p>Kích thước, bộ xử lý, DeX, giá đỡ, camera và nguồn.</p></div><div><b>03</b><strong>Nhận báo giá xác nhận</strong><p>Giá cuối cùng, phụ kiện, thời gian lắp và bảo hành.</p></div></div><a href="https://zalo.me/0392960003" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Nhắn UltraCarHCM để chọn bộ phù hợp →</a></div>',
'</div>'
].join('');
before.parentNode.insertBefore(section,before);
var gallery=(Array.isArray(media.gallery)?media.gallery:[]).filter(function(x){return typeof x.src==='string'&&/^\/assets\//.test(x.src);}).slice(0,6);
var index=0;
function showSlide(i){
 if(!gallery.length)return;
 index=(i+gallery.length)%gallery.length;
 var g=gallery[index],img=query('#ucSlide');
 img.src='/assets/manufacturer'+g.src;
 img.alt=g.desc||g.title;
 query('#ucSlideTitle').textContent=g.title;
 query('#ucSlideDesc').textContent=g.desc;
 query('#ucSlideCount').textContent=String(index+1).padStart(2,'0')+' / '+String(gallery.length).padStart(2,'0');
}
query('#ucPrev').addEventListener('click',function(){showSlide(index-1);});
query('#ucNext').addEventListener('click',function(){showSlide(index+1);});
showSlide(0);
var options=products.map(function(p){return '<option value="'+clean(p.sku)+'">'+clean(p.sku+' · '+p.name)+'</option>';}).join('');
var a=query('#ucCompareA'),b=query('#ucCompareB');
a.innerHTML=options;b.innerHTML=options;
a.value=products.some(function(p){return p.sku==='T13PCB';})?'T13PCB':products[0].sku;
b.value=products.some(function(p){return p.sku==='T16PCB';})?'T16PCB':products[Math.min(1,products.length-1)].sku;
function compare(){
 var p=products.find(function(x){return x.sku===a.value;}),q=products.find(function(x){return x.sku===b.value;});
 if(!p||!q)return;
 var fields=[['Giá tham khảo',money(p.price),money(q.price)],['Màn hình',p.screen,q.screen],['Bộ xử lý',p.chip,q.chip],['Bộ nhớ',p.memory,q.memory],['Loại',p.type,q.type],['Đặc điểm',p.features,q.features]];
 query('#ucCompareResult').innerHTML='<div class="uc-compare-titles"><strong>'+clean(p.name)+'</strong><strong>'+clean(q.name)+'</strong></div><div class="uc-comparison-scroll"><table class="uc-comparison-table"><tbody>'+fields.map(function(row){return '<tr><th scope="row">'+clean(row[0])+'</th><td>'+clean(row[1])+'</td><td>'+clean(row[2])+'</td></tr>';}).join('')+'</tbody></table></div><div class="uc-compare-actions"><a href="/chi-tiet.html?sku='+encodeURIComponent(p.sku)+'">Chi tiết '+clean(p.sku)+' →</a><a href="/chi-tiet.html?sku='+encodeURIComponent(q.sku)+'">Chi tiết '+clean(q.sku)+' →</a></div>';
}
a.addEventListener('change',compare);b.addEventListener('change',compare);compare();
var progress=document.createElement('div');
progress.className='uc-page-progress';progress.setAttribute('aria-hidden','true');document.body.appendChild(progress);
var ticking=false;
function onScroll(){
 if(ticking)return;ticking=true;
 requestAnimationFrame(function(){
  var denom=document.documentElement.scrollHeight-innerHeight;
  progress.style.transform='scaleX('+(denom>0?Math.max(0,Math.min(1,scrollY/denom)):0)+')';
  ticking=false;
 });
}
addEventListener('scroll',onScroll,{passive:true});onScroll();
if('IntersectionObserver' in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
 var observer=new IntersectionObserver(function(entries){
  entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('uc-in');observer.unobserve(entry.target);}});
 },{threshold:.07,rootMargin:'0px 0px -18px 0px'});
 section.querySelectorAll('.uc-reveal').forEach(function(el){observer.observe(el);});
 section.classList.add('uc-animated');
}
})();