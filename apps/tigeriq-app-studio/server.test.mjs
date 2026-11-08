import test from 'node:test';
import assert from 'node:assert/strict';
import {createSiteServer} from './server.mjs';
import {once} from 'node:events';
test('Loopback static site serves content safely and rejects internals',async()=>{
const server=createSiteServer();server.listen(0,'127.0.0.1');await once(server,'listening');
try{
const base='http://127.0.0.1:'+server.address().port;
const [page,health,privatePath,method,head]=await Promise.all([
fetch(base+'/'),fetch(base+'/healthz'),fetch(base+'/.git/config'),fetch(base+'/',{method:'POST'}),fetch(base+'/',{method:'HEAD'})
]);
assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);assert.equal(page.headers.get('x-frame-options'),'DENY');assert.match(page.headers.get('content-security-policy'),/sha256-/);
const html=await page.text();assert.match(html,/TigerIQ/);assert.match(html,/zalo\.me\/0392960003/);assert.match(html,/prefers-reduced-motion/);assert.match(html,/pointermove/);
assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');assert.equal(privatePath.status,404);assert.equal(method.status,405);assert.equal(head.status,200);
}finally{await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
});
