import test from 'node:test';
import fs from 'node:fs';
import { Script } from 'node:vm';
import os from 'node:os';
import { safeFilename, safePackage, validBatch, fileInDrop } from './farm-ops.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import assert from 'node:assert/strict';
import { parseDevices, safeSerial, validInput, server } from './app.mjs';

test('ADB inventory parses connected, offline, unauthorized devices', () => {
  const devices=parseDevices('List of devices attached\nR3CM400AKRX device product:beyondxks model:SM_G977N transport_id:1\n192.168.0.9:5555 offline\nABCD unauthorized\n');
  assert.equal(devices.length,3);
  assert.deepEqual(devices[0],{serial:'R3CM400AKRX',state:'device',model:'SM_G977N',product:'beyondxks'});
  assert.equal(devices[1].state,'offline');
  assert.equal(devices[2].state,'unauthorized');
});
test('serial cannot inject shell flags, path or operators', () => {
  for(const s of ['R3CM400AKRX','192.168.1.8:5555','emulator-5554']) assert.equal(safeSerial(s),true);
  for(const s of ['--help','../../a','x;del','a b','']) assert.equal(safeSerial(s),false);
});
test('bounded group inputs and supported actions', () => {
  assert.equal(validInput({serials:['ABC'],action:'tap',x:12,y:99}),true);
  assert.equal(validInput({serials:['ABC','DEF'],action:'key',key:'HOME'}),true);
  assert.equal(validInput({serials:['ABC'],action:'swipe',x:10,y:10,toX:20,toY:40,ms:300}),true);
  assert.equal(validInput({serials:['ABC'],action:'text',text:'hello world'}),true);
  assert.equal(validInput({serials:['ABC'],action:'text',text:'a\u0000b'}),false);
  assert.equal(validInput({serials:['ABC'],action:'shell',cmd:'rm -rf /'}),false);
  assert.equal(validInput({serials:['ABC','ABC'],action:'key',key:'HOME'}),false);
  assert.equal(validInput({serials:['ABC'],action:'tap',x:-1,y:3}),false);
  assert.equal(validInput({serials:['ABC'],action:'swipe',x:1,y:3,toX:4,toY:4,ms:1}),false);
  assert.equal(validInput({serials:['ABC'],action:'key',key:'FACTORY_RESET'}),false);
});
test('server module imports without listening or side effects', () => {
  assert.equal(server.listening,false);
});

test('browser controller parses under strict CSP external-script policy', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  assert.match(html,/<script src="\/ui\.js" type="module"><\/script>/);
  assert.doesNotMatch(html,/<script type="module">/);
  assert.doesNotThrow(()=>new Script(fs.readFileSync(path.join(dir,'ui.js'),'utf8')));
});

test('batch controls validate package, files, duplicate serial and actions', () => {
  assert.equal(safePackage('com.example.demo'), true);
  assert.equal(safePackage('com.example;cmd'), false);
  assert.equal(safePackage('settings'), false);
  assert.equal(safeFilename('my-app.apk'), true);
  assert.equal(safeFilename('sample.csv'), true);
  for (const s of ['../sample.apk', 'CON.txt', 'one..two.apk', '.hidden.apk', 'a.exe']) assert.equal(safeFilename(s), false);
  assert.equal(validBatch({action:'install',serials:['A1','B2'],file:'my-app.apk'}),true);
  assert.equal(validBatch({action:'install',serials:['A1'],file:'sample.csv'}),false);
  assert.equal(validBatch({action:'upload',serials:['A1'],file:'sample.csv'}),true);
  assert.equal(validBatch({action:'launch',serials:['A1'],package:'com.example.demo'}),true);
  assert.equal(validBatch({action:'shell',serials:['A1'],cmd:'unsafe'}),false);
  assert.equal(validBatch({action:'forceStop',serials:['A1','A1'],package:'com.example.demo'}),false);
});

test('batch file lookup is confined to approved drop directory', () => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-batch-'));
  try {
    const file=path.join(folder,'sample.txt');
    fs.writeFileSync(file,'safe');
    assert.equal(fileInDrop(folder,'sample.txt'),file);
    assert.throws(()=>fileInDrop(folder,'../secrets.csv'));
    assert.throws(()=>fileInDrop(folder,'not-present.apk'));
  } finally { fs.rmSync(folder,{recursive:true,force:true}) }
});
