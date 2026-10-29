// Local-only Animal City operational server. No mutation route, no second work queue.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {fetchCoreSnapshot} from './core-readonly.mjs';
import {fetchLiveCoreSnapshot} from './core-live-readonly.mjs';
import {createOwnerActions} from './owner-actions.mjs';

const htmlPath = fileURLToPath(new URL('./index.html', import.meta.url));
const scriptPath = fileURLToPath(new URL('./app.js', import.meta.url));
const scenePath = fileURLToPath(new URL('./scene3d.js', import.meta.url));
const ownerConsolePath = fileURLToPath(new URL('./owner-console.js', import.meta.url));

function send(res, status, body, type) {
  res.writeHead(status, {
    'content-type':type,
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer',
    'x-frame-options':'DENY',
    'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

function sourceFailure(error, live = false) {
  const known = live
    ? ['CORE_LIVE_UNVERIFIED','CORE_LIVE_STALE','CORE_LIVE_HTTP_UNAVAILABLE',
       'CORE_LIVE_BODY_TOO_LARGE','CORE_LIVE_JSON_INVALID']
    : ['CORE_SOURCE_UNVERIFIED','CORE_SOURCE_STALE','CORE_HTTP_UNAVAILABLE',
       'CORE_BODY_TOO_LARGE','CORE_JSON_INVALID'];
  return known.includes(error?.message) ? error.message :
    live ? 'CORE_LIVE_SOURCE_UNAVAILABLE' : 'CORE_SOURCE_UNAVAILABLE';
}

export function createAnimalCityServer({fetchImpl = fetch, startedAt = new Date().toISOString()} = {}) {
  const owner=createOwnerActions({fetchImpl});
  return createServer(async (req, res) => {
    const port = req.socket.localPort;
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) {
      return send(res,403,'Forbidden','text/plain; charset=utf-8');
    }
    const route = (req.url || '').split('?')[0];
    // Only this explicit, CSRF-protected action can write, via native Core.
    if (route === '/api/owner-objectives' && req.method === 'POST') {
      const result=await owner.postObjective(req,port);
      return send(res,result.status,JSON.stringify(result.body),'application/json; charset=utf-8');
    }
    if (req.method !== 'GET') return send(res,405,'Method not allowed','text/plain; charset=utf-8');
    if (route === '/api/owner-config') return send(res,200,JSON.stringify(owner.config()),
      'application/json; charset=utf-8');
    if (route === '/api/owner-objectives') {
      const result=await owner.recentObjectives();
      return send(res,result.status,JSON.stringify(result.body),'application/json; charset=utf-8');
    }

    if (route === '/api/rooms') {
      try {
        const snapshot = await fetchCoreSnapshot({fetchImpl});
        return send(res,200,JSON.stringify(snapshot),'application/json; charset=utf-8');
      } catch (error) {
        return send(res,503,JSON.stringify({
          ok:false,reason:sourceFailure(error),rooms:[],readOnly:true,
        }),'application/json; charset=utf-8');
      }
    }

    if (route === '/api/live') {
      try {
        const snapshot = await fetchLiveCoreSnapshot({fetchImpl});
        return send(res,200,JSON.stringify(snapshot),'application/json; charset=utf-8');
      } catch (error) {
        return send(res,503,JSON.stringify({
          ok:false,reason:sourceFailure(error,true),workers:[],
          liveWorkerBindingsVerified:false,
        }),'application/json; charset=utf-8');
      }
    }

    if (route === '/health') return send(res,200,JSON.stringify({
      ok:true,
      mode:'OPERATIONAL_LOCAL',
      pid:process.pid,
      startedAt,
      uptimeSec:Math.max(0,Math.floor((Date.now()-Date.parse(startedAt))/1000)),
      loopbackOnly:true,
      writeRoutes:['POST /api/owner-objectives (LOCAL P2, browser confirmation)'],
    }),'application/json; charset=utf-8');

    if (route === '/ready') {
      try {
        const [workOrders,live] = await Promise.all([
          fetchCoreSnapshot({fetchImpl}),
          fetchLiveCoreSnapshot({fetchImpl}),
        ]);
        return send(res,200,JSON.stringify({
          ok:true,mode:'OPERATIONAL_LOCAL',
          workOrders:{ok:true,verifiedAt:workOrders.verifiedAt,total:workOrders.total},
          live:{ok:true,verifiedAt:live.verifiedAt,totalActiveWorkers:live.totalActiveWorkers},
        }),'application/json; charset=utf-8');
      } catch (error) {
        return send(res,503,JSON.stringify({
          ok:false,mode:'OPERATIONAL_LOCAL',reason:sourceFailure(error,
            String(error?.message||'').startsWith('CORE_LIVE_')),
        }),'application/json; charset=utf-8');
      }
    }

    if (route === '/favicon.ico') return send(res,204,'','text/plain');
    if (route === '/' || route === '/app.js' || route === '/scene3d.js' || route === '/owner-console.js') {
      try {
        const path = route === '/' ? htmlPath : route === '/app.js' ? scriptPath : route === '/scene3d.js' ? scenePath : ownerConsolePath;
        const content = await readFile(path);
        return send(res,200,content,route === '/' ? 'text/html; charset=utf-8' :
          'text/javascript; charset=utf-8');
      } catch {
        return send(res,500,'APP_ASSET_UNAVAILABLE','text/plain; charset=utf-8');
      }
    }
    return send(res,404,'Not found','text/plain; charset=utf-8');
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.TIGERIQ_ANIMAL_PORT || 8866);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('INVALID_LISTEN_PORT');
  const startedAt = new Date().toISOString();
  const server = createAnimalCityServer({startedAt});
  server.listen(port, '127.0.0.1', () => {
    console.log(JSON.stringify({event:'TIGERIQ_ANIMAL_CITY_OPERATIONAL_READY',
      url:'http://127.0.0.1:' + port,startedAt,writeRoutes:['LOCAL_P2_OBJECTIVE'],loopbackOnly:true}));
  });
}
