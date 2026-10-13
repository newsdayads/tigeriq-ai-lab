import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/health-view.mjs';
import {createDeviceSession,DEVICE_COOKIE} from '../api/live-device-auth.mjs';

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
  for (const k of ['TIGERIQ_LIVE_DEVICE_KEY','TIGERIQ_HEALTH_VIEW_ORIGIN','TIGERIQ_HEALTH_VIEW_KEY']) {
    prev[k] = process.env[k];
  }
  const oldFetch = global.fetch;
  process.env.TIGERIQ_LIVE_DEVICE_KEY = 'x'.repeat(64);
  process.env.TIGERIQ_HEALTH_VIEW_ORIGIN = 'https://pc01.tail35d2f3.ts.net';
  process.env.TIGERIQ_HEALTH_VIEW_KEY = 'a'.repeat(48);
  let count = 0, lastUrl = null, lastHeader = null;
  global.fetch = async (url, options) => {
    count++; lastUrl = String(url); lastHeader=options.headers.authorization;
    return new Response('<script src="/work-center.js"></script><script>fetch("/api/status")</script>', {
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
