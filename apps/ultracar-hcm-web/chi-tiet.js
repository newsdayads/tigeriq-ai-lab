(() => {
'use strict';
const el=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(n);
const ref=new URLSearchParams(location.search);
const path=ref.get('page')||'';
const sku=ref.get('sku')||'';
const home='/#thu-vien';
const internal=p=>'/chi-tiet.html?page='+encodeURIComponent(p);
const GROUPS={'dong-xe':'Tư vấn theo xe','san-pham':'Sản phẩm','chinh-sach':'Thông tin chính sách','tin-tuc':'Kiến thức công nghệ','ho-tro':'Hỗ trợ','video':'Video hướng dẫn','trai-nghiem-3d':'Trải nghiệm sản phẩm'};
const productPhoto=sku=>{
 const path=window.ULTRACAR_MEDIA?.products?.[sku];
 return path&&/^(?:\/assets\/|\/api\/media\/)/.test(path)?'/assets/manufacturer'+path+(path.startsWith('/api/media/')?'.jpg':''):'';
};
const originalInfo={
 'dong-xe':{
  lead:'Chọn đúng kích thước màn hình, bộ xử lý và giá đỡ trước khi quyết định lắp.',
  info:'Tương thích phụ thuộc đời xe, phiên bản táp-lô, điểm cố định và vị trí nguồn. Danh sách cấu hình nêu tại trang này mang tính tham khảo; cần ảnh táp-lô để xác nhận bộ gá thực tế.'
 },
 'san-pham':{lead:'Đối chiếu thông số, phụ kiện kèm theo và chi phí lắp đặt trước khi chốt đơn.',info:'Giá là mức công khai tham khảo tại thời điểm đối chiếu; tình trạng hàng, giá và bảo hành cần được xác nhận trực tiếp.'},
 'chinh-sach':{lead:'Thông tin chính sách và các bước cần chuẩn bị khi yêu cầu hỗ trợ.',info:'Điều kiện bảo hành, đổi trả hoặc xử lý thông tin cá nhân phụ thuộc văn bản đang có hiệu lực và chứng từ mua bán. UltraCarHCM không tự thay thế hoặc cam kết chính sách của nhà sản xuất.'},
 'tin-tuc':{lead:'Kiến thức giúp lựa chọn cấu hình phù hợp không gian lái và nhu cầu sử dụng.',info:'Hãy ưu tiên an toàn, độ tương thích và vị trí lắp trước thông số; không xem video khi xe đang di chuyển.'},
 'other':{lead:'Thông tin tham khảo dành cho khách hàng UltraCarHCM.',info:'Nội dung được tóm lược để tiện tham khảo. Các nội dung kỹ thuật, điều kiện bán hàng và giấy phép ứng dụng cần kiểm tra trước khi sử dụng.'}
};
const lookup=(row,products)=>{
 const id=row.path.match(/\/san-pham\/p\/([^/]+)\//)?.[1];
 if(id)return products.find(x=>x.sku.toLowerCase()===id.toLowerCase())||null;
 return null;
};
function informativeDescription(row,ctx){
 const d=(row.description||'').trim();
 if(!d||/^Xem .+ tại UltraCar\.vn/i.test(d))return ctx.lead;
 return d.replace(/UltraCar\.vn/g,'UltraCar');
}
function paint(row,products,all,guides){
 const p=lookup(row,products);const ctx=originalInfo[row.group]||originalInfo.other;
 const title=(p?.name||row.title||row.path.split('/').filter(Boolean).pop()?.replace(/-/g,' ')||'Thông tin UltraCar').trim();
 const image=p?productPhoto(p.sku):(row.image&&/^\/assets\//.test(row.image)?'/assets/manufacturer'+row.image:'');
 const badge=GROUPS[row.group]||'Hướng dẫn';
 document.title=title+' | UltraCarHCM';
 el('pageCrumb').textContent=badge;
 let html='<span class="topic-tag">'+esc(badge)+'</span><h1>'+esc(title)+'</h1><p class="lead">'+esc(informativeDescription(row,ctx))+'</p>';
 if(image)html+='<img class="detail-cover" src="'+esc(image)+'" alt="'+esc(title)+'" loading="eager" decoding="async" />';
 if(p){
  html+='<p class="detail-price">'+money(p.price)+' <span style="font-size:12px;font-weight:500;color:#687996">Giá tham khảo</span></p>';
  const specs=[['Mã sản phẩm',p.sku],['Loại thiết bị',p.type],['Màn hình',p.screen],['Bộ xử lý',p.chip],['Bộ nhớ',p.memory],['Phụ kiện / đặc điểm',p.features]];
  html+='<h2>Thông số &amp; cấu hình</h2><table class="spec-table">'+specs.map(([a,b])=>'<tr><td>'+esc(a)+'</td><td>'+esc(b)+'</td></tr>').join('')+'</table>';
 }
 if(row.group==='dong-xe'){
  html+='<h2>Chọn cấu hình phù hợp</h2><p>Tùy vị trí lắp, có thể cân nhắc màn hình 13,3″ hoặc 16″; cấu hình riêng cần xác minh nguồn cấp và bộ giá đỡ. Anh/chị vui lòng gửi ảnh khoang lái và đời xe để tư vấn.</p>';
 }
 const guide=(guides?.guides||{})[row.path];
 if(guide){
  html+='<section class="dealer-guide"><span class="topic-tag">HƯỚNG DẪN ULTRACARHCM</span><h2>'+esc(guide.lead||'Hướng dẫn nhanh')+'</h2><ol class="dealer-guide-list">'+(guide.steps||[]).map(s=>'<li>'+esc(s)+'</li>').join('')+'</ol><p class="dealer-guide-hint">'+esc(guide.hint||'Kiểm tra cấu hình trước khi đặt.')+'</p></section>';
 }
 if(row.group==='video'||row.group==='trai-nghiem-3d'||row.group==='tvc'){
  const target=row.group==='trai-nghiem-3d'?'/#trai-nghiem':'/#video';
  html+='<p><a class="btn btn-primary" href="'+target+'">Mở trải nghiệm tại UltraCarHCM →</a></p>';
 }
 const headings=(row.headings||[]).filter(x=>x&&x.length<120).slice(0,5);
 if(headings.length){
  html+='<h2>Những nội dung cần tìm hiểu</h2><div class="detail-topics">'+headings.map(t=>'<div>'+esc(t)+'</div>').join('')+'</div>';
 }
 if(row.group==='chinh-sach'){
  html+='<h2>Chuẩn bị khi cần hỗ trợ</h2><p>Giữ lại hóa đơn, mã sản phẩm, ngày mua, ảnh hoặc video mô tả vấn đề. UltraCarHCM tiếp nhận thông tin ban đầu, hỗ trợ đối chiếu và xác minh điều kiện áp dụng.</p>';
 }else if(row.group==='dong-xe'){
  html+='<h2>Thông tin cần gửi để báo giá chính xác</h2><p>Hãng, dòng và đời xe; phiên bản táp-lô; ảnh vị trí lắp; nhu cầu DeX, định vị, camera; cấu hình và ngân sách dự kiến.</p>';
 }else if(row.group==='video'||row.group==='trai-nghiem-3d'||row.group==='tvc'){
  html+='<h2>Tư liệu trực quan</h2><p>Khám phá các video và trải nghiệm góc nhìn tương tác tại UltraCarHCM. Một số đoạn phim và góc quay được minh họa từ tư liệu hãng; yêu cầu ảnh đúng mã sản phẩm khi cần.</p>';
 }
 html+='<div class="detail-alert">'+esc(ctx.info)+'</div>';
 html+='<div class="detail-cta"><a class="btn btn-primary" href="https://zalo.me/0392960003" target="_blank" rel="noopener noreferrer">Gửi yêu cầu tư vấn</a><a class="btn btn-outline" href="'+home+'">Xem thêm trong thư viện</a></div>';
 html+='<p class="data-origin">Thông tin biên tập từ dữ liệu công khai được đối chiếu ngày 06/11/2026. Trang này thuộc UltraCarHCM; không phải bản sao đầy đủ nội dung nhà sản xuất.</p>';
 el('internalArticle').innerHTML=html;
 const related=all.filter(x=>x.group===row.group&&x.path!==row.path).slice(0,6);
 if(related.length){
  el('relatedSection').hidden=false;
  el('relatedGrid').innerHTML=related.map(x=>'<a class="related-card" href="'+internal(x.path)+'"><small>'+esc(GROUPS[x.group]||'Thông tin')+'</small><strong>'+esc(x.title||x.path.split('/').filter(Boolean).pop()||'Thông tin')+'</strong></a>').join('');
 }
}
function productBySku(sku,products){
 const p=products.find(x=>x.sku.toLowerCase()===sku.toLowerCase());if(!p)return null;
 return {path:'/san-pham/p/'+p.sku+'/',group:'san-pham',title:p.name,description:p.features,image:'',headings:['Thông số và cấu hình','Lựa chọn phụ kiện','Kiểm tra tương thích'],status:'verified'};
}
Promise.all([fetch('/source-details.json?v=20261106r4').then(x=>{if(!x.ok)throw Error('DATA_HTTP_'+x.status);return x.json()}),fetch('/products.json?v=20261106r4').then(x=>{if(!x.ok)throw Error('PRODUCT_HTTP_'+x.status);return x.json()}),fetch('/dealer-guides.json?v=20261106r5').then(x=>x.ok?x.json():{guides:{}})])
.then(([db,products,guides])=>{
 const rows=db.pages||[];
 const row=sku?productBySku(sku,products):rows.find(x=>x.path===path);
 if(!row){el('internalArticle').innerHTML='<h1>Không tìm thấy nội dung</h1><p>Vui lòng quay lại thư viện để chọn mục cần xem.</p><a class="btn btn-outline" href="'+home+'">Về thư viện</a>';return}
 paint(row,products,rows,guides);
}).catch(e=>{el('internalArticle').innerHTML='<h1>Tạm thời chưa tải được nội dung</h1><p>Vui lòng thử lại hoặc liên hệ hotline 0392 960 003.</p><a class="btn btn-outline" href="'+home+'">Về thư viện</a>';console.error('internal-content',e.message)});
})();