import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, lstatSync } from 'node:fs';
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

test('dangling destination-file symlink cannot redirect private media staging outside V2', () => {
  const root=mkdtempSync(join(tmpdir(),'gh5135-link-file-'));
  try {
    const src=join(root,'source'),dest=join(root,'v2');
    for (const [i,item] of media.entries()) {
      const input=join(src,item.from);
      mkdirSync(dirname(input),{recursive:true});
      writeFileSync(input,Buffer.alloc(item.observedBytes,65+i));
    }
    const first=join(dest,'app/src/main/res',media[0].to);
    const outside=join(root,'not-in-v2.jpg');
    mkdirSync(dirname(first),{recursive:true});
    symlinkSync(outside,first);
    assert.equal(existsSync(first),false,'dangling symlink bypasses existsSync');
    assert.equal(lstatSync(first).isSymbolicLink(),true);
    const rights=join(root,'rights.txt');
    writeFileSync(rights,'SYNTHETIC TEST RIGHTS ONLY, NOT A REAL V1 GRANT');
    assert.throws(
      ()=>stageMedia({sourceRes:src,projectDir:dest,stage:true,rightsEvidence:rights}),
      /DESTINATION_SYMLINK_FORBIDDEN/
    );
    assert.equal(existsSync(outside),false,'staging must never create the external target');
    assert.equal(existsSync(join(dest,'app/src/main/res',media[1].to)),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('a symlinked parent resource directory fails before any staging writes', () => {
  const root=mkdtempSync(join(tmpdir(),'gh5135-link-parent-'));
  try {
    const src=join(root,'source'),dest=join(root,'v2');
    for (const [i,item] of media.entries()) {
      const input=join(src,item.from);
      mkdirSync(dirname(input),{recursive:true});
      writeFileSync(input,Buffer.alloc(item.observedBytes,65+i));
    }
    const parent=join(dest,'app/src/main/res/drawable-nodpi');
    const outside=join(root,'external-res');
    mkdirSync(dirname(parent),{recursive:true});
    mkdirSync(outside);
    symlinkSync(outside,parent,'dir');
    const rights=join(root,'rights.txt');
    writeFileSync(rights,'SYNTHETIC TEST RIGHTS ONLY, NOT A REAL V1 GRANT');
    assert.throws(
      ()=>stageMedia({sourceRes:src,projectDir:dest,stage:true,rightsEvidence:rights}),
      /DESTINATION_SYMLINK_FORBIDDEN/
    );
    assert.equal(existsSync(join(outside,'v2_road_city_day.jpg')),false);
    assert.equal(existsSync(join(dest,'app/src/main/res/raw/ultrabot_glow_packed.mp4')),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});


test('source ancestor directory symlink cannot escape audited media tree, even in read-only mode', () => {
  const root=mkdtempSync(join(tmpdir(),'gh5135-source-link-'));
  try {
    const source=join(root,'source'),outside=join(root,'outside-media'),dest=join(root,'v2');
    mkdirSync(source,{recursive:true});
    for (const [index,item] of media.entries()) {
      const relative=item.from.startsWith('drawable/')?item.from.slice('drawable/'.length):item.from;
      const input=item.from.startsWith('drawable/')?join(outside,relative):join(source,relative);
      mkdirSync(dirname(input),{recursive:true});
      writeFileSync(input,Buffer.alloc(item.observedBytes,65+index));
    }
    symlinkSync(outside,join(source,'drawable'),'dir');
    assert.throws(
      ()=>stageMedia({sourceRes:source,projectDir:dest}),
      /SOURCE_SYMLINK_FORBIDDEN:drawable\\/road_city_day\\.jpg/
    );
    const evidence=join(root,'rights.txt');
    writeFileSync(evidence,'SYNTHETIC TEST RIGHTS ONLY, NOT AN ORIGINAL V1 GRANT');
    assert.throws(
      ()=>stageMedia({sourceRes:source,projectDir:dest,stage:true,rightsEvidence:evidence}),
      /SOURCE_SYMLINK_FORBIDDEN/
    );
    assert.equal(existsSync(dest),false,'rejected media source must never write outside or into V2');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('sourceRes itself cannot be a symlink to a different source tree', () => {
  const root=mkdtempSync(join(tmpdir(),'gh5135-source-root-link-'));
  try {
    const real=join(root,'real-source'),alias=join(root,'aliased-source'),dest=join(root,'v2');
    mkdirSync(real);
    symlinkSync(real,alias,'dir');
    assert.throws(
      ()=>stageMedia({sourceRes:alias,projectDir:dest}),
      /SOURCE_SYMLINK_FORBIDDEN/
    );
    assert.equal(existsSync(dest),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
