import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const PORT=Number(process.env.PORT||8893);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
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
    const data=await readFile(path);
    res.writeHead(200,{'content-type':MIME[extname(path).toLowerCase()]||'application/octet-stream','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'SAMEORIGIN','cache-control':extname(path)==='.html'?'no-cache':'public,max-age=3600'});
    res.end(req.method==='HEAD'?'':data);
  } catch(e){res.writeHead(500);res.end('Internal Server Error');}
});
server.listen(PORT,'127.0.0.1',()=>console.log(`ultracar-hcm-web http://127.0.0.1:${PORT}`));