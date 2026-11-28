import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspectGlb } from './inspect.mjs';

function fixture(options = {}) {
  let png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP438AAAAQBAYDFKhhdAAAAAElFTkSuQmCC', 'base64');
  if (options.imageDamage === 'signature') png[0] ^= 1;
  if (options.imageDamage === 'crc') png[29] ^= 1;
  if (options.imageDamage === 'truncated') png = png.subarray(0, -4);
  const bin = Buffer.alloc(68 + png.length + (4 - png.length % 4) % 4);
  [0,0,0,1,0,0,0,options.degenerate ? 0 : 1,0].forEach((x,i) => bin.writeFloatLE(options.nan && i === 0 ? NaN : x,i*4));
  [0,0,1,0,0,options.outsideUv ? 2 : 1].forEach((x,i) => bin.writeFloatLE(options.nanUv && i === 0 ? NaN : x,36+i*4));
  [0,options.singlePosition?0:1,options.singlePosition?0:(options.index ?? 2)].forEach((x,i) => bin.writeUInt16LE(x,60+i*2));
  png.copy(bin,68);
  if (options.badBinPadding) bin[bin.length-1] = 1;
  const doc = {asset:{version:'2.0'},buffers:[{byteLength:68+png.length,...(options.external ? {uri:'external.bin'} : {})}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36,...(options.stride != null ? {byteStride:options.stride} : {})},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:6,...(options.indexStride != null ? {byteStride:options.indexStride} : {})},{buffer:0,byteOffset:68,byteLength:png.length,...(options.imageStride != null ? {byteStride:options.imageStride} : {})}],accessors:[{bufferView:0,componentType:5126,count:options.singlePosition?1:3,type:'VEC3',min:[0,0,0],max:[options.singlePosition?0:1,options.singlePosition?0:(options.degenerate?0:1),0]},{bufferView:options.sharedView?0:1,componentType:5126,count:options.singlePosition?1:3,type:'VEC2'},{bufferView:2,componentType:5123,count:3,type:'SCALAR'}],meshes:[{name:'fixture',primitives:[{attributes:{POSITION:0,...(options.noUv ? {} : {TEXCOORD_0:1})},indices:2}]}],images:options.noImage ? [] : [{bufferView:3,mimeType:'image/png'}]};
  if (options.extraPrimitive) doc.meshes[0].primitives.push(doc.meshes[0].primitives[0]);
  if (options.skin) doc.skins=[{joints:[0]}];
  if (options.imageUri) doc.images=[{uri:'https://example.invalid/a.png',mimeType:'image/png'}];
  if (options.imageMime) doc.images[0].mimeType = options.imageMime;
  const raw=Buffer.from(JSON.stringify(doc)); const json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]);
  const h=Buffer.alloc(12);h.writeUInt32LE(options.badHeader?0:0x46546c67);h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length+bin.length+(options.unknownBeforeBin?8:0)+(options.unknownAfterBin?8:0),8);
  const chunk=(type,bytes)=>{const header=Buffer.alloc(8);header.writeUInt32LE(bytes.length);header.writeUInt32LE(type,4);return Buffer.concat([header,bytes]);};
  const unknown=chunk(0x12345678,Buffer.alloc(0));
  const chunks=[chunk(0x4e4f534a,json)];
  if(options.unknownBeforeBin) chunks.push(unknown);
  chunks.push(chunk(0x004e4942,bin));
  if(options.unknownAfterBin) chunks.push(unknown);
  const glb=Buffer.concat([h,...chunks]);
  return options.truncated ? glb.subarray(0,-1) : glb;
}

function duplicateJsonFixture() {
  const valid = fixture();
  const jsonLength = valid.readUInt32LE(12);
  const json = valid.subarray(20, 20 + jsonLength);
  const binHeader = 20 + jsonLength;
  const binLength = valid.readUInt32LE(binHeader);
  const bin = valid.subarray(binHeader + 8, binHeader + 8 + binLength);
  const chunk = (type, bytes) => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(bytes.length);
    header.writeUInt32LE(type, 4);
    return Buffer.concat([header, bytes]);
  };
  const chunks = [chunk(0x4e4f534a, Buffer.from('null')), chunk(0x004e4942, bin), chunk(0x4e4f534a, json)];
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + chunks.reduce((sum, part) => sum + part.length, 0), 8);
  return Buffer.concat([header, ...chunks]);
}

function rewriteJsonFixture(mutator) {
  const glb = fixture();
  const jsonLength = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8').trim());
  mutator(doc);
  const raw = Buffer.from(JSON.stringify(doc));
  const json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
  const binHeader = 20 + jsonLength;
  const binLength = glb.readUInt32LE(binHeader);
  const bin = glb.subarray(binHeader + 8, binHeader + 8 + binLength);
  const chunk = (type, bytes) => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(bytes.length);
    header.writeUInt32LE(type, 4);
    return Buffer.concat([header, bytes]);
  };
  const chunks = [chunk(0x4e4f534a, json), chunk(0x004e4942, bin)];
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + chunks.reduce((sum, part) => sum + part.length, 0), 8);
  return Buffer.concat([header, ...chunks]);
}

function invalidUtf8Fixture() {
  const glb = fixture();
  const jsonLength = glb.readUInt32LE(12);
  const json = Buffer.from(glb.subarray(20, 20 + jsonLength));
  const marker = Buffer.from('fixture');
  const offset = json.indexOf(marker);
  assert.notEqual(offset, -1);
  json[offset] = 0xff;
  json.copy(glb, 20);
  return glb;
}

function normalizedUvFixture(componentType, normalized = true, misaligned = false, misalignedView = false, omitStride = false, viewOffsetDelta = 0) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP438AAAAQBAYDFKhhdAAAAAElFTkSuQmCC', 'base64');
  const pos = Buffer.alloc(36);
  [0,0,0,1,0,0,0,1,0].forEach((value,i)=>pos.writeFloatLE(value,i*4));
  const width = componentType === 5121 ? 1 : componentType === 5123 ? 2 : 4;
  const uvStride = componentType === 5121 ? 4 : width*2;
  const uv = Buffer.alloc(3*uvStride), values=[0,0,1,0,0,1];
  values.forEach((value,i)=>{
    const offset = Math.floor(i/2)*uvStride + (i%2)*width;
    if(componentType===5121) uv.writeUInt8(Math.round(value*255),offset);
    else if(componentType===5123) uv.writeUInt16LE(Math.round(value*65535),offset);
    else uv.writeFloatLE(value,offset);
  });
  const indices=Buffer.alloc(6);[0,1,2].forEach((value,i)=>indices.writeUInt16LE(value,i*2));
  const delta = misalignedView ? 1 : viewOffsetDelta;
  const uvOffset=pos.length+Math.max(delta,0), viewOffset=pos.length+delta, accessorOffset=Math.max(0,-delta);
  const viewLength=uv.length+accessorOffset, indexPadding=(2-((uvOffset+uv.length)%2))%2, indexOffset=uvOffset+uv.length+indexPadding, imageOffset=indexOffset+indices.length;
  const logical=imageOffset+png.length;
  const bin=Buffer.concat([pos,Buffer.alloc(Math.max(delta,0)),uv,Buffer.alloc(indexPadding),indices,png,Buffer.alloc((4-logical%4)%4)]);
  const doc={asset:{version:'2.0'},buffers:[{byteLength:logical}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:pos.length},{buffer:0,byteOffset:viewOffset,byteLength:viewLength,...(componentType!==5126 && !omitStride?{byteStride:4}:{})},{buffer:0,byteOffset:indexOffset,byteLength:indices.length},{buffer:0,byteOffset:imageOffset,byteLength:png.length}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType,count:3,type:'VEC2',byteOffset:accessorOffset+(misaligned?2:0),...(normalized?{normalized:true}:{})},{bufferView:2,componentType:5123,count:3,type:'SCALAR'}],
    meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2}]}],images:[{bufferView:3,mimeType:'image/png'}]};
  const raw=Buffer.from(JSON.stringify(doc)), json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]);
  const header=Buffer.alloc(12);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);
  const chunk=(type,bytes)=>{const h=Buffer.alloc(8);h.writeUInt32LE(bytes.length);h.writeUInt32LE(type,4);return Buffer.concat([h,bytes]);};
  return Buffer.concat([header,chunk(0x4e4f534a,json),chunk(0x004e4942,bin)]);
}
test('rejects tightly packed normalized UNSIGNED_BYTE VEC2 TEXCOORD_0 without 4-byte element alignment',()=>assert.throws(()=>inspectGlb(normalizedUvFixture(5121,true,false,false,true)),/invalid vertex attribute alignment/));
test('accepts normalized UNSIGNED_SHORT VEC2 TEXCOORD_0 with explicit 4-byte byteStride',()=>{const report=inspectGlb(normalizedUvFixture(5123,true,false,false,false));assert.equal(report.technicalScreen,'PASS');assert.equal(report.uvMissing,0);assert.equal(report.uvOutOfRange,0);});
for (const [componentType, label] of [[5121,'UNSIGNED_BYTE'],[5123,'UNSIGNED_SHORT']]) {
  test('accepts normalized '+label+' TEXCOORD_0',()=>{
    const report=inspectGlb(normalizedUvFixture(componentType));
    assert.equal(report.uvMissing,0);assert.equal(report.uvOutOfRange,0);assert.equal(report.technicalScreen,'PASS');assert.equal(report.releaseEligible,false);
  });
}
test('rejects vertex attributes with mismatched counts',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.bufferViews[0].byteStride=12;d.accessors.push({...d.accessors[0],count:2});d.meshes[0].primitives[0].attributes.NORMAL=3;})),/vertex attribute count mismatch/));
test('rejects duplicate JSON chunks even when first JSON value is null',()=>assert.throws(()=>inspectGlb(duplicateJsonFixture()),/duplicate JSON/));
test('rejects null buffer URI instead of treating it as absent',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.buffers[0].uri=null;})),/unsupported non-embedded GLB/));
test('accepts a valid asset minVersion not greater than version',()=>assert.equal(inspectGlb(rewriteJsonFixture(d=>{d.asset.minVersion='1.0';})).technicalScreen,'PASS'));
test('rejects asset minVersion greater than asset version',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.asset.minVersion='2.1';})),/asset minVersion exceeds version/));
test('rejects malformed asset minVersion version strings',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.asset.minVersion='02.0';})),/invalid asset minVersion/));
test('rejects malformed asset version strings',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.asset.version='02.0';})),/invalid asset version/));
test('rejects null primitive indices instead of treating them as omitted',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.meshes[0].primitives[0].indices=null;})),/invalid accessor index/));
test('rejects null primitive mode instead of applying the default',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.meshes[0].primitives[0].mode=null;})),/only triangle primitives supported/));
test('rejects null embedded image URI',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.images[0].uri=null;})),/unsupported image/));
test('rejects null byteStride instead of treating it as omitted',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.bufferViews[0].byteStride=null;})),/invalid buffer view stride/));
test('rejects null accessor byteOffset instead of defaulting to zero',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors[0].byteOffset=null;})),/invalid accessor offset/));
test('rejects null bufferView byteOffset instead of defaulting to zero',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.bufferViews[0].byteOffset=null;})),/invalid view offset/));
test('rejects null sparse accessor property',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors[0].sparse=null;})),/unsupported vertex attribute accessor/));
test('rejects null normalized accessor property',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors[0].normalized=null;})),/invalid normalized accessor/));
test('rejects invalid UTF-8 in the JSON chunk',()=>assert.throws(()=>inspectGlb(invalidUtf8Fixture()),/invalid UTF-8 JSON/));
test('rejects unnormalized integer TEXCOORD_0',()=>assert.throws(()=>inspectGlb(normalizedUvFixture(5121,false)),/invalid normalized accessor/));
test('rejects normalized FLOAT TEXCOORD_0',()=>assert.throws(()=>inspectGlb(normalizedUvFixture(5126,true)),/invalid normalized accessor/));
test('rejects accessor byteOffset that is 2-byte aligned but not 4-byte aligned even when absolute offset is 4-byte aligned',()=>assert.throws(()=>inspectGlb(normalizedUvFixture(5123,true,false,false,true,-2)),/invalid vertex attribute alignment/));
test('accepts UNSIGNED_SHORT VEC2 when bufferView starts at a 2-byte offset but accessor offset is 4-byte aligned',()=>assert.equal(inspectGlb(normalizedUvFixture(5123,true,false,false,false,2)).technicalScreen,'PASS'));
test('rejects UNSIGNED_SHORT VEC2 without byteStride even when element width is four bytes',()=>assert.throws(()=>inspectGlb(normalizedUvFixture(5123,true,false,false,true,0)),/invalid vertex attribute alignment/));
test('accepts UNSIGNED_BYTE vertex attributes when bufferView starts at a non-4-byte absolute offset',()=>assert.equal(inspectGlb(normalizedUvFixture(5121,true,false,true)).technicalScreen,'PASS'));
test('rejects shared vertex bufferViews without byteStride',()=>assert.throws(()=>inspectGlb(fixture({sharedView:true})),/shared vertex attributes require byteStride/));
test('rejects byteStride greater than bufferView.byteLength',()=>assert.throws(()=>inspectGlb(fixture({stride:40,singlePosition:true})),/invalid buffer view stride/));
test('accepts byteStride equal to bufferView.byteLength',()=>{const report=inspectGlb(fixture({stride:36,singlePosition:true}));assert.equal(report.degenerate,1);assert.equal(report.technicalScreen,'NOT_MET');});

test('accepts unknown extension chunks after BIN',()=>assert.equal(inspectGlb(fixture({unknownAfterBin:true})).technicalScreen,'PASS'));
test('accepts valid interleaved vertex stride',()=>assert.equal(inspectGlb(fixture({stride:12})).technicalScreen,'PASS'));
test('valid triangle, embedded image bytes and fail-closed release fields',()=>{
  const r=inspectGlb(fixture());assert.equal(r.triangles,1);assert.equal(r.embeddedImages,1);assert.equal(r.technicalScreen,'PASS');assert.equal(r.rigScreen,'NOT_MET');assert.equal(r.likeness,'NOT_EVALUATED');assert.equal(r.ownerVisualApproval,'REQUIRED');assert.equal(r.releaseEligible,false);
});
for (const [name,options,error] of [
  ['bad header',{badHeader:true},/header/],['unknown chunk before BIN',{unknownBeforeBin:true},/BIN chunk must be second/],['byteStride on index data',{indexStride:4},/byteStride only allowed for vertex attributes/],['byteStride on image data',{imageStride:4},/byteStride only allowed for vertex attributes/],['non-zero BIN padding',{badBinPadding:true},/invalid BIN padding/],['truncated',{truncated:true},/header/],['bad index',{index:3},/index out of bounds/],['NaN position',{nan:true},/non-finite position/],['NaN UV',{nanUv:true},/non-finite UV/],['bad stride',{stride:24},/accessor out of bounds/],['byteStride below minimum',{stride:3},/invalid buffer view stride/],['byteStride not 4-byte aligned',{stride:5},/invalid buffer view stride/],['byteStride above maximum',{stride:256},/invalid buffer view stride/],['zero byteStride',{stride:0},/invalid buffer view stride/],['fractional byteStride',{stride:4.5},/invalid buffer view stride/],['byteStride above spec maximum',{stride:253},/invalid buffer view stride/],['external buffer',{external:true},/non-embedded/],['external image',{imageUri:true},/unsupported image/]
]) test('rejects '+name,()=>assert.throws(()=>inspectGlb(fixture(options)),error));
for (const [name,options,field] of [['missing UV',{noUv:true},'uvMissing'],['out-of-range UV',{outsideUv:true},'uvOutOfRange'],['degenerate triangle',{degenerate:true},'degenerate']]) test(name+' fails screen',()=>{const r=inspectGlb(fixture(options));assert.equal(r[field],1);assert.equal(r.technicalScreen,'NOT_MET');assert.equal(r.releaseEligible,false);});
test('missing embedded image fails screen',()=>assert.equal(inspectGlb(fixture({noImage:true})).technicalScreen,'NOT_MET'));
test('triangle budget is enforced across primitives',()=>{const r=inspectGlb(fixture({extraPrimitive:true}),{triangleBudget:1});assert.equal(r.triangles,2);assert.equal(r.technicalScreen,'NOT_MET');});
test('invalid budget rejected',()=>assert.throws(()=>inspectGlb(fixture(),{triangleBudget:0}),/invalid triangle budget/));
test('declared skin without morph targets is not falsely marked absent',()=>{const r=inspectGlb(fixture({skin:true}));assert.equal(r.skins,1);assert.equal(r.morphTargets,0);assert.equal(r.rigScreen,'NOT_CHECKED');assert.equal(r.releaseEligible,false);});

for (const imageDamage of ['signature','crc','truncated']) test('rejects damaged PNG '+imageDamage,()=>assert.throws(()=>inspectGlb(fixture({imageDamage})),/invalid PNG/));
for (const imageMime of ['image/jpeg','image/webp']) test('rejects mismatched image MIME '+imageMime,()=>assert.throws(()=>inspectGlb(fixture({imageMime})),/invalid (JPEG|WebP)/));

function runCli(bytes, flags = []) {
  const dir=mkdtempSync(join(tmpdir(),'tig-strict-'));
  try {
    const file=join(dir,'fixture.glb');writeFileSync(file,bytes);
    return spawnSync(process.execPath,[fileURLToPath(new URL('./inspect.mjs',import.meta.url)),file,...flags],{encoding:'utf8'});
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
test('strict CLI returns zero for technical PASS without claiming release',()=>{
  const r=runCli(fixture(),['--require-technical-pass']);
  assert.equal(r.status,0);const report=JSON.parse(r.stdout);assert.equal(report.technicalScreen,'PASS');assert.equal(report.releaseEligible,false);
});
test('strict CLI returns 2 for technical NOT_MET and preserves the JSON diagnosis',()=>{
  const r=runCli(fixture({noUv:true}),['--require-technical-pass']);
  assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).technicalScreen,'NOT_MET');
});
test('default diagnostic CLI preserves exit zero for a valid but unmet screen',()=>{
  const r=runCli(fixture({noUv:true}));assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).technicalScreen,'NOT_MET');
});
test('strict CLI malformed GLB exits 1 with no misleading PASS report',()=>{
  const r=runCli(fixture({badHeader:true}),['--require-technical-pass']);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/header/);
});
test('CLI rejects unknown or repeated flags rather than silently ignoring them',()=>{
  for(const flags of [['--unknown'],['--require-technical-pass','--require-technical-pass']]) {
    const r=runCli(fixture(),flags);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/Usage:/);
  }
});

test('rejects null TEXCOORD_0 instead of treating it as missing',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.meshes[0].primitives[0].attributes.TEXCOORD_0=null;})),/invalid vertex attribute accessor index/));
test('rejects null primitive attributes object',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.meshes[0].primitives[0].attributes=null;})),/invalid primitive attributes/));
test('rejects null images array instead of treating it as absent',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.images=null;})),/invalid images/));
test('rejects null skins array instead of treating it as absent',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.skins=null;})),/invalid skins/));
test('rejects null animations array instead of treating it as absent',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.animations=null;})),/invalid animations/));
test('rejects null morph targets instead of treating them as absent',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.meshes[0].primitives[0].targets=null;})),/invalid morph targets/));
test('rejects null image entries with a controlled validation error',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.images[0]=null;})),/unsupported image/));

test('rejects POSITION accessor without required min/max bounds',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{delete d.accessors[0].min;})),/invalid POSITION bounds/));
test('rejects POSITION bounds that do not match actual vertex data',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors[0].max=[1,2,0];})),/invalid POSITION bounds/));
test('accepts exact POSITION bounds for valid geometry',()=>assert.equal(inspectGlb(fixture()).technicalScreen,'PASS'));

test('rejects reserved maximum UNSIGNED_SHORT index value',()=>{const glb=fixture();const jsonLength=glb.readUInt32LE(12);const binStart=20+jsonLength+8;glb.writeUInt16LE(65535,binStart+64);assert.throws(()=>inspectGlb(glb),/reserved maximum index value/);});

test('rejects non-space JSON chunk padding',()=>{
  const glb=fixture();
  const jsonLength=glb.readUInt32LE(12);
  const json=glb.subarray(20,20+jsonLength).toString('utf8');
  const padding=json.match(/ *$/)?.[0].length ?? 0;
  assert.ok(padding>0,'fixture must contain JSON alignment padding');
  glb[20+jsonLength-1]=0x09;
  assert.throws(()=>inspectGlb(glb),/invalid JSON chunk padding/);
});

test('accepts UTF-8 mesh names with correct JSON padding alignment',()=>{
  const glb=rewriteJsonFixture(d=>{d.meshes[0].name='猫';});
  assert.equal(inspectGlb(glb).technicalScreen,'PASS');
});

test('accepts UTF-8 BOM while validating JSON chunk alignment',()=>{
  const glb=fixture();
  const jsonLength=glb.readUInt32LE(12);
  const raw=glb.subarray(20,20+jsonLength).toString('utf8').trimEnd();
  const jsonBytes=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(raw)]);
  const json=Buffer.concat([jsonBytes,Buffer.alloc((4-jsonBytes.length%4)%4,0x20)]);
  const binHeader=20+jsonLength;
  const binLength=glb.readUInt32LE(binHeader);
  const bin=glb.subarray(binHeader+8,binHeader+8+binLength);
  const chunk=(type,bytes)=>{const h=Buffer.alloc(8);h.writeUInt32LE(bytes.length);h.writeUInt32LE(type,4);return Buffer.concat([h,bytes]);};
  const out=Buffer.concat([glb.subarray(0,12),chunk(0x4e4f534a,json),chunk(0x004e4942,bin)]);
  out.writeUInt32LE(out.length,8);
  assert.equal(inspectGlb(out).technicalScreen,'PASS');
});

test('rejects JSON chunk padding longer than the required 0-3 bytes',()=>{
  const glb=fixture();
  const jsonLength=glb.readUInt32LE(12);
  const json=glb.subarray(20,20+jsonLength);
  const binHeader=20+jsonLength;
  const bin=glb.subarray(binHeader);
  const expanded=Buffer.concat([json,Buffer.alloc(4,0x20)]);
  const chunkHeader=Buffer.alloc(8);
  chunkHeader.writeUInt32LE(expanded.length,0);
  chunkHeader.writeUInt32LE(0x4e4f534a,4);
  const out=Buffer.concat([glb.subarray(0,12),chunkHeader,expanded,bin]);
  out.writeUInt32LE(out.length,8);
  assert.throws(()=>inspectGlb(out),/invalid JSON chunk padding/);
});

test('rejects zero-initialized non-POSITION vertex attributes',()=>{
  assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{const normal={...d.accessors[0]};delete normal.bufferView;d.accessors.push(normal);d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;})),/unsupported vertex attribute accessor/);
});

test('rejects sparse non-POSITION vertex attributes',()=>{
  assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],sparse:{}});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;})),/unsupported vertex attribute accessor/);
});
test('rejects non-POSITION vertex attributes with an invalid bufferView',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],bufferView:999});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;})),/invalid buffer view/));
test('rejects non-POSITION vertex attributes whose accessor range exceeds its bufferView',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],byteOffset:36});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;})),/accessor out of bounds/));
test('rejects non-POSITION vertex attributes with unsupported component types',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],componentType:5125});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;})),/unsupported vertex attribute accessor/));
test('rejects inherited object keys as non-POSITION accessor types',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],type:'toString'});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;})),/unsupported vertex attribute accessor/));
test('rejects inherited object keys as non-POSITION component types',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],componentType:'toString'});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;})),/unsupported vertex attribute accessor/));
test('accepts structurally valid non-POSITION vertex attributes without claiming semantic payload validation',()=>{const r=inspectGlb(rewriteJsonFixture(d=>{d.bufferViews.push({...d.bufferViews[0],byteStride:12});d.accessors.push({...d.accessors[0],bufferView:d.bufferViews.length-1});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;}));assert.equal(r.technicalScreen,'PASS');});


test('rejects required Draco compression extension',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.extensionsUsed=['KHR_draco_mesh_compression'];d.extensionsRequired=['KHR_draco_mesh_compression'];})),/unsupported required glTF extension: KHR_draco_mesh_compression/));
test('rejects required meshopt compression extension',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.extensionsUsed=['EXT_meshopt_compression'];d.extensionsRequired=['EXT_meshopt_compression'];})),/unsupported required glTF extension: EXT_meshopt_compression/));
test('rejects empty extensionsUsed list',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.extensionsUsed=[];})),/invalid extensionsUsed/));
test('rejects empty extensionsRequired list',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.extensionsRequired=[];})),/invalid extensionsRequired/));
test('rejects malformed extensionsUsed list',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.extensionsUsed='KHR_draco_mesh_compression';})),/invalid extensionsUsed/));
test('rejects empty extension names',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.extensionsUsed=[''];})),/invalid extensionsUsed/));
test('rejects duplicate extension declarations',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.extensionsUsed=['KHR_materials_unlit','KHR_materials_unlit'];})),/invalid extensionsUsed/));
test('rejects required extension absent from extensionsUsed',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.extensionsRequired=['KHR_draco_mesh_compression'];})),/required extension missing from extensionsUsed/));
test('accepts declared optional extension when no extension is required',()=>assert.equal(inspectGlb(rewriteJsonFixture(d=>{d.extensionsUsed=['KHR_materials_unlit'];})).technicalScreen,'PASS'));



function webpPaddingFixture(paddingByte = 0, declareExtension = true) {
  const glb = fixture();
  const jsonLength = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8').trim());
  if (declareExtension) doc.extensionsUsed = ['EXT_texture_webp'];
  const binChunkStart = 20 + jsonLength;
  const binLength = glb.readUInt32LE(binChunkStart);
  const binStart = binChunkStart + 8;
  const bin = Buffer.from(glb.subarray(binStart, binStart + binLength));
  const webp = Buffer.alloc(22);
  webp.write('RIFF', 0, 'ascii');
  webp.writeUInt32LE(webp.length - 8, 4);
  webp.write('WEBP', 8, 'ascii');
  webp.write('VP8 ', 12, 'ascii');
  webp.writeUInt32LE(1, 16);
  webp[20] = 0x00;
  webp[21] = paddingByte;
  const webpViewIndex = doc.bufferViews.length;
  doc.bufferViews.push({buffer:0,byteOffset:bin.length,byteLength:webp.length});
  doc.images.push({bufferView:webpViewIndex,mimeType:'image/webp'});
  doc.textures = [{source:0,extensions:{EXT_texture_webp:{source:1}}}];
  doc.buffers[0].byteLength = bin.length + webp.length;
  const nextBin = Buffer.concat([bin, webp, Buffer.alloc((4 - (bin.length + webp.length) % 4) % 4)]);
  const rawJson = Buffer.from(JSON.stringify(doc));
  const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + nextBin.length, 8);
  const chunk = (type, bytes) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(bytes.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, bytes]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, nextBin)]);
}

test('rejects signed BYTE NORMAL storage without KHR_mesh_quantization',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],componentType:5120});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;})),/invalid vertex attribute storage: NORMAL/));
test('rejects signed SHORT JOINTS_0 storage',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],type:'VEC4',componentType:5122});d.meshes[0].primitives[0].attributes.JOINTS_0=d.accessors.length-1;})),/invalid vertex attribute storage: JOINTS_0/));
test('accepts core glTF unsigned SHORT JOINTS_0 storage',()=>{const r=inspectGlb(rewriteJsonFixture(d=>{d.bufferViews.push({...d.bufferViews[0],byteStride:8});d.accessors.push({...d.accessors[0],bufferView:d.bufferViews.length-1,type:'VEC4',componentType:5123});d.meshes[0].primitives[0].attributes.JOINTS_0=d.accessors.length-1;}));assert.equal(r.technicalScreen,'PASS');});

test('rejects WebP image without a texture extension reference',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.extensionsUsed=['EXT_texture_webp'];d.textures=[];d.images.push({bufferView:3,mimeType:'image/webp'});})),/unreferenced WebP image/));
test('rejects WebP texture extension without a fallback image',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.extensionsUsed=['EXT_texture_webp'];d.textures=[{extensions:{EXT_texture_webp:{source:1}}}];d.images.push({bufferView:3,mimeType:'image/webp'});})),/invalid fallback image index/));
test('rejects WebP texture extension when no WebP image target exists',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.extensionsUsed=['EXT_texture_webp'];d.textures=[{source:0,extensions:{EXT_texture_webp:{source:0}}}];})),/invalid EXT_texture_webp image references/));
test('rejects undeclared WebP texture extension when no WebP image target exists',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.textures=[{source:0,extensions:{EXT_texture_webp:{source:0}}}];})),/WebP image requires EXT_texture_webp in extensionsUsed/));
test('rejects non-array textures container',()=>assert.throws(()=>inspectGlb(rewriteJsonFixture(d=>{d.textures={};})),/invalid textures/));
test('rejects WebP image without EXT_texture_webp declaration',()=>assert.throws(()=>inspectGlb(webpPaddingFixture(0,false)),/WebP image requires EXT_texture_webp in extensionsUsed/));

test('rejects a non-zero RIFF padding byte in an embedded WebP image', () => {
  assert.throws(() => inspectGlb(webpPaddingFixture(0x7f)), /invalid WebP/);
});

test('accepts a zero RIFF padding byte in an embedded WebP image', () => {
  const report = inspectGlb(webpPaddingFixture(0));
  assert.equal(report.embeddedImages, 1);
  assert.equal(report.technicalScreen, 'PASS');
  assert.equal(report.releaseEligible, false);
});

test('rejects object-valued buffers container', () => {
  assert.throws(() => inspectGlb(rewriteJsonFixture(d => { d.buffers = { 0: d.buffers[0], length: 1 }; })), /invalid glTF storage arrays/);
});

test('rejects object-valued bufferViews container', () => {
  assert.throws(() => inspectGlb(rewriteJsonFixture(d => { d.bufferViews = Object.fromEntries(d.bufferViews.map((value, index) => [index, value])); })), /invalid glTF storage arrays/);
});

test('rejects object-valued accessors container', () => {
  assert.throws(() => inspectGlb(rewriteJsonFixture(d => { d.accessors = Object.fromEntries(d.accessors.map((value, index) => [index, value])); })), /invalid glTF storage arrays/);
});
