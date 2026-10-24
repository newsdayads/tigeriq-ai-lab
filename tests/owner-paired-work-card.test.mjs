import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceSession, sessionCookie } from '../api/live-device-auth.mjs';
import { authorizedPairedWorkCardDevice } from '../apps/shared/owner-paired-work-card.mjs';

const key='owner-paired-device-ci-validated-key-0123456789ABCDEFGHIJKLMNOPQ';
const cookie=sessionCookie(createDeviceSession(key)).split(';')[0];
const req=(extra={})=>({headers:{host:'tigeriq-ai-lab.vercel.app',cookie,...extra}});
test('only a valid cryptographically signed enrolled device can access scoped work-card intake',()=>{
 assert.equal(authorizedPairedWorkCardDevice(req(),{enabled:'enabled',key}),true);
 assert.equal(authorizedPairedWorkCardDevice(req(),{enabled:'disabled',key}),false);
 assert.equal(authorizedPairedWorkCardDevice(req(),{enabled:'enabled',key:'wrong'.repeat(15)}),false);
 assert.equal(authorizedPairedWorkCardDevice(req({cookie:cookie+'x'}),{enabled:'enabled',key}),false);
 assert.equal(authorizedPairedWorkCardDevice(req({cookie:''}),{enabled:'enabled',key}),false);
 assert.equal(authorizedPairedWorkCardDevice(req({host:'not-our-app.example'}),{enabled:'enabled',key}),false);
 assert.equal(authorizedPairedWorkCardDevice(req({host:'tigeriq-ai-lab.vercel.app.attacker.test'}),{enabled:'enabled',key}),false);
});
test('view cookie grant is bounded to Owner request only; generic API authorization remains Owner session',async()=>{
 const {default:handler}=await import('../api/control.mjs');
 // Even with a valid signed viewer cookie, generic /api/control credential
 // paths must NOT gain GitHub mutation power through the scoped grant.
 const priorKey=process.env.TIGERIQ_LIVE_DEVICE_KEY,priorFlag=process.env.TIGERIQ_OWNER_WORK_CARD_PAIRED_DEVICE_MODE;
 process.env.TIGERIQ_LIVE_DEVICE_KEY=key;process.env.TIGERIQ_OWNER_WORK_CARD_PAIRED_DEVICE_MODE='enabled';
 const body=JSON.stringify({operation:'whoami'});
 const request={method:'POST',url:'/api/control',headers:{host:'tigeriq-ai-lab.vercel.app',origin:'https://tigeriq-ai-lab.vercel.app',cookie,'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(body)}};
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},end(text=''){this.body=String(text)}};
 try{await handler(request,res);assert.equal(res.statusCode,401);}
 finally{
  if(priorKey===undefined)delete process.env.TIGERIQ_LIVE_DEVICE_KEY;else process.env.TIGERIQ_LIVE_DEVICE_KEY=priorKey;
  if(priorFlag===undefined)delete process.env.TIGERIQ_OWNER_WORK_CARD_PAIRED_DEVICE_MODE;else process.env.TIGERIQ_OWNER_WORK_CARD_PAIRED_DEVICE_MODE=priorFlag;
 }
});
