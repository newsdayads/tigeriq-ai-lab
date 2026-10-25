/** GH-5284 S03: bounded, non-production loopback preview for the existing five-level build.
 * Publishing to PC01 and device actions require a separate authorized native owner.
 */
import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const DIST=resolve(import.meta.dirname,'../dist');
const HOST='127.0.0.1';
const PORT=4173;
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const SAFE=/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:html|css|js)$/;
const SHA=bytes=>createHash('sha256').update(bytes).digest('hex');
const commonHeaders=Object.freeze({
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'x-robots-tag':'noindex, nofollow',
});
const json=(res,status,data)=>{res.writeHead(status,{...commonHeaders,'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data)+'\n');};

export function createS10PreviewServer({distDir=DIST}={}) {
  const root=resolve(distDir);
  return createServer(async(req,res)=>{
    Object.entries(commonHeaders).forEach(([k,v])=>res.setHeader(k,v));
    if(!['GET','HEAD'].includes(req.method||'')){
      res.writeHead(405,{'allow':'GET, HEAD'});res.end();return;
    }
    const route=req.url==='/'
      ? '/index.html' : (req.url||'');
    // No percent encoding, query, absolute paths, directory traversal, or fallback.
    if(route!=='/healthz'&&(!SAFE.test(route)||route.includes('..'))){
      res.writeHead(404);res.end();return;
    }
    try{
      const rootReal=await realpath(root);
      const requested=route==='/healthz'?'/index.html':route;
      const file=resolve(root,requested.slice(1));
      const fileReal=await realpath(file);
      if(!fileReal.startsWith(rootReal+sep)){
        res.writeHead(404);res.end();return;
      }
      const bytes=await readFile(fileReal);
      if(route==='/healthz'){
        json(res,200,{schema:'TIGERIQ_G06_LOCAL_PREVIEW_HEALTH_V1',previewReady:true,
          transport:'127.0.0.1_LOOPBACK_ONLY',indexSha256:SHA(bytes),
          nativeAdapterConnected:false,deviceLeaseVerified:false,
          realDeviceAccepted:false,production:false});
        return;
      }
      const extension=fileReal.slice(fileReal.lastIndexOf('.'));
      res.writeHead(200,{'content-type':TYPES[extension],'content-length':bytes.byteLength});
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch{
      // Missing built files or denied filesystem access is not a running preview.
      json(res,503,{code:'PREVIEW_BUILD_UNAVAILABLE',previewReady:false,
        realDeviceAccepted:false,production:false});
    }
  });
}

export async function serveS10Preview(argv=process.argv.slice(2)){
  if(argv.length!==1||argv[0]!=='--serve')throw Error('EXPLICIT_SERVE_FLAG_REQUIRED');
  const server=createS10PreviewServer();
  await new Promise((resolveListen,reject)=>{
    server.once('error',reject);
    server.listen(PORT,HOST,resolveListen);
  });
  process.stdout.write(JSON.stringify({previewListening:true,url:'http://127.0.0.1:4173/',
    deviceAuthorized:false,leaseClaimed:false,production:false})+'\n');
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  serveS10Preview().catch(error=>{console.error('G06_PREVIEW_NOT_STARTED',error.message);process.exitCode=1;});
}
