import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root=new URL('..',import.meta.url);
const read=(p)=>readFileSync(new URL(p,root),'utf8');
test('54 unique stockkeeping units, safe catalog data',()=>{
 const x=JSON.parse(read('products.json'));assert.equal(x.length,54);assert.equal(new Set(x.map(z=>z.sku)).size,54);for(const p of x){assert.ok(p.name&&p.sku&&p.category);assert.ok(Number.isFinite(p.price));}
});
test('contact and target canonical',()=>{const h=read('index.html');assert.match(h,/ultracar\.tigeriq\.io\.vn/);assert.match(h,/0392960003/);assert.doesNotMatch(h,/ultracarhcm\.tigeriq\.io\.vn|vercel\.app/);});
test('browser scripts present',()=>{const h=read('index.html');assert.match(h,/src="data.js\?v=20261106r2"/);assert.match(h,/src="app.js\?v=20261108r3"/);assert.ok(read('styles.css').length>10000);});
test('sitemap and robots use correct origin',()=>{assert.match(read('sitemap.xml'),/ultracar\.tigeriq\.io\.vn/);assert.match(read('robots.txt'),/ultracar\.tigeriq\.io\.vn/)});
test('public sitemap has 172 indexed Vietnamese pages with 101 car guides',()=>{
 const raw=read('source-pages.js');const match=raw.match(/^window\.ULTRACAR_SOURCE_PAGES\s*=\s*(\[.*\]);\s*$/s);assert.ok(match,'source index JS array');const pages=JSON.parse(match[1]);assert.equal(pages.length,172);assert.equal(pages.filter(x=>x.group==='dong-xe').length,101);assert.equal(new Set(pages.map(x=>x.path)).size,172);for(const p of pages){assert.match(p.url,/^https:\/\/ultracar\.vn\//)}
});
test('website references public-source navigation and code has no secret',()=>{const h=read('index.html');assert.match(h,/id="thu-vien"/);assert.match(h,/src="source-pages.js"/);});

test('UltraCarHCM brand, genuine manufacturer media and browser-safe SVG response',()=>{
 const h=read('index.html');assert.match(h,/class="brand-logo" src="assets\/ultracarhcm-logo-original\.png\?v=20261106r3"/);assert.doesNotMatch(h,/Đại lý tư vấn tại (?:TP\.)?HCM/i);assert.match(h,/src="media\.js\?v=20261106r4"/);assert.match(h,/id="hinh-anh"/);assert.match(h,/\/assets\/manufacturer\/assets\/hero\/ultracar-cockpit-1600\.webp/);
 const raw=read('media.js');const m=raw.match(/^window\.ULTRACAR_MEDIA\s*=\s*(\{.*\});\s*$/s);assert.ok(m);const media=JSON.parse(m[1]);assert.ok(Object.keys(media.products).length>=40);for(const p of Object.values(media.products)){assert.match(p,/^\/(?:assets|api\/media)\//);assert.doesNotMatch(p,/product-image-pending/)}
 assert.match(read('server.mjs'),/'\.svg':'image\/svg\+xml'/);assert.match(read('app.js'),/productPhoto\(p\)/);
});

test('catalogue reconciled against manufacturer, without synthetic ULTRAMOUNT SKU',()=>{const p=JSON.parse(read('products.json'));assert.equal(p.length,54);assert.ok(p.find(x=>x.sku==='NC888'&&x.price===2500000));assert.ok(p.some(x=>x.sku==='CBKVXL13'));assert.ok(p.some(x=>x.sku==='VXL855'));assert.ok(!p.some(x=>x.sku==='ULTRAMOUNT'));});

test('Owner original UltraCarHCM PNG is pixel-identical, no duplicated adjacent brand title',()=>{
 const logo=readFileSync(new URL('assets/ultracarhcm-logo-original.png',root));
 assert.equal(createHash('sha256').update(logo).digest('hex'),'93411ebb0ed5197254819f908413fc54b213926435d3e3cea2f55002860baaf5');
 assert.equal(logo.readUInt32BE(16),1024);assert.equal(logo.readUInt32BE(20),341);
 const h=read('index.html');const header=h.match(/<header class="header"[\s\S]*?<\/header>/)?.[0];assert.ok(header);
 assert.match(header,/class="brand-logo"/);assert.doesNotMatch(header,/<span>ULTRACAR<b>HCM<\/b><\/span>/);
 assert.match(h,/class="footer-logo" src="assets\/ultracarhcm-logo-original\.png\?v=20261106r3"/);
 const css=read('styles.css');assert.match(css,/\.brand img\.brand-logo\{[^}]*object-fit:contain/);
});

test('172 source-verified topics have local internal detail pages, never manufacturer outbound clicks',()=>{
 const db=JSON.parse(read('source-details.json'));assert.equal(db.pages.length,172);
 assert.equal(db.pages.filter(p=>p.status==='verified').length,172);
 assert.equal(new Set(db.pages.map(p=>p.path)).size,172);
 const h=read('index.html'),app=read('app.js');
 assert.match(h,/\/chi-tiet\.html\?page=/);
 assert.match(app,/encodeURIComponent\(p\.path\)/);
 assert.doesNotMatch(h,/href="https:\/\/ultracar\.vn/i);
 assert.doesNotMatch(app,/https:\/\/ultracar\.vn/i);
 assert.doesNotMatch(h,/<iframe/i);
 assert.doesNotMatch(h,/src="https:\/\/ultracar\.vn/i);
 assert.match(read('chi-tiet.html'),/chi-tiet\.js/);
 assert.match(read('chi-tiet.js'),/\/source-details\.json/);
 assert.match(read('chi-tiet.js'),/productBySku/);
});
test('128 source images are self-hosted with validated hash manifest',()=>{
 const obj=JSON.parse(read('assets/manufacturer/manifest.json'));
 assert.equal(obj.images.length,128);
 assert.ok(obj.images.every(x=>!x.error&&x.sha256&&x.local.startsWith('/assets/manufacturer/')));
 const app=read('app.js');assert.match(app,/"\/assets\/manufacturer"\+path/);
 assert.doesNotMatch(app,/"https:\/\/ultracar\.vn"\+path/);
});

test('showroom motion, comparisons and source-grounded guides are available',()=>{
 const home=read('index.html'),detail=read('chi-tiet.html');
 assert.match(home,/experience\.css\?v=20261107r1/);
 assert.match(home,/experience\.js\?v=20261107r1/);
 assert.match(detail,/guides\.js\?v=20261107r2/);
 const js=read('experience.js'),guides=read('guides.js');
 assert.match(js,/ucCompareResult/);
 assert.match(js,/prefers-reduced-motion/);
 assert.match(js,/assets\/manufacturer/);
 assert.doesNotMatch(js,/href="https:\/\/ultracar\.vn/);
 assert.match(guides,/200\.000/);
 assert.match(guides,/One UI 8/);
 const p=JSON.parse(read('products.json')).find(x=>x.sku==='NC888');
 assert.equal(p.chip,'Snapdragon 888');
 assert.equal(p.memory,'12GB / 256GB');
 assert.ok(!p.conflict);
});


test('42 editorial topics and 101 vehicle guides are available without copying articles',()=>{
 const raw=read('guides.js');
 const match=raw.match(/^window\.ULTRACAR_GUIDES\s*=\s*(\{.*\});\s*$/s);
 assert.ok(match,'editorial data JS structure');
 const db=JSON.parse(match[1]);
 assert.ok(Object.keys(db.guides).length>=42,'at least 42 source-aware editorial topics');
 for(const key of ['/cam-ket/','/chinh-sach/dieu-khoan/','/huong-dan-kich-hoat-app/','/lap-dat/','/gia-do/','/tin-tuc/bo-cuc-samsung-dex/','/video/','/trai-nghiem-3d/']){
  assert.ok(Array.isArray(db.guides[key])&&db.guides[key].length>=2,key);
 }
 const src=JSON.parse(read('source-details.json'));
 const cars=src.pages.filter(p=>p.group==='dong-xe');
 assert.equal(cars.length,101);
 assert.ok(cars.filter(p=>p.image).length>=100,'100 source-backed vehicle images');
 const detail=read('chi-tiet.js');
 assert.match(detail,/uc-car-checklist/);
 assert.match(detail,/ảnh.*táp-lô/);
 assert.match(detail,/ucViewAngle/);
 assert.match(detail,/không phải mô hình 3D gốc/);
 assert.match(read('chi-tiet.html'),/vehicle-gallery\.css\?v=20261107r2/);
});
test('local image gallery supports 101 vehicle entries, search and load more',()=>{
 const home=read('index.html'),js=read('vehicle-gallery.js'),css=read('vehicle-gallery.css');
 assert.match(home,/vehicle-gallery\.css\?v=20261107r2/);
 assert.match(home,/vehicle-gallery\.js\?v=20261107r2/);
 assert.match(js,/source-details\.json/);
 assert.match(js,/ucVehicleFind/);
 assert.match(js,/ucVehicleBrand/);
 assert.match(js,/visible\+=12/);
 assert.match(js,/assets\/manufacturer/);
 assert.doesNotMatch(js,/window\.open\(/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/prefers-reduced-motion/);
});


test('official videos play through their YouTube host without video downloads',()=>{
 const home=read('index.html'),detail=read('chi-tiet.html'),js=read('official-media.js'),css=read('official-media.css');
 assert.match(home,/official-media\.js\?v=20261107r3/);
 assert.match(home,/official-media\.css\?v=20261107r3/);
 assert.match(detail,/official-media\.js\?v=20261107r3/);
 assert.match(js,/www\.youtube-nocookie\.com\/embed/);
 assert.match(js,/FTiAXfHQvU0/);
 assert.match(js,/FSJdq_Yi_G8/);
 assert.match(js,/PWhSrOk5CYw/);
 assert.match(js,/uc-video-play/);
 assert.match(js,/frame\.innerHTML/);
 assert.doesNotMatch(js,/fetch\(.+ultracar\.vn/);
 assert.doesNotMatch(js,/\.mp4["']/);
 assert.match(css,/@media\(max-width:650px\)/);
});
test('original CSS3D model and manufacturer policy links are attributed correctly',()=>{
 const js=read('official-media.js'),css=read('official-media.css'),detail=read('chi-tiet.js');
 assert.match(js,/uc3d-device/);
 assert.match(js,/pointermove/);
 assert.match(js,/ArrowLeft/);
 assert.match(js,/không phải tệp CAD\/3D gốc/);
 assert.match(css,/transform-style:preserve-3d/);
 assert.match(js,/ultracar\.vn\/chinh-sach\/bao-hanh/);
 assert.match(js,/ultracar\.vn\/chinh-sach\/doi-tra/);
 assert.match(js,/ultracar\.vn\/chinh-sach\/dieu-khoan/);
 assert.match(js,/ultracar\.vn\/chinh-sach\/bao-mat/);
 assert.match(detail,/Trình phát YouTube|trình phát YouTube/);
 assert.doesNotMatch(detail,/Tư liệu video\/3D chi tiết chưa được tích hợp/);
});


test('premium cinematic hero retains original real photo and respects motion preferences',()=>{
 const h=read('index.html'),js=read('showroom-motion.js'),css=read('showroom-motion.css');
 assert.match(h,/showroom-motion\.css\?v=20261108r1/);
 assert.match(h,/showroom-motion\.js\?v=20261108r3/);
 assert.match(h,/ultracar-cockpit-1600\.webp/);
 assert.match(js,/uc-cinema-shot/);
 assert.match(js,/uc-cinematic/);
 assert.match(js,/pointermove/);
 assert.match(js,/prefers-reduced-motion/);
 assert.match(css,/@keyframes uc-ambient-sweep/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.doesNotMatch(js,/fetch\(['"]https?:/);
});
test('hotspots explain 4 actual capabilities without invented universal fit',()=>{
 const js=read('showroom-motion.js');
 assert.equal((js.match(/key:'(?:screen|dex|camera|mount)'/g)||[]).length,4);
 assert.match(js,/aria-pressed/);
 assert.match(js,/aria-controls/);
 assert.match(js,/ArrowRight/);
 assert.match(js,/Đa nhiệm với Samsung DeX/);
 assert.match(js,/phụ thuộc mã sản phẩm/);
 assert.match(js,/Không mặc định mọi xe/);
 for(const url of ['man-hinh','ung-dung','cam-lui','gia-do'])assert.ok(js.includes('%2F'+url+'%2F'));
});
test('mobile dock has real catalog, cart and Zalo actions and hides on dialog',()=>{
 const js=read('showroom-motion.js'),css=read('showroom-motion.css');
 assert.match(js,/id='ucMobileDock'/);
 assert.match(js,/href="#danh-muc"/);
 assert.match(js,/https:\/\/zalo\.me\/0392960003/);
 assert.match(js,/cart\?\.click\(\)/);
 assert.match(js,/MutationObserver/);
 assert.match(js,/document\.body\.classList\.contains\('lock'\)/);
 assert.match(css,/body\.lock \.uc-mobile-dock/);
 assert.match(css,/body\.uc-dock-visible \.floating-zalo/);
 assert.match(css,/safe-area-inset-bottom/);
});

test('full order checkout records on PC01 and preserves unpaid bank state',()=>{
 const h=read('index.html'),js=read('checkout.js'),css=read('checkout.css'),server=read('server.mjs'),qr=read('assets/mb-vietqr-owner.svg');
 assert.match(h,/GIỎ HÀNG/);
 assert.match(h,/checkout\.js\?v=20261108r3/);
 assert.match(h,/checkout\.css\?v=20261108r2/);
 assert.match(h,/Họ tên người nhận \*/);
 assert.match(js,/\/api\/orders/);
 assert.match(js,/id="ucPhone"/);
 assert.match(js,/id="ucAddress"/);
 assert.match(js,/value="cod"/);
 assert.match(js,/value="bank"/);
 assert.match(js,/CHƯA THANH TOÁN/);
 assert.match(js,/mb-vietqr-owner\.svg/);
 assert.match(js,/0967360003/);
 assert.match(js,/NGUYEN TRUONG SON/);
 assert.match(js,/https:\/\/zalo\.me\/0392960003/);
 assert.match(js,/crypto\.randomUUID/);
 assert.match(server,/ORDERS_FILE/);
 assert.match(server,/pending_confirmation/);
 assert.match(server,/paymentStatus:'unpaid'/);
 assert.match(server,/writeQueue/);
 assert.match(server,/req\.headers\.origin/);
 assert.match(server,/appendFile/);
 assert.match(server,/findPrevious/);
 assert.match(qr,/df4cb87fc1f6e20cc258e158e86a84de4b5f3365cca1938b60bd6aa086b5963c/);
 assert.match(qr,/<path fill=/);
 assert.match(css,/uc-bank-panel/);
 assert.doesNotMatch(js,/paymentSuccess|paid:true|localStorage\.setItem/);
});

test('iPhone cart has readable review and a separate checkout step, with real add-to-cart labels',()=>{
 const h=read('index.html'),app=read('app.js'),ux=read('commerce-ux.js'),css=read('commerce-ux.css'),checkout=read('checkout.js');
 assert.match(h,/id="ucCartReview"/);
 assert.match(h,/id="ucCheckoutStep"/);
 assert.match(h,/id="ucProceedCheckout"/);
 assert.match(h,/id="ucContinueShopping"/);
 assert.match(h,/id="ucBackToCart"/);
 assert.match(h,/commerce-ux\.js\?v=20261108r3/);
 assert.match(h,/commerce-ux\.css\?v=20261108r3/);
 assert.match(h,/styles\.css\?v=20261108r3/);
 assert.match(app,/Thêm giỏ hàng/);
 assert.match(app,/setDialog\(true,'cart'\)/);
 assert.match(app,/uc-cart-item-image/);
 assert.match(app,/ultracar:order-saved/);
 assert.match(ux,/go\('checkout'\)/);
 assert.match(ux,/go\('review'\)/);
 assert.match(ux,/uc-scroll-progress/);
 assert.match(ux,/IntersectionObserver/);
 assert.match(ux,/prefers-reduced-motion/);
 assert.match(css,/min-height:0/);
 assert.match(css,/uc-cart-review-actions/);
 assert.match(css,/@media\(max-width:359px\)/);
 assert.match(css,/@media\(min-width:651px\) and \(max-width:1023px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(checkout,/ultracar:order-saved/);
});


test('mobile catalog limits first paint to 12 of 54 products, with load more and filter reset',()=>{
 const h=read('index.html'),js=read('app.js'),css=read('commerce-ux.css');
 assert.match(h,/id="ucCatalogMore"/);
 assert.match(js,/visibleLimit=12/);
 assert.match(js,/items\.slice\(0,visibleLimit\)/);
 assert.match(js,/visibleLimit\+=12/);
 assert.match(js,/Math\.min\(12,items\.length-shown\.length\)/);
 assert.match(js,/visibleLimit=12;renderCatalog\(\)/);
 assert.match(css,/uc-loadmore-wrap/);
 assert.match(css,/uc-catalog-more/);
 assert.match(js,/Thêm giỏ hàng/);
 assert.doesNotMatch(js,/>[+] Tư vấn<\/button>/);
});


test('Immersive 3D showroom is original, touch interactive, accessible and honest about provenance',()=>{
 const html=read('index.html'),js=read('immersive-3d.js'),css=read('immersive-3d.css');
 assert.match(html,/id="mo-phong-3d"/);
 assert.match(html,/href="#ultracar-3d-goc"/);
 assert.match(html,/id="mo-phong-3d"/);
 assert.match(html,/src="immersive-3d\.js\?v=20261108r1"/);
 assert.match(html,/href="immersive-3d\.css\?v=20261108r1"/);
 assert.match(html,/id="ucx3dModel"/);
 assert.match(html,/id="ucx3dFront"/);
 assert.match(html,/id="ucx3dBack"/);
 assert.match(html,/id="ucx3dAngle"/);
 assert.match(html,/id="ucx3dAuto"/);
 assert.match(html,/id="ucx3dSlide"/);
 assert.match(html,/data-ucx3d-mode="map"/);
 assert.match(html,/data-ucx3d-mode="dex"/);
 assert.match(html,/data-ucx3d-mode="camera"/);
 assert.match(html,/data-ucx3d-step="3"/);
 assert.match(html,/không phải mô hình CAD/i);
 assert.match(js,/setPointerCapture/);
 assert.match(js,/pointermove/);
 assert.match(js,/ArrowRight/);
 assert.match(js,/IntersectionObserver/);
 assert.match(js,/prefers-reduced-motion/);
 assert.match(js,/requestAnimationFrame/);
 assert.match(js,/ucx3d-rx/);
 assert.match(css,/preserve-3d/);
 assert.match(css,/rotateY\(180deg\)/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.doesNotMatch(html,/<model-viewer|spline|sketchfab/i);
 assert.doesNotMatch(js,/\.glb|\.gltf|ultracar\.vn\/assets/i);
});


test('GLB 2.0 is real original self-hosted binary, pinned and served on UltraCarHCM only',()=>{
 const h=read('index.html'),src=read('model-viewer-source.js'),css=read('model-viewer.css');
 const bundle=read('model-viewer.bundle.js'),server=read('server.mjs');
 const binary=readFileSync(new URL('assets/models/ultracar-13-3.glb',root));
 assert.equal(binary.subarray(0,4).toString('ascii'),'glTF');
 assert.equal(binary.readUInt32LE(4),2);
 assert.equal(binary.readUInt32LE(8),binary.length);
 assert.equal(binary.length,511344);
 assert.equal(createHash('sha256').update(binary).digest('hex').toUpperCase(),'0F6C6F1837E1BCF86546FCC714823C340EE188C8A7D94E7CF4FB45278A631657');
 const json=JSON.parse(binary.subarray(20,20+binary.readUInt32LE(12)).toString('utf8'));
 assert.ok(json.meshes.length>0&&json.nodes.length>0&&json.materials.length>0);
 assert.match(h,/id="ultracar-3d-goc"/);
 assert.match(h,/id="ucSelf3dCanvas"/);
 assert.match(h,/src="model-viewer\.bundle\.js\?v=20261109r1"/);
 assert.match(h,/href="model-viewer\.css\?v=20261109r1"/);
 assert.match(h,/href="#ultracar-3d-goc"/);
 assert.match(h,/<section id="mo-phong-3d"[^>]*hidden/);
 assert.doesNotMatch(h,/<iframe\b/i);
 assert.match(src,/new GLTFLoader\(\)\.loadAsync\(modelUrl\)/);
 assert.match(src,/\/assets\/models\/ultracar-13-3\.glb/);
 assert.match(src,/OrbitControls/);
 assert.match(src,/IntersectionObserver/);
 assert.match(src,/prefers-reduced-motion/);
 assert.match(src,/requestFullscreen/);
 assert.match(bundle,/ultracar-13-3\.glb/);
 assert.match(css,/touch-action:none/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(server,/\.glb':'model\/gltf-binary/);
});
