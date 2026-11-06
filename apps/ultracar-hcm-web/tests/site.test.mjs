import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root=new URL('..',import.meta.url);
const read=(p)=>readFileSync(new URL(p,root),'utf8');
test('36 unique stockkeeping units, safe catalog data',()=>{
 const x=JSON.parse(read('products.json'));assert.equal(x.length,36);assert.equal(new Set(x.map(z=>z.sku)).size,36);for(const p of x){assert.ok(p.name&&p.sku&&p.category);assert.ok(Number.isFinite(p.price));}
});
test('contact and target canonical',()=>{const h=read('index.html');assert.match(h,/ultracar\.tigeriq\.io\.vn/);assert.match(h,/0392960003/);assert.doesNotMatch(h,/ultracarhcm\.tigeriq\.io\.vn|vercel\.app/);});
test('browser scripts present',()=>{const h=read('index.html');assert.match(h,/src="data.js"/);assert.match(h,/src="app.js"/);assert.ok(read('styles.css').length>10000);});
test('sitemap and robots use correct origin',()=>{assert.match(read('sitemap.xml'),/ultracar\.tigeriq\.io\.vn/);assert.match(read('robots.txt'),/ultracar\.tigeriq\.io\.vn/)});
test('public sitemap has 172 indexed Vietnamese pages with 101 car guides',()=>{
 const raw=read('source-pages.js');const match=raw.match(/^window\.ULTRACAR_SOURCE_PAGES\s*=\s*(\[.*\]);\s*$/s);assert.ok(match,'source index JS array');const pages=JSON.parse(match[1]);assert.equal(pages.length,172);assert.equal(pages.filter(x=>x.group==='dong-xe').length,101);assert.equal(new Set(pages.map(x=>x.path)).size,172);for(const p of pages){assert.match(p.url,/^https:\/\/ultracar\.vn\//)}
});
test('website references public-source navigation and code has no secret',()=>{const h=read('index.html');assert.match(h,/id="thu-vien"/);assert.match(h,/src="source-pages.js"/);});
