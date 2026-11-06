/**
 * Collect only factual metadata and approved public product imagery from UltraCar.vn
 * into a source-attributed, independently hosted UltraCarHCM experience.
 * Does not mirror page HTML, article bodies, scripts, policies, video or 3D.
 * Run from apps/ultracar-hcm-web on PC01 (not in browser).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT=process.cwd();
const SOURCE='https://ultracar.vn';
const pages=JSON.parse(readFileSync(join(ROOT,'source-pages.js'),'utf8').replace(/^window\.ULTRACAR_SOURCE_PAGES\s*=\s*/, '').replace(/;\s*$/,''));
const media=JSON.parse(readFileSync(join(ROOT,'media.js'),'utf8').replace(/^window\.ULTRACAR_MEDIA\s*=\s*/, '').replace(/;\s*$/,''));
const decode=(s='')=>String(s).replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(Number(d))).replace(/&(amp|quot|apos|lt|gt|nbsp|ndash|mdash);/gi,(_,e)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—'}[e.toLowerCase()]||' ')).replace(/\s+/g,' ').trim();
function meta(html,key,value){for(const [tag] of html.matchAll(/<meta\b[^>]+>/gi)){const a=Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(x=>[x[1].toLowerCase(),x[2]]));if(a[key]===value)return decode(a.content||'')}return ''}
function take(html,tag){const m=html.match(new RegExp('<'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/'+tag+'>','i'));return m?decode(m[1].replace(/<[^>]+>/g,' ')):''}
function headings(html){const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]||html;return [...main.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].slice(0,8).map(m=>decode(m[1].replace(/<[^>]+>/g,' '))).filter(x=>x.length>5&&x.length<170).slice(0,5)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,kind){for(let n=0;n<3;n++){try{
 const response=await fetch(url,{signal:AbortSignal.timeout(19000),headers:{'User-Agent':'TigerIQ-UltraCarHCM-dealer-content-audit/1.0','Accept':kind==='html'?'text/html,application/xhtml+xml':'image/avif,image/webp,image/png,image/jpeg,*/*'}});
 if(!response.ok)throw Error('HTTP_'+response.status);
 if(kind==='html')return await response.text();
 const type=response.headers.get('content-type')||'';
 if(!/^image\/(png|jpeg|webp|avif)(?:;|$)/i.test(type))throw Error('INVALID_IMAGE_MIME_'+type);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length<500||bytes.length>15_000_000)throw Error('IMAGE_SIZE_UNSAFE_'+bytes.length);
 return {bytes,type,sha256:createHash('sha256').update(bytes).digest('hex')};
}catch(e){if(n===2)return {error:String(e.message||e)};await sleep(200*(n+1))}}}
async function workerPool(items,n,fn){let idx=0;const output=new Array(items.length);await Promise.all(Array.from({length:n},async()=>{while(idx<items.length){const j=idx++;output[j]=await fn(items[j],j)}}));return output}
const mode=process.argv[2]||'collect';
if(mode==='collect'){
 const out=await workerPool(pages,5,async p=>{
  const html=await get(SOURCE+p.path,'html');
  if(typeof html!=='string')return {path:p.path,group:p.group,title:'',description:'',headings:[],image:'',status:'source-unavailable'};
  const title=take(html,'title').replace(/\s*(?:[-–|]\s*)UltraCar(?:\.vn)?\s*$/i,'').trim();
  const description=meta(html,'name','description');
  const image=meta(html,'property','og:image');
  return {path:p.path,group:p.group,title,description,headings:headings(html),
   image:image.startsWith(SOURCE+'/')?image.slice(SOURCE.length):'',status:'verified'};
 });
 const failures=out.filter(x=>x.status!=='verified');
 writeFileSync(join(ROOT,'source-details.json'),JSON.stringify({source:SOURCEliteral(),capturedOn:new Date().toISOString(),pages:out},null,2)+'\n','utf8');
 const count=out.filter(x=>!!x.image).length;
 console.log(JSON.stringify({stage:'collect',total:out.length,verified:out.length-failures.length,failed:failures.map(x=>x.path),vehicleImages:count,output:'source-details.json'}));
}
else if(mode==='assets'){
 let details={pages:[]};try{details=JSON.parse(readFileSync(join(ROOT,'source-details.json'),'utf8'))}catch{}
 const sourcePaths=[...Object.values(media.products),...media.gallery.map(x=>x.src),...details.pages.map(x=>x.image)].filter(Boolean);
 const unique=[...new Set(sourcePaths)].filter(x=>x.startsWith('/assets/')||x.startsWith('/api/media/'));
 const records=await workerPool(unique,5,async p=>{
  if(p.includes('..')||p.includes('?')||p.includes('#'))return {path:p,error:'PATH_INVALID'};
  const external=SOURCE+p, suffix=p.startsWith('/api/media/')?'.jpg':'';
  const local='/assets/manufacturer'+p+suffix;
  const dest=resolve(ROOT,'.'+local);
  if(!dest.startsWith(resolve(ROOT,'assets','manufacturer')))return {path:p,error:'PATH_OUTSIDE'};
  if(existsSync(dest)){const b=readFileSync(dest);return {path:p,local,sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length,existing:true}}
  const result=await get(external,'image');if(result.error)return {path:p,error:result.error};
  mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,result.bytes);
  return {path:p,local,sha256:result.sha256,bytes:result.bytes};
 });
 writeFileSync(join(ROOT,'assets','manufacturer','manifest.json'),JSON.stringify({origin:SOURCE,createdOn:new Date().toISOString(),images:records},null,2)+'\n');
 console.log(JSON.stringify({stage:'assets',unique:unique.length,downloaded:records.filter(x=>!x.error).length,failed:records.filter(x=>x.error),bytes:records.filter(x=>!x.error).reduce((sum,x)=>sum+x.bytes,0),output:'assets/manufacturer/manifest.json'}));
}
else throw Error('mode must be collect or assets');
function SOURCEliteral(){return SOURCE}
