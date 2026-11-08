(()=>{
'use strict';
const $=s=>document.querySelector(s),root=$('#ucCheckout');if(!root)return;
root.innerHTML='<form id="ucOrderForm" class="uc-order-form"><h3>Thông tin đặt hàng</h3><label for="ucPhone">Số điện thoại *</label><input id="ucPhone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="16" placeholder="09xxxxxxxx"><label for="ucAddress">Địa chỉ nhận hàng / lắp đặt *</label><textarea id="ucAddress" autocomplete="street-address" required maxlength="400" rows="2" placeholder="Số nhà, đường, phường/xã, tỉnh/thành phố"></textarea><label for="ucNote">Ghi chú</label><textarea id="ucNote" maxlength="300" rows="2" placeholder="Yêu cầu lắp đặt, giờ nhận hàng..."></textarea><fieldset><legend>Phương thức thanh toán dự kiến</legend><label><input type="radio" name="ucPay" value="cod" checked> COD — chỉ khi cửa hàng xác nhận hỗ trợ</label><label><input type="radio" name="ucPay" value="bank"> Chuyển khoản — sau khi xác nhận đơn</label></fieldset><p id="ucOrderError" role="alert" hidden></p><button type="submit" class="btn btn-primary full">Tạo yêu cầu đặt hàng</button><p class="drawer-note">Chưa thu tiền trực tuyến. Giá cuối, phí giao/lắp và tồn kho cần cửa hàng xác nhận.</p><div id="ucOrderResult" hidden aria-live="polite"><strong id="ucOrderRef"></strong><p>Đây là yêu cầu chưa gửi. Sao chép nội dung và dán vào Zalo để cửa hàng tiếp nhận.</p><button type="button" class="btn btn-primary full" id="ucCopyOrder">Sao chép đơn hàng</button><a href="https://zalo.me/0392960003" target="_blank" rel="noopener noreferrer" class="btn btn-outline full">Mở Zalo để gửi đơn ↗</a></div></form>';
const products=window.ULTRACAR_PRODUCTS||[],bySku=new Map(products.map(p=>[p.sku,p]));
const items=()=>{try{const a=JSON.parse(localStorage.getItem('ultracarhcm_cart_v1')||'[]');return Array.isArray(a)?a.filter(x=>Array.isArray(x)&&bySku.has(x[0])&&Number.isInteger(x[1])&&x[1]>0&&x[1]<=99).map(([sku,qty])=>({p:bySku.get(sku),qty})):[]}catch{return []}};
const money=n=>new Intl.NumberFormat('vi-VN').format(n)+' đ';
const form=$('#ucOrderForm'),error=$('#ucOrderError'),result=$('#ucOrderResult');
let content='',signature='';
const sign=()=>JSON.stringify(items().map(x=>[x.p.sku,x.qty]));
function fail(s){error.hidden=false;error.textContent=s}
function clear(){result.hidden=true;content='';signature=''}
$('#cartItems')?.addEventListener('click',()=>queueMicrotask(()=>{if(!result.hidden&&signature!==sign())clear()}));
const dock=$('#ucDockCart');if(dock){dock.setAttribute('aria-label','Mở giỏ hàng');const label=dock.querySelector('span');if(label)label.textContent='Giỏ hàng'}
form.addEventListener('submit',e=>{
e.preventDefault();error.hidden=true;clear();const rows=items();
if(!rows.length)return fail('Giỏ hàng chưa có sản phẩm.');
const phone=$('#ucPhone').value.replace(/[\s.\-()]/g,''),address=$('#ucAddress').value.trim();
if(!/^(?:\+84|84|0)[35789]\d{8}$/.test(phone)){fail('Số điện thoại không hợp lệ.');$('#ucPhone').focus();return}
if(address.length<12){fail('Vui lòng nhập đầy đủ địa chỉ nhận hàng.');$('#ucAddress').focus();return}
const pay=$('input[name="ucPay"]:checked').value;
const total=rows.reduce((s,x)=>s+x.p.price*x.qty,0);
const ref='UC-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
content=['ULTRACARHCM — YÊU CẦU ĐẶT HÀNG','Mã tham chiếu chưa xác nhận: '+ref,'Tên: '+($('#buyerName')?.value.trim()||'Chưa cung cấp'),'Điện thoại: '+phone,'Địa chỉ: '+address,'Dòng xe: '+($('#buyerCar')?.value.trim()||'Chưa cung cấp'),'SẢN PHẨM:',...rows.map(x=>'- '+x.p.sku+' / '+x.p.name+' × '+x.qty+': '+money(x.p.price*x.qty)),'Tạm tính: '+money(total),'Thanh toán dự kiến: '+(pay==='cod'?'COD nếu cửa hàng xác nhận':'Chuyển khoản sau xác nhận'),'Ghi chú: '+($('#ucNote').value.trim()||'Không có'),'Nhờ xác nhận tồn kho, giá cuối, phí giao/lắp, thời gian giao và phương thức thanh toán.','CHƯA GỬI — CHƯA THANH TOÁN'].join('\n');
signature=sign();$('#ucOrderRef').textContent='Mã tham chiếu: '+ref;result.hidden=false;
});
$('#ucCopyOrder').addEventListener('click',async()=>{
if(!content||signature!==sign()){clear();fail('Giỏ hàng thay đổi, vui lòng tạo lại yêu cầu.');return}
let ok=false;try{await navigator.clipboard.writeText(content);ok=true}catch{const a=document.createElement('textarea');a.value=content;a.style.position='fixed';a.style.left='-9999px';document.body.appendChild(a);a.select();try{ok=document.execCommand('copy')}catch{}a.remove()}
$('#ucCopyOrder').textContent=ok?'Đã sao chép — mở Zalo để gửi':'Không sao chép được, vui lòng thử lại';
});
})();