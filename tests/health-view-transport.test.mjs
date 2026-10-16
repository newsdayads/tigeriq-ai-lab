import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {isResetConnection,readIpv4Https} from '../api/health-view.mjs';

test('transport retry is exclusively for reset and network failures',()=>{
  assert.equal(isResetConnection({cause:{code:'ECONNRESET'}}),true);
  assert.equal(isResetConnection({code:'ETIMEDOUT'}),true);
  assert.equal(isResetConnection({code:'EAI_AGAIN'}),true);
  assert.equal(isResetConnection(new Error('ordinary web failure')),false);
  assert.equal(isResetConnection({code:'EPERM'}),false);
});

function fakeRequestFactory({status=200,body='<title>TigerIQ AI</title>',type='text/html'}={}){
  const observations=[];
  const requestFactory=(url,opts,cb)=>{
    observations.push({url:String(url),opts});
    const req=new EventEmitter();
    req.end=()=>{
      queueMicrotask(()=>{
        const stream=new PassThrough();
        stream.statusCode=status;
        stream.headers={'content-type':type};
        cb(stream);
        stream.end(body);
      });
    };
    req.destroy=error=>req.emit('error',error);
    return req;
  };
  return {requestFactory,observations};
}

test('alternate transport keeps original TigerIQ HTML intact and uses IPv4 + GET + original TLS host',async()=>{
  const f=fakeRequestFactory();
  const target=new URL('https://pc01.tail35d2f3.ts.net/');
  const result=await readIpv4Https(target,'fake-unit-test-token',f.requestFactory);
  assert.equal(result.status,200);
  assert.equal(result.contentType,'text/html');
  assert.equal(result.raw.toString(),'<title>TigerIQ AI</title>');
  assert.equal(f.observations.length,1);
  assert.equal(f.observations[0].opts.family,4);
  assert.equal(f.observations[0].opts.method,'GET');
  assert.equal(f.observations[0].opts.agent,false);
  assert.equal(f.observations[0].opts.servername,'pc01.tail35d2f3.ts.net');
});

test('refuses redirects instead of following a new origin',async()=>{
  const f=fakeRequestFactory({status:302,body:'moved'});
  await assert.rejects(readIpv4Https(new URL('https://pc01.tail35d2f3.ts.net/'),'test',f.requestFactory),/redirect_rejected/);
});
