import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { validRecordRequest, buildRecordArgs, isValidMkv, Recordings } from './recording.mjs';

test('video capture only allows bounded serials/durations and local MKV output', () => {
  assert.equal(validRecordRequest({serial:'R3CM400AKRX',seconds:8}),true);
  for (const x of [{serial:'--all',seconds:8},{serial:'R3CM400AKRX',seconds:0},
    {serial:'R3CM400AKRX',seconds:121},{serial:'R3CM400AKRX',seconds:'8'}])
    assert.equal(validRecordRequest(x),false);
  const result=buildRecordArgs('R3CM400AKRX',8,path.resolve('record.mkv'));
  assert.ok(result.includes('--no-window'));
  assert.ok(result.includes('--time-limit=8'));
  assert.ok(result.some(x=>x.startsWith('--record=')));
  assert.throws(()=>buildRecordArgs('R3CM400AKRX',8,'../wrong.mp4'));
});

test('zero-exit recording only passes for valid EBML header and length', async () => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-record-unit-'));
  const original=Buffer.from([0x1a,0x45,0xdf,0xa3]);
  function launch(_exe,args) {
    const child=new EventEmitter();
    child.stderr=new EventEmitter();
    child.kill=()=>{child.emit('exit',1);return true};
    setImmediate(()=>{
      const file=args.find(x=>x.startsWith('--record=')).slice(9);
      fs.writeFileSync(file,Buffer.concat([original,Buffer.alloc(2048)]));
      child.emit('exit',0);
    });
    return child;
  }
  try {
    const manager=new Recordings(path.resolve('scrcpy.exe'),folder,launch);
    const started=manager.start({serial:'PHONE_A',seconds:8});
    assert.equal(started.state,'recording');
    await new Promise(resolve=>setTimeout(resolve,15));
    const completed=manager.status(started.id);
    assert.equal(completed.state,'completed');
    assert.ok(completed.bytes>=2052);
    assert.equal(completed._child,undefined);
    assert.equal(manager.stop(started.id),false);
    assert.equal(isValidMkv(completed.file),true);
    const invalid=path.join(folder,'wrong.mkv');
    fs.writeFileSync(invalid,Buffer.alloc(2500));
    assert.equal(isValidMkv(invalid),false);
    assert.equal(isValidMkv(path.join(folder,'missing.mkv')),false);
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
});

test('failed or prematurely terminated capture is never reported completed', async () => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-record-stop-'));
  function launch(){
    const child=new EventEmitter();
    child.stderr=new EventEmitter();
    child.kill=()=>{setImmediate(()=>child.emit('exit',1));return true};
    return child;
  }
  try{
    const manager=new Recordings(path.resolve('scrcpy.exe'),folder,launch);
    const started=manager.start({serial:'PHONE_A',seconds:8});
    assert.equal(manager.stop(started.id),true);
    await new Promise(resolve=>setTimeout(resolve,15));
    const stopped=manager.status(started.id);
    assert.equal(stopped.state,'failed');
    assert.notEqual(stopped.state,'completed');
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
});
