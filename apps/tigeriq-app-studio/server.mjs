import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const host='127.0.0.1',defaultPort=8902,name='tigeriq-app-studio';
let cached=null;
function hash(text){return "'sha256-"+createHash('sha256').update(text).digest('base64')+"'";}
async function site(){
  if(cached)return cached;
  const html=await readFile(join(root,'index.html'));
  const text=html.toString('utf8');
  const styles=[...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>hash(m[1])).join(' ');
  const scripts=[...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>hash(m[1])).join(' ');
  const csp="default-src 'none'; script-src 'self' "+scripts+"; style-src 'self' "+styles+"; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; upgrade-insecure-requests";
  cached={html,csp};return cached;
}
const baseHeaders={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cache-Control':'no-store'};
function send(res,status,body,type,method,csp){const data=Buffer.isBuffer(body)?body:Buffer.from(body);res.writeHead(status,{...baseHeaders,'Content-Type':type,'Content-Length':data.length,...(csp?{'Content-Security-Policy':csp}:{})});res.end(method==='HEAD'?undefined:data);}
export function createSiteServer(){return createServer(async(req,res)=>{
  const method=req.method||'';if(!['GET','HEAD'].includes(method)){res.setHeader('Allow','GET, HEAD');return send(res,405,'Method not allowed','text/plain; charset=utf-8',method);}
  let url;try{url=new URL(req.url||'/', 'http://localhost');}catch{return send(res,400,'Bad request','text/plain; charset=utf-8',method);}
  if(url.pathname==='/healthz')return send(res,200,JSON.stringify({status:'ok',service:name}),'application/json; charset=utf-8',method);
  if(url.pathname!=='/'&&url.pathname!=='/index.html')return send(res,404,'Not found','text/plain; charset=utf-8',method);
  try{const {html,csp}=await site();return send(res,200,html,'text/html; charset=utf-8',method,csp);}catch{return send(res,503,'Unavailable','text/plain; charset=utf-8',method);}
});}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||defaultPort);
 if(!Number.isSafeInteger(port)||port<1024||port>65535){process.stderr.write('INVALID_PORT\n');process.exitCode=2;}
 else{const server=createSiteServer();server.requestTimeout=10000;server.headersTimeout=12000;server.listen(port,host,()=>process.stdout.write(name+' READY http://'+host+':'+port+'\n'));server.on('error',e=>{process.stderr.write(String(e.code||e.message)+'\n');process.exitCode=1;});process.on('SIGTERM',()=>server.close());}
}
