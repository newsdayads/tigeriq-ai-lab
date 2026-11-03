import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRelay} from './relay.mjs';
test('pair authenticates once, logs dedupe, rejects gap',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-telemetry-'));
 const relay=createRelay(home);
 await new Promise(done=>relay.server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+relay.server.address().port;
 const post=async(uri,data,token)=>fetch(base+uri,{method:'POST',headers:{'content-type':'application/json',...(token?{'authorization':'Bearer '+token}:{})},body:JSON.stringify(data)});
 try{
  assert.equal((await post('/v1/events',{seq:1,events:'R'})).status,401);
  const code=relay.pairCode();const resp=await post('/camera-relay/v1/pair',{code});
  assert.equal(resp.status,200);const {token,id}=await resp.json();
  assert.equal((await post('/v1/pair',{code})).status,403);
  assert.equal((await post('/v1/events',{seq:1,events:'R_UNVERIFIED'},token)).status,200);
  assert.equal((await post('/v1/events',{seq:1,events:'R_UNVERIFIED'},token)).status,200);
  assert.equal((await post('/v1/events',{seq:3,events:'GAP'},token)).status,409);
  assert.equal(relay.status().clients[id].ack,1);
  assert.equal(fs.readFileSync(path.join(home,'camera-events.ndjson'),'utf8').split('R_UNVERIFIED').length-1,1);
 }finally{await new Promise(done=>relay.server.close(done));fs.rmSync(home,{recursive:true,force:true});}
});
test('publishes signed artifact only with expected hash/version',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-update-'));
 try{const relay=createRelay(home),apk=path.join(home,'mock.apk'),payload=Buffer.alloc(130000,17);
 fs.writeFileSync(apk,payload);
 assert.throws(()=>relay.publish(apk,21,'1.0.20','0'.repeat(64)),/CHECKSUM_MISMATCH/);
 const digest=crypto.createHash('sha256').update(payload).digest('hex');
 assert.equal(relay.publish(apk,21,'1.0.20',digest).versionCode,21);
 assert.throws(()=>relay.publish(apk,21,'1.0.20',digest),/NON_MONOTONIC/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('separate CLI process state is visible in running relay',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-durable-'));
 const running=createRelay(home);
 await new Promise(done=>running.server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+running.server.address().port;
 try {
  const writer=createRelay(home);
  const code=writer.pairCode();
  const pair=await fetch(base+'/v1/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
  assert.equal(pair.status,200);
  const {token}=await pair.json();
  const apk=path.join(home,'signed-test-placeholder.apk');const data=Buffer.alloc(130000,42);
  fs.writeFileSync(apk,data);
  const hash=crypto.createHash('sha256').update(data).digest('hex');
  writer.publish(apk,22,'1.0.21',hash);
  const update=await fetch(base+'/v1/update',{headers:{Authorization:'Bearer '+token}});
  assert.equal(update.status,200);
  assert.equal((await update.json()).latest.versionCode,22);
 }finally{await new Promise(done=>running.server.close(done));fs.rmSync(home,{recursive:true,force:true});}
});
