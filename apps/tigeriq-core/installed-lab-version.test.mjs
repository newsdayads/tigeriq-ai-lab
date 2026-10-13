import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {formatInstalledLabVersion,installedLabVersion} from './installed-lab-version.mjs';
const sha='6a415faac74af917bbe2d2a45c3b6492818b194f';
test('LAB stamp is the installed PC01 release timestamp in Vietnam, not browser reload clock',()=>{
 const state={currentSha:sha,updatedAt:'2026-10-13T02:31:00.000Z'};
 assert.equal(formatInstalledLabVersion(state),'LAB131026-0931');
 assert.equal(formatInstalledLabVersion({...state,updatedAt:'2026-10-12T17:59:00Z'}),'LAB131026-0059');
 assert.equal(formatInstalledLabVersion({...state,currentSha:'unverified'}),null);
 assert.equal(formatInstalledLabVersion({...state,updatedAt:'unknown'}),null);
});
test('Release is stable across requests, fails closed on absent or malformed state',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tigeriq-lab-release-'));
 const file=join(dir,'pc01.json');
 try{
  const state={currentSha:sha,updatedAt:'2026-10-13T02:31:00.000Z'};
  writeFileSync(file,JSON.stringify(state));
  assert.equal(installedLabVersion(file),'LAB131026-0931');
  assert.equal(installedLabVersion(file),'LAB131026-0931');
  writeFileSync(file,'not-json');
  assert.equal(installedLabVersion(file),'CHƯA XÁC MINH');
  assert.equal(installedLabVersion(join(dir,'no-file')),'CHƯA XÁC MINH');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
