/* UltraCarHCM order checkout: PC01 receipt + manual bank reconciliation. */
(()=>{
'use strict';
const $=s=>document.querySelector(s),root=$('#ucCheckout');if(!root)return;
const catalog=Array.isArray(window.ULTRACAR_PRODUCTS)?window.ULTRACAR_PRODUCTS:[];
const products=new Map(catalog.map(p=>[p.sku,p])),account='0967360003';
const money=n=>new Intl.NumberFormat('vi-VN').format(n)+' đ';
const items=()=>{try{const a=JSON.parse(localStorage.getItem('ultracarhcm_cart_v1')||'[]');return Array.isArray(a)?a.filter(x=>Array.isArray(x)&&products.has(x[0])&&Number.isInteger(x[1])&&x[1]>0&&x[1]<=99).map(([sku,qty])=>({p:products.get(sku),qty})):[]}catch{return []}};
root.innerHTML=[
'<form id="ucOrderForm" class="uc-order-form" novalidate>',
'<div class="uc-order-steps"><span><b>1</b> Giỏ hàng</span><span><b>2</b> Thông tin</span><span><b>3</b> Xác nhận</span></div>',
'<h3>Thông tin đặt hàng</h3>',
'<p class="uc-order-hint">UltraCarHCM tiếp nhận đơn và xác nhận tồn kho, phí giao/lắp và giá cuối trước thanh toán.</p>',
'<label for="ucPhone">Số điện thoại *</label><input id="ucPhone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="09xxxxxxxx" required>',
'<label for="ucAddress">Địa chỉ giao hàng / lắp đặt *</label><textarea id="ucAddress" autocomplete="street-address" maxlength="400" rows="2" placeholder="Số nhà, đường, phường/xã, tỉnh/thành phố" required></textarea>',
'<label for="ucNote">Ghi chú</label><textarea id="ucNote" maxlength="300" rows="2" placeholder="Đời xe, giờ giao, yêu cầu lắp đặt..."></textarea>',
'<fieldset class="uc-order-pay"><legend>Thanh toán dự kiến</legend>',
'<label class="uc-pay-option"><input type="radio" name="ucPay" value="cod" checked><span><strong>Thanh toán khi nhận hàng (COD)</strong><small>Tùy khu vực và cần cửa hàng xác nhận hỗ trợ.</small></span></label>',
'<label class="uc-pay-option"><input type="radio" name="ucPay" value="bank"><span><strong>Chuyển khoản MB Bank</strong><small>Chỉ chuyển tiền sau khi cửa hàng xác nhận giá cuối.</small></span></label></fieldset>',
'<div id="ucOrderBreakdown" class="uc-order-breakdown" aria-live="polite"></div>',
'<p class="uc-order-warning">Giá sản phẩm là tạm tính, chưa gồm phí giao/lắp. Không chuyển tiền khi chưa xác nhận đơn.</p>',
'<p id="ucOrderError" class="uc-order-error" role="alert" hidden></p>',
'<button id="ucOrderSubmit" class="btn btn-primary full" type="submit">Gửi yêu cầu đặt hàng</button>',
'<p class="uc-order-privacy">Tên, điện thoại và địa chỉ chỉ dùng để xử lý đơn. Không cung cấp mật khẩu ngân hàng, PIN hoặc OTP.</p></form>',
'<section id="ucOrderSuccess" class="uc-order-success" hidden aria-live="polite">',
'<span class="uc-order-status">ĐÃ GHI NHẬN YÊU CẦU</span><h3>Đã nhận yêu cầu — chờ xác nhận</h3>',
'<p>Mã đơn: <strong id="ucServerOrderId"></strong></p>',
'<p>Trạng thái: <strong>Chờ cửa hàng xác nhận</strong> · <strong>Chưa thanh toán</strong></p>',
'<p id="ucServerOrderAmount"></p>',
'<div id="ucBankPanel" class="uc-bank-panel" hidden><h4>Chuyển khoản ngân hàng MB</h4>',
'<p class="uc-bank-caution">CHƯA CHUYỂN TIỀN. Đợi UltraCarHCM xác nhận số tiền cuối và phí giao/lắp.</p>',
'<img src="/assets/mb-vietqr-owner.svg" alt="Mã VietQR gốc chủ tài khoản cung cấp" loading="eager" width="240" height="240">',
'<dl><dt>Ngân hàng</dt><dd>MB Bank</dd><dt>Chủ tài khoản</dt><dd>NGUYEN TRUONG SON</dd><dt>Số tài khoản</dt><dd>0967360003</dd><dt>Nội dung</dt><dd id="ucBankTransferInfo"></dd></dl>',
'<div class="uc-bank-buttons"><button type="button" class="btn btn-outline" id="ucCopyAccount">Sao chép số TK</button>',
'<button type="button" class="btn btn-outline" id="ucCopyTransfer">Sao chép nội dung CK</button></div>',
'<p class="uc-bank-hint">QR gốc không có sẵn số tiền hoặc nội dung đơn. Kiểm tra đúng NGUYEN TRUONG SON trong ứng dụng ngân hàng.</p></div>',
'<button id="ucCopyOrder" class="btn btn-primary full" type="button">Sao chép thông tin đơn</button>',
'<a class="btn btn-outline full" href="https://zalo.me/0392960003" target="_blank" rel="noopener noreferrer">Nhắn Zalo để xác nhận nhanh ↗</a>',
'<p class="uc-order-privacy">Đơn đã được lưu trên website. Gửi mã đơn qua Zalo nếu muốn được hỗ trợ nhanh.</p><button type="button" class="btn btn-outline full" id="ucShopAgain">Tiếp tục mua sắm</button></section>'
].join('');
const form=$('#ucOrderForm'),error=$('#ucOrderError'),submit=$('#ucOrderSubmit'),success=$('#ucOrderSuccess');
let requestId='',fingerprint='',orderText='',bankText='';
const dock=$('#ucDockCart');if(dock){dock.setAttribute('aria-label','Mở giỏ hàng');const text=dock.querySelector('span');if(text)text.textContent='Giỏ hàng'}
function breakdown(){const a=items(),total=a.reduce((s,x)=>s+x.p.price*x.qty,0);$('#ucOrderBreakdown').innerHTML='<div><span>Tiền hàng ('+a.reduce((s,x)=>s+x.qty,0)+')</span><strong>'+money(total)+'</strong></div><div><span>Giao hàng / công lắp</span><strong>Chờ báo giá</strong></div><div><span>Tổng cuối</span><strong>Chờ xác nhận</strong></div>';submit.disabled=!a.length||!success.hidden}
breakdown();const count=$('#cartCount');if(count&&'MutationObserver'in window)new MutationObserver(breakdown).observe(count,{childList:true,characterData:true,subtree:true});
const clean=s=>String(s||'').trim();
function fail(text){error.hidden=false;error.textContent=text;submit.disabled=false;submit.textContent='Thử gửi lại đơn'}
async function copy(value,btn){let ok=false;try{await navigator.clipboard.writeText(value);ok=true}catch{const ta=document.createElement('textarea');ta.value=value;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();try{ok=document.execCommand('copy')}catch{}ta.remove()}btn.textContent=ok?'Đã sao chép':'Không sao chép được'}
form.addEventListener('submit',async e=>{
 e.preventDefault();error.hidden=true;
 const cart=items(),name=clean($('#buyerName')?.value),phone=clean($('#ucPhone').value).replace(/[\s.()-]/g,''),address=clean($('#ucAddress').value),car=clean($('#buyerCar')?.value),note=clean($('#ucNote').value),method=$('input[name="ucPay"]:checked')?.value||'cod';
 if(!cart.length)return fail('Giỏ hàng chưa có sản phẩm.');
 if(name.length<2||name.length>80){fail('Vui lòng nhập họ tên người nhận.');$('#buyerName')?.focus();return}
 if(!/^(?:\+84|84|0)[35789]\d{8}$/.test(phone)){fail('Vui lòng nhập số điện thoại hợp lệ.');$('#ucPhone').focus();return}
 if(address.length<12){fail('Vui lòng nhập địa chỉ nhận hàng đầy đủ.');$('#ucAddress').focus();return}
 const payload={name,phone,address,car,note,method,items:cart.map(x=>({sku:x.p.sku,qty:x.qty}))},sig=JSON.stringify(payload);
 if(sig!==fingerprint){fingerprint=sig;requestId=crypto.randomUUID?.()||('aa'+Date.now().toString(16)+Math.random().toString(16).slice(2))}
 payload.requestId=requestId;
 submit.disabled=true;submit.textContent='Đang lưu đơn...';
 let receipt;
 try{const res=await fetch('/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),credentials:'same-origin'});receipt=await res.json();if(!res.ok||!receipt?.orderId)throw Error(receipt?.error||'Không gửi được đơn');}
 catch(ex){fail('Chưa ghi nhận đơn: '+(ex.message||'Lỗi kết nối')+'. Vui lòng thử lại hoặc liên hệ Zalo.');return}
 const id=receipt.orderId,total=receipt.subtotal||0;bankText='THANH TOAN '+id;
 orderText=['ULTRACARHCM — ĐƠN CHỜ XÁC NHẬN','Mã đơn: '+id,'Khách: '+name,'Số điện thoại: '+phone,'Địa chỉ: '+address,'Dòng xe: '+(car||'Chưa cung cấp'),'SẢN PHẨM:',...cart.map(x=>'- '+x.p.sku+' / '+x.p.name+' x '+x.qty+': '+money(x.p.price*x.qty)),'Tạm tính: '+money(total),'Phí giao/lắp: Chờ báo giá','Hình thức: '+(method==='bank'?'Chuyển khoản MB sau xác nhận':'COD khi được hỗ trợ'),'Ghi chú: '+(note||'Không'),'Trạng thái: CHỜ XÁC NHẬN — CHƯA THANH TOÁN'].join('\n');
 $('#ucServerOrderId').textContent=id;$('#ucServerOrderAmount').textContent='Tiền hàng tạm tính: '+money(total)+' · Phí giao/lắp: Chờ báo giá';$('#ucBankTransferInfo').textContent=bankText;$('#ucBankPanel').hidden=method!=='bank';
 form.hidden=true;success.hidden=false;window.dispatchEvent(new CustomEvent('ultracar:order-saved',{detail:{orderId:id}}));success.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
});
$('#ucCopyOrder').addEventListener('click',e=>copy(orderText,e.currentTarget));
$('#ucCopyAccount').addEventListener('click',e=>copy(account,e.currentTarget));
$('#ucCopyTransfer').addEventListener('click',e=>copy(bankText,e.currentTarget));

$('#ucShopAgain').addEventListener('click',()=>{
 requestId='';fingerprint='';orderText='';bankText='';
 success.hidden=true;form.hidden=false;form.reset();
 submit.textContent='Gửi yêu cầu đặt hàng';error.hidden=true;
 $('#ucBankPanel').hidden=true;
 $('#ucOrderSuccess').scrollTop=0;
 window.dispatchEvent(new CustomEvent('ultracar:shop-again'));
 $('#cartClose')?.click();
});

})();