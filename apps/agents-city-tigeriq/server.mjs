// Local-only Animal City preview. No mutation route, no second work queue.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {fetchCoreSnapshot} from './core-readonly.mjs';

const htmlPath = fileURLToPath(new URL('./index.html', import.meta.url));
const scriptPath = fileURLToPath(new URL('./app.js', import.meta.url));

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

export function createAnimalCityServer({fetchImpl = fetch} = {}) {
  return createServer(async (req, res) => {
    const port = req.socket.localPort;
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) {
      return send(res,403,'Forbidden','text/plain; charset=utf-8');
    }
    if (req.method !== 'GET') return send(res,405,'Read-only','text/plain; charset=utf-8');
    const route = (req.url || '').split('?')[0];
    if (route === '/api/rooms') {
      try {
        const snapshot = await fetchCoreSnapshot({fetchImpl});
        return send(res,200,JSON.stringify(snapshot),'application/json; charset=utf-8');
      } catch (error) {
        // Do not render old, cached or invented statuses on source failure.
        const type = ['CORE_SOURCE_UNVERIFIED','CORE_SOURCE_STALE','CORE_HTTP_UNAVAILABLE',
          'CORE_BODY_TOO_LARGE','CORE_JSON_INVALID'].includes(error?.message)
          ? error.message : 'CORE_SOURCE_UNAVAILABLE';
        return send(res,503,JSON.stringify({ok:false,reason:type,rooms:[],readOnly:true}),
          'application/json; charset=utf-8');
      }
    }
    if (route === '/health') return send(res,200,
      JSON.stringify({ok:true,mode:'READ_ONLY_PREVIEW',sourceCheck:'NOT_PERFORMED'}),
      'application/json; charset=utf-8');
    if (route === '/favicon.ico') return send(res,204,'','text/plain');
    if (route === '/' || route === '/app.js') {
      try {
        const content = await readFile(route === '/' ? htmlPath : scriptPath);
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
  const server = createAnimalCityServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(JSON.stringify({event:'TIGERIQ_ANIMAL_CITY_PREVIEW_READY',
      url:'http://127.0.0.1:' + port,writeRoutes:false}));
  });
}
