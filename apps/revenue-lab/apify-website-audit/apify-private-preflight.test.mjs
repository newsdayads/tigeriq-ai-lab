import test from 'node:test';
import assert from 'node:assert/strict';
import { runPrivateApifyPreflight, ApifyPreflightError, safePreflightError } from './apify-private-preflight.mjs';

const env = {
  APIFY_TOKEN: 'secret-token-value',
  APIFY_ACTOR_ID: 'actor123',
  APIFY_ACTOR_VERSION: '0.1',
  APIFY_PREFLIGHT_EXECUTE: 'OWNER_APPROVED_PRIVATE_PREFLIGHT',
};

const response = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

function successFetch() {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://api.apify.com/v2/users/me') {
      return response(200, { data: {
        id: 'user1',
        username: 'owner',
        email: 'must-not-leak@example.com',
        profile: { name: 'Must Not Leak' },
      } });
    }
    if (String(url) === 'https://api.apify.com/v2/actors/actor123') {
      return response(200, { data: {
        id: 'actor123',
        name: 'website-audit',
        username: 'owner',
        isPublic: false,
        actorPermissionLevel: 'LIMITED_PERMISSIONS',
        versions: [{ versionNumber: '0.1' }],
      } });
    }
    throw new Error('unexpected URL ' + url);
  };
  return { fetchFn, calls };
}

test('success verifies private limited Actor without leaking private profile data', async () => {
  const { fetchFn, calls } = successFetch();
  let written = null;
  const evidence = await runPrivateApifyPreflight({
    env: { ...env, APIFY_PREFLIGHT_EVIDENCE_PATH: 'preflight.json' },
    fetchFn,
    writeFileFn: async (_path, data) => { written = data; },
    now: () => '2026-09-29T00:00:00.000Z',
  });

  assert.equal(evidence.schema, 'TIGERIQ_APIFY_PRIVATE_PREFLIGHT_V1');
  assert.deepEqual(evidence.account, { status: 'VERIFIED', id: 'user1', username: 'owner' });
  assert.equal(evidence.actor.isPublic, false);
  assert.equal(evidence.actor.actorPermissionLevel, 'LIMITED_PERMISSIONS');
  assert.equal(evidence.actor.expectedVersionPresent, true);
  assert.equal(evidence.permissions.buildPermission, 'UNVERIFIED_UNTIL_E2E');
  assert.equal(evidence.permissions.runPermission, 'UNVERIFIED_UNTIL_E2E');
  assert.equal(evidence.permissions.outputStorageReadPermission, 'UNVERIFIED_UNTIL_E2E');
  assert.deepEqual(evidence.safety.methodsUsed, ['GET']);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.method === 'GET'));
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  assert.ok(calls.every(call => call.options.headers.authorization === 'Bearer ' + env.APIFY_TOKEN));
  assert.ok(calls.every(call => !call.url.includes(env.APIFY_TOKEN)));
  assert.ok(!written.includes(env.APIFY_TOKEN));
  assert.ok(!written.includes('must-not-leak@example.com'));
  assert.ok(!written.includes('Must Not Leak'));
});

test('auth failure is fail-closed and redacts token', async () => {
  const fetchFn = async () => response(401, { error: { message: 'bad secret-token-value' } });
  await assert.rejects(
    () => runPrivateApifyPreflight({ env, fetchFn }),
    error => {
      assert.ok(error instanceof ApifyPreflightError);
      assert.equal(error.code, 'API_HTTP_ERROR');
      assert.ok(!JSON.stringify(error.detail).includes(env.APIFY_TOKEN));
      return true;
    },
  );
});

test('scoped token may skip users/me on 403 but must still verify Actor access', async () => {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/users/me')) return response(403, { error: { message: 'insufficient permissions' } });
    return response(200, { data: {
      id: 'actor123', name: 'website-audit', username: 'owner',
      isPublic: false, actorPermissionLevel: 'LIMITED_PERMISSIONS',
      versions: [{ versionNumber: '0.1' }],
    } });
  };
  const evidence = await runPrivateApifyPreflight({ env, fetchFn });
  assert.deepEqual(evidence.account, { status: 'SKIPPED_SCOPED_FORBIDDEN' });
  assert.equal(evidence.permissions.readAccess, 'VERIFIED_BY_GET');
  assert.equal(calls.length, 2);
});

test('preflight rejects mismatched Actor ID after authenticated GET', async () => {
  const calls=[];
  const fetchFn=async url=>{
    calls.push(String(url));
    return String(url).endsWith('/users/me')
      ? response(200,{data:{id:'user1',username:'owner'}})
      : response(200,{data:{id:'impostor123',name:'website-audit',username:'owner',
        isPublic:false,actorPermissionLevel:'LIMITED_PERMISSIONS',
        versions:[{versionNumber:'0.1'}]}});
  };
  await assert.rejects(()=>runPrivateApifyPreflight({env,fetchFn}),
    error=>error instanceof ApifyPreflightError && error.code==='ACTOR_IDENTITY_MISMATCH');
  assert.equal(calls.length,2);
});

test('preflight rejects JSONP/HTML MIME before a second GET or valid Actor acceptance', async () => {
  for(const contentType of ['application/jsonp','application/json-seq','text/html',
                             'text/application/json','application/jsonxyz']) {
    let calls=0;
    const fetchFn=async url=>{
      calls++;
      const data=String(url).endsWith('/users/me')
        ? {id:'user1',username:'owner'}
        : {id:'actor123',name:'website-audit',username:'owner',isPublic:false,
           actorPermissionLevel:'LIMITED_PERMISSIONS',versions:[{versionNumber:'0.1'}]};
      return new Response(JSON.stringify({data}),{headers:{'content-type':contentType}});
    };
    await assert.rejects(()=>runPrivateApifyPreflight({env,fetchFn}),
      error=>error instanceof ApifyPreflightError && error.code==='JSON_CONTENT_TYPE_REQUIRED');
    assert.equal(calls,1,contentType);
  }
});

test('preflight accepts correctly delimited JSON with charset', async () => {
  const calls=[];
  const fetchFn=async url=>{
    calls.push(String(url));
    const data=String(url).endsWith('/users/me')
      ? {id:'user1',username:'owner'}
      : {id:'actor123',name:'website-audit',username:'owner',isPublic:false,
         actorPermissionLevel:'LIMITED_PERMISSIONS',versions:[{versionNumber:'0.1'}]};
    return new Response(JSON.stringify({data}),{headers:{'content-type':'Application/JSON; charset=UTF-8'}});
  };
  const evidence=await runPrivateApifyPreflight({env,fetchFn});
  assert.equal(evidence.actor.id,env.APIFY_ACTOR_ID);
  assert.equal(calls.length,2);
});

test('preflight GET operations have bounded timeout signals', async () => {
  const { fetchFn, calls } = successFetch();
  await runPrivateApifyPreflight({ env, fetchFn });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.ok(call.options.signal instanceof AbortSignal,
      'each authenticated GET must include a native abort signal');
    assert.equal(call.options.signal.aborted, false);
  }
});

test('public Actor fails closed', async () => {
  const fetchFn = async url => String(url).endsWith('/users/me')
    ? response(200, { data: { id: 'user1', username: 'owner' } })
    : response(200, { data: {
      id: 'actor123', name: 'website-audit', username: 'owner',
      isPublic: true, actorPermissionLevel: 'LIMITED_PERMISSIONS',
      versions: [{ versionNumber: '0.1' }],
    } });
  await assert.rejects(
    () => runPrivateApifyPreflight({ env, fetchFn }),
    error => error instanceof ApifyPreflightError && error.code === 'ACTOR_NOT_PRIVATE',
  );
});

test('full-permission Actor fails closed', async () => {
  const fetchFn = async url => String(url).endsWith('/users/me')
    ? response(200, { data: { id: 'user1', username: 'owner' } })
    : response(200, { data: {
      id: 'actor123', name: 'website-audit', username: 'owner',
      isPublic: false, actorPermissionLevel: 'FULL_PERMISSIONS',
      versions: [{ versionNumber: '0.1' }],
    } });
  await assert.rejects(
    () => runPrivateApifyPreflight({ env, fetchFn }),
    error => error instanceof ApifyPreflightError && error.code === 'ACTOR_PERMISSION_TOO_BROAD',
  );
});

test('missing expected Actor version fails closed', async () => {
  const fetchFn = async url => String(url).endsWith('/users/me')
    ? response(200, { data: { id: 'user1', username: 'owner' } })
    : response(200, { data: {
      id: 'actor123', name: 'website-audit', username: 'owner',
      isPublic: false, actorPermissionLevel: 'LIMITED_PERMISSIONS',
      versions: [{ versionNumber: '0.2' }],
    } });
  await assert.rejects(
    () => runPrivateApifyPreflight({ env, fetchFn }),
    error => error instanceof ApifyPreflightError && error.code === 'EXPECTED_VERSION_MISSING',
  );
});

test('execution gate blocks before any request', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return response(500, {}); };
  const gated = { ...env };
  delete gated.APIFY_PREFLIGHT_EXECUTE;
  await assert.rejects(
    () => runPrivateApifyPreflight({ env: gated, fetchFn }),
    error => error instanceof ApifyPreflightError && error.code === 'EXECUTION_GATE_REQUIRED',
  );
  assert.equal(called, false);
});

test('production API origin and methods are fixed', async () => {
  const { fetchFn, calls } = successFetch();
  await runPrivateApifyPreflight({
    env: { ...env, APIFY_API_BASE: 'https://evil.test/v2' },
    fetchFn,
  });
  assert.deepEqual(calls.map(call => call.url), [
    'https://api.apify.com/v2/users/me',
    'https://api.apify.com/v2/actors/actor123',
  ]);
  assert.ok(calls.every(call => call.options.method === 'GET'));
});

test('safe error never exposes token', () => {
  const safe = safePreflightError(
    new ApifyPreflightError('X', 'failed secret-token-value', { token: 'secret-token-value' }),
    env,
  );
  const serialized = JSON.stringify(safe);
  assert.ok(!serialized.includes(env.APIFY_TOKEN));
  assert.ok(serialized.includes('[REDACTED]'));
});

test('preflight refuses declared oversized private Actor API JSON before a second GET', async () => {
  let count = 0;
  const fetchFn = async () => {
    count++;
    return new Response(JSON.stringify({data:{id:'u',username:'owner'}}), {
      headers:{'content-type':'application/json','content-length':'131073'},
    });
  };
  await assert.rejects(
    () => runPrivateApifyPreflight({env,fetchFn}),
    error => error instanceof ApifyPreflightError && error.code==='RESPONSE_TOO_LARGE',
  );
  assert.equal(count,1);
});

test('preflight aborts streaming oversized JSON before third 64KiB chunk is retained', async () => {
  let chunks=0,cancelled=0,calls=0;
  const payload=new ReadableStream({
    pull(controller){if(chunks>=4){controller.close();return;}chunks++;controller.enqueue(new Uint8Array(65536).fill(120));},
    cancel(){cancelled++;},
  });
  const fetchFn=async()=>{calls++;return new Response(payload,{headers:{'content-type':'application/json'}})};
  await assert.rejects(
    () => runPrivateApifyPreflight({env,fetchFn}),
    error => error instanceof ApifyPreflightError && error.code==='RESPONSE_TOO_LARGE',
  );
  assert.equal(calls,1);
  assert.equal(cancelled,1);
  assert.ok(chunks<=5,'stream must be bounded before buffering untrusted body');
});
