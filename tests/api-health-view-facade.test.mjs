import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/health-view.mjs';
import {createDeviceSession,createPairLinkToken,verifyPairLinkToken,authorizedDevice,DEVICE_COOKIE} from '../api/live-device-auth.mjs';
import pairHandler from '../api/live-device.mjs';

function mockRes() {
  return { headers:{}, statusCode:200, body:null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; }
  };
}
const deviceHeader = { cookie:DEVICE_COOKIE+'='+createDeviceSession('x'.repeat(64)) };
test('Vercel facade is owner-login protected and only reads PC01 allowlist', async () => {
  const prev = {};
  for (const k of ['TIGERIQ_LIVE_DEVICE_KEY','TIGERIQ_HEALTH_VIEW_ORIGIN','TIGERIQ_HEALTH_VIEW_KEY','TIGERIQ_HEALTH_VIEW_PATH_PREFIX']) {
    prev[k] = process.env[k];
  }
  const oldFetch = global.fetch;
  process.env.TIGERIQ_LIVE_DEVICE_KEY = 'x'.repeat(64);
  process.env.TIGERIQ_HEALTH_VIEW_ORIGIN = 'https://pc01.tail35d2f3.ts.net';
  process.env.TIGERIQ_HEALTH_VIEW_KEY = 'a'.repeat(48);
  let count = 0, lastUrl = null, lastHeader = null;
  global.fetch = async (url, options) => {
    count++; lastUrl = String(url); lastHeader=options.headers.authorization;
    return new Response('<!doctype html><html><body><script src="/work-center.js"></script><script>fetch("/api/status")</script></body></html>', {
      headers:{'content-type':'text/html'}
    });
  };
  try {
    let res = mockRes();
    await handler({method:'GET',headers:{},query:{resource:''}},res);
    assert.equal(res.statusCode,403);
    assert.equal(count,0);
    assert.equal(res.headers['www-authenticate'],undefined);
    res = mockRes();
    await handler({method:'POST',headers:{...deviceHeader},query:{resource:'api/status'}},res);
    assert.equal(res.statusCode,405); assert.equal(count,0);
    res = mockRes();
    await handler({method:'GET',headers:{...deviceHeader},query:{resource:'api/objectives'}},res);
    assert.equal(res.statusCode,404); assert.equal(count,0);
    res = mockRes();
    await handler({method:'GET',headers:{...deviceHeader},query:{resource:''}},res);
    assert.equal(res.statusCode,200);
    assert.equal(lastUrl,'https://pc01.tail35d2f3.ts.net/');
    assert.equal(lastHeader,'Bearer ' + 'a'.repeat(48));
    assert.match(String(res.body), /\/pc01\/work-center\.js/);
    assert.match(String(res.body), /\/pc01\/api\/status/);
    assert.match(String(res.body), /tiq-proxy-mobile-reload-bootstrap/);
    assert.match(String(res.body), /bottom:calc\(20px \+ env\(safe-area-inset-bottom\)\)/);
    assert.match(String(res.body), /location\.reload\(\)/);
    assert.match(String(res.body), /aria-label','Tải lại trang/);
    assert.equal((String(res.body).match(/id="tiq-proxy-mobile-reload-bootstrap"/g)||[]).length,1);
    process.env.TIGERIQ_HEALTH_VIEW_PATH_PREFIX='/health-view';
    res=mockRes();
    await handler({method:'GET',headers:{...deviceHeader},query:{resource:'api/status'}},res);
    assert.equal(res.statusCode,200);
    assert.equal(lastUrl,'https://pc01.tail35d2f3.ts.net/health-view/api/status');
    process.env.TIGERIQ_HEALTH_VIEW_PATH_PREFIX='/../mcp';
    res=mockRes();
    await handler({method:'GET',headers:{...deviceHeader},query:{resource:''}},res);
    assert.equal(res.statusCode,503);
    assert.equal(res.body,'HEALTH_VIEW_PATH_INVALID');
    delete process.env.TIGERIQ_HEALTH_VIEW_PATH_PREFIX;
    res=mockRes();
    await handler({method:'GET',headers:{...deviceHeader},query:{resource:'api/work-history',number:'../1'}},res);
    assert.equal(res.statusCode,400);
  } finally {
    global.fetch=oldFetch;
    for (const k of Object.keys(prev)) {
      if (prev[k]===undefined) delete process.env[k]; else process.env[k]=prev[k];
    }
  }
});

test('owner invitation requires same-origin HTTPS and grants a signed device cookie',async()=>{
 const key='x'.repeat(64),old=process.env.TIGERIQ_LIVE_DEVICE_KEY;
 process.env.TIGERIQ_LIVE_DEVICE_KEY=key;
 try{
  const now=Date.now(),token=createPairLinkToken(key,now,100);
  assert.ok(verifyPairLinkToken(token,key,now));
  assert.equal(verifyPairLinkToken(token,key,now+101000),null);
  const request=(origin)=>({method:'POST',headers:{host:'tigeriq-ai-lab.vercel.app',origin},body:{token}});
  let response=mockRes();
  await pairHandler(request('https://different.example'),response);
  assert.equal(response.statusCode,403);
  response=mockRes();
  await pairHandler(request('https://tigeriq-ai-lab.vercel.app'),response);
  assert.equal(response.statusCode,200);
  assert.ok(authorizedDevice(response.headers['set-cookie'].split(';')[0],key));
  assert.match(response.headers['set-cookie'],/HttpOnly; Secure; SameSite=Lax/);
  response=mockRes();
  await pairHandler({method:'GET',headers:{}},response);
  assert.equal(response.statusCode,200);
  assert.match(response.body,/history.replaceState/);
  assert.ok(response.body.includes('new URLSearchParams(location.search)'));
  assert.ok(response.body.includes("query.get('invite')"));
  assert.ok(response.body.includes("fragment.get('token')"));
 }finally{
  if(old===undefined)delete process.env.TIGERIQ_LIVE_DEVICE_KEY;
  else process.env.TIGERIQ_LIVE_DEVICE_KEY=old;
 }
});
