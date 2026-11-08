/* UltraCarHCM: PC01 loopback static website + pending order intake.
 * Order PII stays in an external private runtime directory, never under web root.
 * No online bank verification and no public/admin read endpoint.
 */
import http from 'node:http';
import { readFile, stat, mkdir, appendFile } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const PORT=Number(process.env.PORT||8893);
const ORDERS_DIR=process.env.ULTRACAR_ORDERS_DIR||join(ROOT,'..','..','Data','UltraCarHCM');
const ORDERS_FILE=join(ORDERS_DIR,'orders.jsonl');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY'};
const rate=new Map();
let writeQueue=Promise.resolve();
const reply=(res,status,obj)=>{res.writeHead(status,JSON_HEADERS);res.end(JSON.stringify(obj));};
const str=(val,max)=>typeof val==='string'&&val.length<=max?val.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,''):null;
async function bodyJson(req){
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw Object.assign(new Error('Unsupported Content-Type'),{status:415});
 let size=0;const parts=[];
 for await(const chunk of req){size+=chunk.length;if(size>16384)throw Object.assign(new Error('Payload quá lớn'),{status:413});parts.push(chunk);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw Object.assign(new Error('JSON không hợp lệ'),{status:400})}
}
async function findPrevious(id){
 const st=await stat(ORDERS_FILE).catch(()=>null);
 if(!st)return null;
 if(st.size>25*1024*1024)throw Object.assign(new Error('Đơn hàng tạm quá tải; liên hệ cửa hàng'),{status:503});
 const content=await readFile(ORDERS_FILE,'utf8');
 for(const line of content.split('\n').reverse()){if(!line)continue;try{const x=JSON.parse(line);if(x.requestId===id)return x}catch{}}
 return null;
}
function validate(input,products){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('Dữ liệu đơn hàng không hợp lệ'),{status:400});
 const name=str(input.name,80),phone=str(input.phone,20),address=str(input.address,400);
 const car=str(input.car,120),note=str(input.note,300);
 const method=input.method;
 const requestId=str(input.requestId,80);
 if(!name||name.length<2||!phone||!address||address.length<12||car===null||note===null||!['cod','bank'].includes(method)||!requestId||!/^[a-f0-9-]{20,80}$/i.test(requestId))throw Object.assign(new Error('Thông tin giao hàng chưa hợp lệ'),{status:422});
 const normalizedPhone=phone.replace(/[\s.()-]/g,'');
 if(!/^(?:\+84|84|0)[35789]\d{8}$/.test(normalizedPhone))throw Object.assign(new Error('Số điện thoại không hợp lệ'),{status:422});
 if(!Array.isArray(input.items)||!input.items.length||input.items.length>30)throw Object.assign(new Error('Giỏ hàng không hợp lệ'),{status:422});
 const lookup=new Map(products.map(x=>[x.sku,x]));
 let total=0,qtyTotal=0;
 const uniq=new Set();
 const items=input.items.map(item=>{
   if(!item||typeof item.sku!=='string'||!Number.isInteger(item.qty)||item.qty<1||item.qty>99||uniq.has(item.sku))throw Object.assign(new Error('Số lượng/mã sản phẩm không hợp lệ'),{status:422});
   const p=lookup.get(item.sku);
   if(!p||!Number.isSafeInteger(p.price)||p.price<0)throw Object.assign(new Error('Sản phẩm không còn hợp lệ'),{status:422});
   uniq.add(item.sku);
   qtyTotal+=item.qty;total+=item.qty*p.price;
   return {sku:p.sku,name:p.name,qty:item.qty,unitPrice:p.price,subtotal:p.price*item.qty};
 });
 if(qtyTotal>100||!Number.isSafeInteger(total)||total>250_000_000)throw Object.assign(new Error('Tổng số lượng/giá trị đơn vượt giới hạn'),{status:422});
 return {name,phone:normalizedPhone,address,car,note,method,requestId,items,subtotal:total};
}
async function persistOrder(payload){
 const found=await findPrevious(payload.requestId);
 if(found)return {...found,idempotent:true};
 const fingerprint=createHash('sha256').update(payload.phone).digest('hex').slice(0,18);
 const now=Date.now(),bucket=rate.get(fingerprint)||[];
 const recent=bucket.filter(t=>now-t<15*60*1000);
 if(recent.length>=4)throw Object.assign(new Error('Bạn đã gửi nhiều yêu cầu. Vui lòng liên hệ Zalo để được hỗ trợ.'),{status:429});
 const id='UC'+new Date().toISOString().replace(/\D/g,'').slice(2,14)+randomBytes(4).toString('hex').toUpperCase();
 const order={id,requestId:payload.requestId,createdAt:new Date(now).toISOString(),status:'pending_confirmation',paymentStatus:'unpaid',paymentMethod:payload.method,subtotal:payload.subtotal,shippingFee:null,finalAmount:null,customer:{name:payload.name,phone:payload.phone,address:payload.address,car:payload.car,note:payload.note},items:payload.items};
 await mkdir(ORDERS_DIR,{recursive:true,mode:0o700});
 await appendFile(ORDERS_FILE,JSON.stringify(order)+'\n',{encoding:'utf8',mode:0o600});
 rate.set(fingerprint,[...recent,now]);if(rate.size>500)for(const [k,v]of rate){if(v.every(t=>now-t>15*60*1000))rate.delete(k);}
 return order;
}
async function orderEndpoint(req,res){
 const origin=req.headers.origin;
 // Browser checkout is same-origin. Never allow cross-origin PII submissions.
 if(!origin){return reply(res,403,{error:'Yêu cầu phải được gửi từ website chính thức.'});}
 let u;
 try{u=new URL(origin)}catch{return reply(res,403,{error:'Nguồn yêu cầu không hợp lệ'})}
 const host=req.headers.host||'';
 if(u.host!==host||!['http:','https:'].includes(u.protocol))return reply(res,403,{error:'Không chấp nhận đơn gửi từ tên miền khác'});
 try{
  const payload=await bodyJson(req);
  const products=JSON.parse(await readFile(join(ROOT,'products.json'),'utf8'));
  const clean=validate(payload,products);
  const work=writeQueue.then(()=>persistOrder(clean),()=>persistOrder(clean));
  writeQueue=work.catch(()=>{});
  const order=await work;
  return reply(res,order.idempotent?200:201,{orderId:order.id,status:'pending_confirmation',paymentStatus:'unpaid',paymentMethod:order.paymentMethod,subtotal:order.subtotal,shippingFee:null,finalAmount:null,duplicate:!!order.idempotent});
 }catch(e){return reply(res,e.status||503,{error:e.status?e.message:'Không lưu được đơn hàng, vui lòng gửi yêu cầu qua Zalo.'})}
}
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url||'/', 'http://localhost').pathname);
  if(pathname==='/api/orders'){
   if(req.method==='POST')return await orderEndpoint(req,res);
   res.writeHead(405,{'Allow':'POST',...JSON_HEADERS});return res.end(JSON.stringify({error:'Method Not Allowed'}));
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});return res.end();}
  if(pathname==='/healthz'){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});return res.end(req.method==='HEAD'?'':JSON.stringify({status:'ok',service:'ultracar-hcm-web'}));}
  if(/\\|\0/.test(pathname)||pathname.split('/').includes('..')){res.writeHead(400);return res.end();}
  const rel=pathname==='/'?'index.html':pathname.replace(/^\/+/,'');
  const path=normalize(join(ROOT,rel));
  if(!path.startsWith(ROOT)){res.writeHead(403);return res.end();}
  const st=await stat(path).catch(()=>null);
  if(!st?.isFile()){res.writeHead(404);return res.end('Not Found');}
  const data=await readFile(path);
  res.writeHead(200,{'content-type':MIME[extname(path).toLowerCase()]||'application/octet-stream','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'SAMEORIGIN','cache-control':extname(path)==='.html'?'no-cache':'public,max-age=3600'});
  res.end(req.method==='HEAD'?'':data);
 }catch{res.writeHead(500);res.end('Internal Server Error')}
});
server.listen(PORT,'127.0.0.1',()=>console.log('ultracar-hcm-web listening on 127.0.0.1:'+PORT));
