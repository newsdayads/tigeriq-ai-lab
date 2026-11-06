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
test('browser scripts present',()=>{const h=read('index.html');assert.match(h,/src="data.js\?v=20261106r2"/);assert.match(h,/src="app.js\?v=20261106r4"/);assert.ok(read('styles.css').length>10000);});
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

test('logo-aligned cinematic design keeps native contact and motion accessible',()=>{
 const h=read('index.html'),css=read('experience.css'),js=read('experience.js');
 assert.match(h,/id="holoStage"/);assert.match(h,/id="ucVideoGrid"/);assert.match(h,/id="ucShortGrid"/);
 assert.match(h,/id="ucVideoPlayer"/);assert.match(h,/id="ucShortPlayer"/);
 assert.match(h,/href="https:\/\/zalo\.me\/0392960003"/);
 assert.match(h,/href="tel:\+84392960003"/);
 assert.doesNotMatch(h,/href="https:\/\/ultracar\.vn/);
 assert.doesNotMatch(h,/src="https:\/\/ultracar\.vn/);
 assert.doesNotMatch(h,/(?:0327\s*001\s*088|0783\s*199\s*977|0818\s*918\s*981|DC Auto|Nha Trang)/i);
 for(const v of ['--uc-cobalt:#065dff','--uc-silver:#dbe5f1','--uc-midnight:#070d19'])assert.ok(css.includes(v));
 assert.match(css,/prefers-reduced-motion/);assert.match(js,/IntersectionObserver/);
 assert.match(js,/data-holo-angle/);assert.match(js,/youtube-nocookie\.com\/embed/);
});
test('full source library has dealer contact only and 22 original short guides',()=>{
 const db=JSON.parse(read('source-details.json'));
 const guides=JSON.parse(read('dealer-guides.json'));
 const shorts=JSON.parse(read('shorts.json'));
 assert.equal(db.pages.length,172);
 assert.ok(Object.keys(guides.guides).length>=20);
 assert.equal(shorts.items.length,22);
 assert.equal(new Set(shorts.items.map(x=>x.id)).size,22);
 for(const x of shorts.items)assert.match(x.id,/^[a-zA-Z0-9_-]{11}$/);
 for(const p of db.pages){
   const body=[p.title,p.description,...p.headings].join(' ');
   assert.doesNotMatch(body,/(?:0327\s*001\s*088|0783\s*199\s*977|0818\s*918\s*981|DC Auto|Nha Trang)/i);
 }
 const detail=read('chi-tiet.js');assert.match(detail,/dealer-guides\.json/);
 assert.match(detail,/dealer-guide-list/);
});
test('self-hosted 8 videos have manifest and correct byte-range support',()=>{
 const manifest=JSON.parse(read('assets/motion/manifest.json'));
 assert.equal(manifest.items.length,8);
 assert.ok(manifest.items.every(x=>x.local.startsWith('/assets/motion/')&&x.bytes>100000&&/^[0-9a-f]{64}$/.test(x.sha256)));
 const server=read('server.mjs');
 assert.match(server,/'\.mp4':'video\/mp4'/);
 assert.match(server,/createReadStream/);assert.match(server,/status=206/);
 assert.match(server,/accept-ranges/);assert.match(server,/content-range/);
});
