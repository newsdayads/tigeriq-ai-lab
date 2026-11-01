import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  media,
  stageMedia,
  RIGHTS_SCHEMA,
  RIGHTS_SCOPE,
  projectDirFromArgs,
} from '../../apps/ultracarhcm-v2/ci/stage-v1-media.mjs';

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function directoryLinkSync(target, linkPath) {
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function fileSymlinkSyncOrSkip(t, target, linkPath) {
  try {
    symlinkSync(target, linkPath, 'file');
    return true;
  } catch (error) {
    if (process.platform === 'win32' && error?.code === 'EPERM') {
      t.skip('Windows file symlink privilege unavailable; directory reparse escape cases remain covered');
      return false;
    }
    throw error;
  }
}

function writeValidRights(root, source, overrides = {}) {
  const evidence = join(root, 'rights.json');
  const receipt = {
    schema: RIGHTS_SCHEMA,
    workOrder: 'GH-5135',
    scope: RIGHTS_SCOPE,
    decision: 'GRANTED',
    grantor: 'Unit Test Rights Fixture',
    evidenceRef: 'urn:tigeriq:test:gh5135:rights-fixture',
    issuedAt: '2026-10-29T00:00:00Z',
    assets: media.map(item => ({
      path: item.from,
      sha256: sha256(join(source, item.from)),
    })),
    ...overrides,
  };
  writeFileSync(evidence, JSON.stringify(receipt, null, 2));
  return evidence;
}

test('documented --target CLI flag and legacy --project alias resolve the V2 project directory', () => {
  assert.equal(projectDirFromArgs(['--target','D:/TigerIQ/V2']), 'D:/TigerIQ/V2');
  assert.equal(projectDirFromArgs(['--project','D:/TigerIQ/V2']), 'D:/TigerIQ/V2');
  assert.equal(
    projectDirFromArgs(['--project','legacy','--target','documented']),
    'documented'
  );
  assert.equal(projectDirFromArgs([]), null);
});

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

test('private stage rejects arbitrary text and requires an exact hash-bound rights receipt', () => {
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
    assert.throws(
      ()=>stageMedia({sourceRes:src,projectDir:dest,stage:true}),
      /V1_MEDIA_REUSE_RIGHTS_EVIDENCE_REQUIRED/
    );

    const arbitrary=join(root,'rights.txt');
    writeFileSync(arbitrary,'SYNTHETIC TEST LICENSE RECEIPT, NOT A REAL V1 GRANT');
    assert.throws(
      ()=>stageMedia({sourceRes:src,projectDir:dest,stage:true,rightsEvidence:arbitrary}),
      /V1_MEDIA_REUSE_RIGHTS_EVIDENCE_INVALID_JSON/
    );

    const evidence=writeValidRights(root,src);
    const result=stageMedia({sourceRes:src,projectDir:dest,stage:true,rightsEvidence:evidence});
    assert.equal(result.ok,true);assert.equal(result.staged,true);
    for (const item of media)
      assert.equal(readFileSync(join(dest,'app/src/main/res',item.to)).length, item.observedBytes);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('rights receipt must cover all six assets and exact source SHA256 values', () => {
  const root=mkdtempSync(join(tmpdir(),'gh5135-rights-binding-'));
  try {
    const src=join(root,'src'),dest=join(root,'v2');
    for (const [i,item] of media.entries()) {
      const file=join(src,item.from);
      mkdirSync(dirname(file),{recursive:true});
      writeFileSync(file,Buffer.alloc(item.observedBytes,70+i));
    }

    const fullAssets=media.map(item=>({path:item.from,sha256:sha256(join(src,item.from))}));
    const incomplete=writeValidRights(root,src,{assets:fullAssets.slice(0,-1)});
    assert.throws(
      ()=>stageMedia({sourceRes:src,projectDir:dest,stage:true,rightsEvidence:incomplete}),
      /V1_MEDIA_REUSE_RIGHTS_EVIDENCE_INCOMPLETE_ASSET_SET/
    );

    const wrongHash=writeValidRights(root,src,{
      assets:fullAssets.map((asset,index)=>index===2?{...asset,sha256:'0'.repeat(64)}:asset),
    });
    assert.throws(
      ()=>stageMedia({sourceRes:src,projectDir:dest,stage:true,rightsEvidence:wrongHash}),
      /V1_MEDIA_REUSE_RIGHTS_EVIDENCE_SHA_MISMATCH:drawable\/logo_ultracar[.]png/
    );
    assert.equal(existsSync(join(dest,'app/src/main/res')),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('an existing edited local resource is never silently overwritten', () => {
  const root=mkdtempSync(join(tmpdir(),'gh5135-conflict-'));
  try {
    const src=join(root,'src'),dest=join(root,'v2');
    for(const item of media){const f=join(src,item.from);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,Buffer.alloc(item.observedBytes, 76));}
    const existing=join(dest,'app/src/main/res',media[0].to);
    mkdirSync(dirname(existing),{recursive:true});writeFileSync(existing,'different-content');
    const evidence=writeValidRights(root,src);
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

test('dangling destination-file symlink cannot redirect private media staging outside V2', t => {
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
    if (!fileSymlinkSyncOrSkip(t, outside, first)) return;
    assert.equal(existsSync(first),false,'dangling symlink bypasses existsSync');
    assert.equal(lstatSync(first).isSymbolicLink(),true);
    const rights=writeValidRights(root,src);
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
    directoryLinkSync(outside,parent);
    const rights=writeValidRights(root,src);
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
    directoryLinkSync(outside,join(source,'drawable'));
    assert.throws(
      ()=>stageMedia({sourceRes:source,projectDir:dest}),
      new RegExp('SOURCE_SYMLINK_FORBIDDEN:drawable/road_city_day[.]jpg')
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
    directoryLinkSync(real,alias);
    assert.throws(
      ()=>stageMedia({sourceRes:alias,projectDir:dest}),
      /SOURCE_SYMLINK_FORBIDDEN/
    );
    assert.equal(existsSync(dest),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
