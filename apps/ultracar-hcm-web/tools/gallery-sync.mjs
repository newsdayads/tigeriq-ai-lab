import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const ROOT=process.cwd();
const SOURCE='https://ultracar.vn/thu-vien/';
const BASE='https://ultracar.vn';
const decode=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g,' ').trim();
const attr=(tag,key)=>tag.match(new RegExp(key+'=["\\x27]([^"\\x27]*)["\\x27]','i'))?.[1]||'';
const html=await fetch(SOURCE,{signal:AbortSignal.timeout(25000)}).then(r=>{if(!r.ok)throw Error('HTTP_'+r.status);return r.text()});
const cards=[...html.matchAll(/<article\b([^>]*\bclass=["']uc-media-card["'][^>]*)>([\s\S]*?)<\/article>/gi)];
const rows=cards.map((m,i)=>{
 const tag=m[1],body=m[2];
 const imageTag=body.match(/<img\b[^>]*>/i)?.[0]||'';
 const mainLink=body.match(/<a\b[^>]*class=["']uc-photo-link["'][^>]*>/i)?.[0]||'';
 const local=attr(mainLink,'href');
 const thumbnail=attr(imageTag,'src');
 const header=body.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1]||'';
 const title=decode(header)||decode(attr(imageTag,'alt'))||'Hình lắp đặt';
 return {id:attr(tag,'data-media-id')||String(i),brand:attr(tag,'data-media-brand'),models:attr(tag,'data-media-models'),type:attr(tag,'data-media-kind'),topic:attr(tag,'data-media-topic'),review:attr(tag,'data-media-review')==='true',title,image:local&&local.startsWith('/assets/')?local:'',thumb:thumbnail&&thumbnail.startsWith('/assets/')?thumbnail:''};
}).filter(x=>x.image&&x.type==='photo');
const unique=[...new Set(rows.flatMap(x=>[x.image,x.thumb]).filter(Boolean))];
const destBase=join(ROOT,'assets','gallery');
mkdirSync(destBase,{recursive:true});
async function one(path){
 const dest=resolve(ROOT,'.'+('/assets/gallery'+path));
 if(!dest.startsWith(destBase))throw Error('UNSAFE_PATH');
 const url=BASE+path;
 if(existsSync(dest)){const bytes=readFileSync(dest);return {path,local:'/assets/gallery'+path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}};
 for(let tryN=0;tryN<3;tryN++){
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(22000)});if(!r.ok)throw Error('HTTP_'+r.status);
   const type=r.headers.get('content-type')||'';if(!/^image\/(webp|jpeg|png)/i.test(type))throw Error('BAD_TYPE_'+type);
   const b=Buffer.from(await r.arrayBuffer());if(b.length<500||b.length>15000000)throw Error('BAD_SIZE_'+b.length);
   mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,b);
   return {path,local:'/assets/gallery'+path,sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length};
  }catch(err){if(tryN===2)return {path,error:String(err.message)};await new Promise(r=>setTimeout(r,350*(tryN+1)))}
 }
}
let next=0,done=0;const assets=new Array(unique.length);
await Promise.all(Array.from({length:5},async()=>{while(next<unique.length){const i=next++;assets[i]=await one(unique[i]);done++;if(done%50===0)console.log('DOWNLOADED',done,'/',unique.length)}}));
const manifest={source:SOURCE,createdOn:new Date().toISOString(),entries:rows,assets};
writeFileSync(join(ROOT,'gallery.json'),JSON.stringify(manifest,null,2)+'\n');
const errors=assets.filter(x=>x.error);
console.log(JSON.stringify({cards:cards.length,photoEntries:rows.length,uniqueAssets:assets.length,downloaded:assets.length-errors.length,errors:errors.length,totalBytes:assets.filter(x=>!x.error).reduce((a,x)=>a+x.bytes,0),brands:[...new Set(rows.map(x=>x.brand))].length}));
if(rows.length<200||errors.length>5)process.exitCode=1;
