import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { media, stageMedia } from '../../apps/ultracarhcm-v2/ci/stage-v1-media.mjs';

test('PC01-observed original filenames map to the six Kotlin V2 resource IDs', () => {
  assert.equal(media.length, 6);
  assert.deepEqual(media.map(x => x.to), [
    'drawable-nodpi/v2_road_city_day.jpg','drawable-nodpi/v2_road_city_night.jpg',
    'drawable-nodpi/v2_logo_ultracar.png','drawable-nodpi/v2_car_limo_do_parked.webp',
    'drawable-nodpi/v2_car_lambogini_trang_parked.webp','raw/ultrabot_glow_packed.mp4'
  ]);
});

test('read-only audit reports missing source rather than inventing images', () => {
  const root = mkdtempSync(join(tmpdir(), 'gh5135-ro-'));
  try {
    const x = stageMedia({ sourceRes: join(root,'source'), projectDir: join(root,'app') });
    assert.equal(x.ok, false); assert.equal(x.staged, false); assert.equal(x.missing.length, 6);
    assert.equal(existsSync(join(root,'app/app/src/main/res')), false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('private stage requires independent local rights evidence and verifies bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'gh5135-private-'));
  try {
    const src = join(root,'src'), dest = join(root,'v2');
    for (const [i,item] of media.entries()) {
      const file = join(src,item.from);
      mkdirSync(dirname(file),{recursive:true});
      writeFileSync(file, Buffer.alloc(item.observedBytes, 65 + i));
    }
    const audit = stageMedia({ sourceRes: src, projectDir: dest });
    assert.equal(audit.ok,true); assert.equal(audit.staged,false);
    assert.throws(()=>stageMedia({sourceRes:src,projectDir:dest,stage:true}),/V1_MEDIA_REUSE_RIGHTS_EVIDENCE_REQUIRED/);
    const evidence=join(root,'rights.txt');
    writeFileSync(evidence,'SYNTHETIC TEST LICENSE RECEIPT, NOT A REAL V1 GRANT');
    const result=stageMedia({sourceRes:src,projectDir:dest,stage:true,rightsEvidence:evidence});
    assert.equal(result.ok,true);assert.equal(result.staged,true);
    for (const item of media) assert.equal(readFileSync(join(dest,'app/src/main/res',item.to)).length, item.observedBytes);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('an existing edited local resource is never silently overwritten', () => {
  const root=mkdtempSync(join(tmpdir(),'gh5135-conflict-'));
  try {
    const src=join(root,'src'),dest=join(root,'v2');
    for(const item of media){const f=join(src,item.from);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,Buffer.alloc(item.observedBytes, 76));}
    const existing=join(dest,'app/src/main/res',media[0].to);
    mkdirSync(dirname(existing),{recursive:true});writeFileSync(existing,'different-content');
    const evidence=join(root,'rights.txt');writeFileSync(evidence,'SYNTHETIC TEST LICENSE RECEIPT, NOT A REAL V1 GRANT');
    assert.throws(()=>stageMedia({sourceRes:src,projectDir:dest,stage:true,rightsEvidence:evidence}),/DESTINATION_ALREADY_EXISTS_DIFFERENT_BYTES/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('read-only verification rejects changed-size assets before any local staging', () => {
  const root=mkdtempSync(join(tmpdir(),'gh5135-size-mismatch-'));
  try {
    const src=join(root,'source'),dest=join(root,'v2');
    for (const [i,item] of media.entries()) {
      const file=join(src,item.from);
      mkdirSync(dirname(file),{recursive:true});
      writeFileSync(file,Buffer.alloc(item.observedBytes-(i===2?1:0),65+i));
    }
    const report=stageMedia({sourceRes:src,projectDir:dest});
    assert.equal(report.ok,false);
    assert.equal(report.staged,false);
    assert.deepEqual(report.badFiles,['drawable/logo_ultracar.png']);
    assert.equal(report.files[2].status,'SIZE_MISMATCH');
    assert.equal(report.files[2].observedBytes,media[2].observedBytes);
    assert.equal(report.files[2].bytes,media[2].observedBytes-1);
    assert.equal(existsSync(join(dest,'app/src/main/res')),false);
    const rights=join(root,'rights.txt');
    writeFileSync(rights,'SYNTHETIC TEST RIGHTS ONLY, NOT AN ORIGINAL V1 GRANT');
    const rejected=stageMedia({sourceRes:src,projectDir:dest,stage:true,rightsEvidence:rights});
    assert.equal(rejected.ok,false);
    assert.equal(rejected.staged,false);
    assert.equal(existsSync(join(dest,'app/src/main/res')),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
