import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const PORT=Number(process.env.PORT||8893);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async (req,res)=>{
  try {
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});return res.end();}
    if(req.url?.split('?')[0]==='/healthz'){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});return res.end(req.method==='HEAD'?'':JSON.stringify({status:'ok',service:'ultracar-hcm-web'}));}
    const pathname=decodeURIComponent(new URL(req.url||'/', 'http://localhost').pathname);
    if(/\|\0/.test(pathname) || pathname.split('/').includes('..')){res.writeHead(400);return res.end();}
    const rel=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');
    const path=normalize(join(ROOT,rel));
    if(!path.startsWith(ROOT)){res.writeHead(403);return res.end();}
    const st=await stat(path).catch(()=>null);
    if(!st?.isFile()){res.writeHead(404);return res.end('Not Found');}
    if(extname(path).toLowerCase()==='.mp4'){
      const size=st.size;
      const common={'content-type':'video/mp4','accept-ranges':'bytes','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'SAMEORIGIN','cache-control':'public,max-age=3600'};
      let start=0,end=size-1,status=200;
      const requested=req.headers.range;
      if(requested){
        const m=/^bytes=(\d*)-(\d*)$/.exec(requested.trim());
        if(!m||(m[1]===''&&m[2]==='')){res.writeHead(416,{'content-range':'bytes */'+size});return res.end();}
        if(m[1]===''){const suffix=Number(m[2]);if(!Number.isSafeInteger(suffix)||suffix<=0){res.writeHead(416,{'content-range':'bytes */'+size});return res.end();}start=Math.max(0,size-suffix);}
        else{start=Number(m[1]);if(m[2]!=='')end=Number(m[2]);}
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start> end||start>=size||end<0){res.writeHead(416,{'content-range':'bytes */'+size});return res.end();}
        end=Math.min(end,size-1);status=206;
      }
      const headers={...common,'content-length':end-start+1};
      if(status===206)headers['content-range']='bytes '+start+'-'+end+'/'+size;
      res.writeHead(status,headers);
      if(req.method==='HEAD')return res.end();
      const stream=createReadStream(path,{start,end});
      stream.on('error',()=>res.destroy());
      return stream.pipe(res);
    }
    const data=await readFile(path);
    res.writeHead(200,{'content-type':MIME[extname(path).toLowerCase()]||'application/octet-stream','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'SAMEORIGIN','cache-control':extname(path)==='.html'?'no-cache':'public,max-age=3600'});
    res.end(req.method==='HEAD'?'':data);
  } catch(e){res.writeHead(500);res.end('Internal Server Error');}
});
server.listen(PORT,'127.0.0.1',()=>console.log(`ultracar-hcm-web http://127.0.0.1:${PORT}`));