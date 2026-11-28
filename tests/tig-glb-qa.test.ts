import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'tig-glb-qa-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let seq = 0;
function fixture(opts: { index?: number; nan?: boolean; noUv?: boolean; degenerate?: boolean; outsideUv?: boolean; truncated?: boolean; stride?: number; external?: boolean; badHeader?: boolean; imageDamage?: 'crc' | 'signature' | 'truncated'; imageMime?: string; jpegOnlyMarkers?: boolean; indexStride?: number; imageStride?: number; unknownBeforeBin?: boolean; unknownAfterBin?: boolean; badBinPadding?: boolean; sharedView?: boolean; singlePosition?: boolean } = {}) {
  let png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP438AAAAQBAYDFKhhdAAAAAElFTkSuQmCC', 'base64');
  if (opts.jpegOnlyMarkers) png = Buffer.from([0xff,0xd8,0xff,0xd9]);
  if (opts.imageDamage === 'signature') png[0] ^= 1;
  if (opts.imageDamage === 'crc') png[29] ^= 1;
  if (opts.imageDamage === 'truncated') png = png.subarray(0, -4);
  const bin = Buffer.alloc(68 + png.length + (4 - png.length % 4) % 4);
  [0,0,0,1,0,0,0,opts.degenerate?0:1,0].forEach((x,i)=>bin.writeFloatLE(opts.nan&&i===0?NaN:x,i*4));
  [0,0,1,0,0,opts.outsideUv?2:1].forEach((x,i)=>bin.writeFloatLE(x,36+i*4));
  [0,opts.singlePosition?0:1,opts.singlePosition?0:(opts.index??2)].forEach((x,i)=>bin.writeUInt16LE(x,60+i*2));
  png.copy(bin,68);
  if(opts.badBinPadding) bin[bin.length-1] = 1;
  const doc = { asset:{version:'2.0'}, buffers:[{byteLength:68+png.length,...(opts.external?{uri:'external.bin'}:{})}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36,...(opts.stride != null?{byteStride:opts.stride}:{})},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:6,...(opts.indexStride != null?{byteStride:opts.indexStride}:{})},{buffer:0,byteOffset:68,byteLength:png.length,...(opts.imageStride != null?{byteStride:opts.imageStride}:{})}],
    accessors:[{bufferView:0,componentType:5126,count:opts.singlePosition?1:3,type:'VEC3',min:[0,0,0],max:[opts.singlePosition?0:1,opts.singlePosition?0:(opts.degenerate?0:1),0]},{bufferView:opts.sharedView?0:1,componentType:5126,count:opts.singlePosition?1:3,type:'VEC2'},{bufferView:2,componentType:5123,count:3,type:'SCALAR'}],
    meshes:[{name:'test',primitives:[{attributes:{POSITION:0,...(opts.noUv?{}:{TEXCOORD_0:1})},indices:2}]}],
    images:[{bufferView:3,mimeType:opts.imageMime??'image/png'}] };
  const json=Buffer.from(JSON.stringify(doc)); const padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const header=Buffer.alloc(12);header.writeUInt32LE(opts.badHeader?0:0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+bin.length+(opts.unknownBeforeBin?8:0)+(opts.unknownAfterBin?8:0),8);
  const chunk=(type:number,b:Buffer)=>{const h=Buffer.alloc(8);h.writeUInt32LE(b.length);h.writeUInt32LE(type,4);return Buffer.concat([h,b]);};
  const unknown=chunk(0x12345678,Buffer.alloc(0));
  const chunks=[chunk(0x4e4f534a,padded)];
  if(opts.unknownBeforeBin) chunks.push(unknown);
  chunks.push(chunk(0x004e4942,bin));
  if(opts.unknownAfterBin) chunks.push(unknown);
  const glb=Buffer.concat([header,...chunks]);
  return opts.truncated?glb.subarray(0,-1):glb;
}
function run(b: Buffer) {
  const path=join(dir,`fixture-${seq++}.glb`);writeFileSync(path,b);
  return spawnSync(process.execPath,[resolve('tools/tig-glb-qa/inspect.mjs'),path],{encoding:'utf8'});
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
  if (offset === -1) throw new Error('fixture marker missing');
  json[offset] = 0xff;
  json.copy(glb, 20);
  return glb;
}

function normalizedUvFixture(componentType: 5121 | 5123 | 5126, normalized = true, misaligned = false, misalignedView = false, omitStride = false, viewOffsetDelta = 0) {
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
describe('TiG bounded GLB screen (not likeness or release acceptance)',()=>{
  it('rejects tightly packed normalized UNSIGNED_BYTE VEC2 TEXCOORD_0 without 4-byte element alignment',()=>{
    const r=run(normalizedUvFixture(5121,true,false,false,true));
    expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid vertex attribute alignment');
  });
  it('accepts normalized UNSIGNED_SHORT VEC2 TEXCOORD_0 with explicit 4-byte byteStride',()=>{
    const r=run(normalizedUvFixture(5123,true,false,false,false));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({uvMissing:0,uvOutOfRange:0,technicalScreen:'PASS',releaseEligible:false});
  });

  it.each([5121,5123] as const)('accepts normalized integer TEXCOORD_0 %s',componentType=>{
    const r=run(normalizedUvFixture(componentType));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({uvMissing:0,uvOutOfRange:0,technicalScreen:'PASS',releaseEligible:false});
  });
  it('rejects vertex attributes with mismatched counts',()=>{
    const glb=rewriteJsonFixture(d=>{d.bufferViews[0].byteStride=12;d.accessors.push({...d.accessors[0],count:2});d.meshes[0].primitives[0].attributes.NORMAL=3;});
    const r=run(glb);expect(r.status).toBe(1);expect(r.stderr).toContain('vertex attribute count mismatch');
  });
  it('rejects duplicate JSON chunks even when first JSON value is null',()=>{
    const r=run(duplicateJsonFixture());expect(r.status).toBe(1);expect(r.stderr).toContain('duplicate JSON');
  });
  it('rejects null buffer URI instead of treating it as absent',()=>{
    const r=run(rewriteJsonFixture(d=>{d.buffers[0].uri=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('unsupported non-embedded GLB');
  });
  it('accepts a valid asset minVersion not greater than version',()=>{
    const r=run(rewriteJsonFixture(d=>{d.asset.minVersion='1.0';}));
    expect(r.status).toBe(0);expect(JSON.parse(r.stdout).technicalScreen).toBe('PASS');
  });
  it('rejects asset minVersion greater than asset version',()=>{
    const r=run(rewriteJsonFixture(d=>{d.asset.minVersion='2.1';}));
    expect(r.status).toBe(1);expect(r.stderr).toContain('asset minVersion exceeds version');
  });
  it('rejects malformed asset minVersion version strings',()=>{
    const r=run(rewriteJsonFixture(d=>{d.asset.minVersion='02.0';}));
    expect(r.status).toBe(1);expect(r.stderr).toContain('invalid asset minVersion');
  });
  it('rejects malformed asset version strings',()=>{
    const r=run(rewriteJsonFixture(d=>{d.asset.version='02.0';}));
    expect(r.status).toBe(1);expect(r.stderr).toContain('invalid asset version');
  });
  it('rejects null primitive indices instead of treating them as omitted',()=>{
    const r=run(rewriteJsonFixture(d=>{d.meshes[0].primitives[0].indices=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid accessor index');
  });
  it('rejects null primitive mode instead of applying the default',()=>{
    const r=run(rewriteJsonFixture(d=>{d.meshes[0].primitives[0].mode=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('only triangle primitives supported');
  });
  it('rejects null embedded image URI',()=>{
    const r=run(rewriteJsonFixture(d=>{d.images[0].uri=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('unsupported image');
  });
  it('rejects null byteStride instead of treating it as omitted',()=>{
    const r=run(rewriteJsonFixture(d=>{d.bufferViews[0].byteStride=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid buffer view stride');
  });
  it('rejects null accessor byteOffset instead of defaulting to zero',()=>{
    const r=run(rewriteJsonFixture(d=>{d.accessors[0].byteOffset=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid accessor offset');
  });
  it('rejects null bufferView byteOffset instead of defaulting to zero',()=>{
    const r=run(rewriteJsonFixture(d=>{d.bufferViews[0].byteOffset=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid view offset');
  });
  it('rejects null sparse accessor property',()=>{
    const r=run(rewriteJsonFixture(d=>{d.accessors[0].sparse=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('unsupported vertex attribute accessor');
  });
  it('rejects null normalized accessor property',()=>{
    const r=run(rewriteJsonFixture(d=>{d.accessors[0].normalized=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid normalized accessor');
  });
  it('rejects invalid UTF-8 in the JSON chunk',()=>{
    const r=run(invalidUtf8Fixture());expect(r.status).toBe(1);expect(r.stderr).toContain('invalid UTF-8 JSON');
  });
  it('rejects unnormalized integer TEXCOORD_0',()=>{
    const r=run(normalizedUvFixture(5121,false));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid normalized accessor');
  });
  it('rejects normalized FLOAT TEXCOORD_0',()=>{
    const r=run(normalizedUvFixture(5126,true));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid normalized accessor');
  });
  it('rejects accessor byteOffset that is 2-byte aligned but not 4-byte aligned even when absolute offset is 4-byte aligned',()=>{
    const r=run(normalizedUvFixture(5123,true,false,false,true,-2));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid vertex attribute alignment');
  });
  it('accepts UNSIGNED_SHORT VEC2 when bufferView starts at a 2-byte offset but accessor offset is 4-byte aligned',()=>{
    const r=run(normalizedUvFixture(5123,true,false,false,false,2));expect(r.status).toBe(0);expect(JSON.parse(r.stdout).technicalScreen).toBe('PASS');
  });
  it('rejects UNSIGNED_SHORT VEC2 without byteStride even when element width is four bytes',()=>{
    const r=run(normalizedUvFixture(5123,true,false,false,true,0));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid vertex attribute alignment');
  });
  it('accepts UNSIGNED_BYTE vertex attributes when bufferView starts at a non-4-byte absolute offset',()=>{
    const r=run(normalizedUvFixture(5121,true,false,true));expect(r.status).toBe(0);expect(JSON.parse(r.stdout).technicalScreen).toBe('PASS');
  });
  it('rejects shared vertex bufferViews without byteStride',()=>{
    const r=run(fixture({sharedView:true}));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('shared vertex bufferView requires byteStride');
  });
  it('accepts shared vertex bufferViews with byteStride',()=>{
    const r=run(fixture({sharedView:true,stride:12}));expect(r.status).toBe(0);expect(JSON.parse(r.stdout).technicalScreen).toBe('PASS');
  });
  it('rejects distinct vertex accessors sharing a bufferView across primitives without byteStride',()=>{
    const r=run(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0]});d.meshes[0].primitives.push({attributes:{POSITION:3,TEXCOORD_0:1},indices:2});}));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('shared vertex bufferView requires byteStride');
  });
  it('accepts distinct vertex accessors sharing a bufferView across primitives with byteStride',()=>{
    const r=run(rewriteJsonFixture(d=>{d.bufferViews[0].byteStride=12;d.accessors.push({...d.accessors[0]});d.meshes[0].primitives.push({attributes:{POSITION:3,TEXCOORD_0:1},indices:2});}));expect(r.status).toBe(0);expect(JSON.parse(r.stdout).technicalScreen).toBe('PASS');
  });
  it('rejects byteStride greater than bufferView.byteLength',()=>{
    const r=run(fixture({stride:40,singlePosition:true}));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid buffer view stride');
  });
  it('accepts byteStride equal to bufferView.byteLength',()=>{
    const r=run(fixture({stride:36,singlePosition:true}));expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({degenerate:1,technicalScreen:'NOT_MET'});
  });

  it('accepts unknown extension chunks after BIN',()=>expect(JSON.parse(run(fixture({unknownAfterBin:true})).stdout).technicalScreen).toBe('PASS'));
  it('accepts valid interleaved vertex stride',()=>expect(JSON.parse(run(fixture({stride:12})).stdout).technicalScreen).toBe('PASS'));
  it('counts valid embedded geometry without certifying rig or release',()=>{const r=run(fixture());expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({triangles:1,embeddedImages:1,technicalScreen:'PASS',rigScreen:'NOT_MET',likeness:'NOT_EVALUATED',ownerVisualApproval:'REQUIRED',releaseEligible:false});});
  it.each([{index:3},{nan:true},{truncated:true},{stride:24},{external:true},{badHeader:true},{unknownBeforeBin:true},{indexStride:4},{imageStride:4},{badBinPadding:true}])('rejects malformed input %j',opts=>{const r=run(fixture(opts));expect(r.status).toBe(1);expect(r.stdout).toBe('');if(opts.unknownBeforeBin) expect(r.stderr).toContain('BIN chunk must be second');if(opts.indexStride!=null||opts.imageStride!=null) expect(r.stderr).toContain('byteStride only allowed for vertex attributes');if(opts.badBinPadding) expect(r.stderr).toContain('invalid BIN padding');});
  it.each([0,3,4.5,5,253,256])('rejects invalid GLB byteStride %s',stride=>{const r=run(fixture({stride}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid buffer view stride');});
  it.each(['signature','crc','truncated'] as const)('rejects damaged PNG %s',imageDamage=>{const r=run(fixture({imageDamage}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid PNG');});
  it.each(['image/jpeg','image/webp'])('rejects mismatched image MIME %s',imageMime=>{const r=run(fixture({imageMime}));expect(r.status).toBe(1);expect(r.stderr).toMatch(/invalid (JPEG|WebP)/);});
  it('rejects JPEG payload containing only SOI and EOI markers',()=>{const r=run(fixture({imageMime:'image/jpeg',jpegOnlyMarkers:true}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid JPEG image framing');});
  it.each([{noUv:true},{degenerate:true},{outsideUv:true}])('reports an unmet technical screen %j',opts=>{const r=run(fixture(opts));expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({technicalScreen:'NOT_MET',releaseEligible:false});});
});

it('rejects null TEXCOORD_0 instead of treating it as missing',()=>{const r=run(rewriteJsonFixture(d=>{d.meshes[0].primitives[0].attributes.TEXCOORD_0=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid vertex attribute accessor index');});
it('rejects null primitive attributes object',()=>{const r=run(rewriteJsonFixture(d=>{d.meshes[0].primitives[0].attributes=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid primitive attributes');});
it('rejects null images array instead of treating it as absent',()=>{const r=run(rewriteJsonFixture(d=>{d.images=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid images');});
it('rejects null skins array instead of treating it as absent',()=>{const r=run(rewriteJsonFixture(d=>{d.skins=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid skins');});
it('rejects null animations array instead of treating it as absent',()=>{const r=run(rewriteJsonFixture(d=>{d.animations=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid animations');});
it('rejects null morph targets instead of treating them as absent',()=>{const r=run(rewriteJsonFixture(d=>{d.meshes[0].primitives[0].targets=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid morph targets');});
it('rejects null image entries with a controlled validation error',()=>{const r=run(rewriteJsonFixture(d=>{d.images[0]=null;}));expect(r.status).toBe(1);expect(r.stderr).toContain('unsupported image');});

it('rejects POSITION accessor without required min/max bounds',()=>{const r=run(rewriteJsonFixture(d=>{delete d.accessors[0].min;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid POSITION bounds');});
it('rejects POSITION bounds that do not match actual vertex data',()=>{const r=run(rewriteJsonFixture(d=>{d.accessors[0].max=[1,2,0];}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid POSITION bounds');});
it('accepts exact POSITION bounds for valid geometry',()=>{const r=run(fixture());expect(r.status).toBe(0);expect(JSON.parse(r.stdout).technicalScreen).toBe('PASS');});

it('rejects reserved maximum UNSIGNED_SHORT index value',()=>{const glb=fixture();const jsonLength=glb.readUInt32LE(12);const binStart=20+jsonLength+8;glb.writeUInt16LE(65535,binStart+64);const r=run(glb);expect(r.status).toBe(1);expect(r.stderr).toContain('reserved maximum index value');});

it('rejects JSON chunk padding longer than the required 0-3 bytes',()=>{
  const valid=fixture();
  const jsonLength=valid.readUInt32LE(12);
  const json=valid.subarray(20,20+jsonLength);
  const bin=valid.subarray(20+jsonLength);
  const expanded=Buffer.concat([json,Buffer.alloc(4,0x20)]);
  const jsonHeader=Buffer.alloc(8);
  jsonHeader.writeUInt32LE(expanded.length,0);
  jsonHeader.writeUInt32LE(0x4e4f534a,4);
  const glb=Buffer.concat([valid.subarray(0,12),jsonHeader,expanded,bin]);
  glb.writeUInt32LE(glb.length,8);
  const r=run(glb);
  expect(r.status).toBe(1);
  expect(r.stdout).toBe('');
  expect(r.stderr).toContain('invalid JSON chunk padding');
});

it('rejects zero-initialized non-POSITION vertex attributes',()=>{
  const r=run(rewriteJsonFixture(d=>{const normal={...d.accessors[0]};delete normal.bufferView;d.accessors.push(normal);d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;}));
  expect(r.status).toBe(1);expect(r.stderr).toContain('unsupported vertex attribute accessor');
});

it('rejects sparse non-POSITION vertex attributes',()=>{
  const r=run(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],sparse:{}});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;}));
  expect(r.status).toBe(1);expect(r.stderr).toContain('unsupported vertex attribute accessor');
});
it('rejects non-POSITION vertex attributes with an invalid bufferView',()=>{const r=run(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],bufferView:999});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid buffer view');});
it('rejects non-POSITION vertex attributes whose accessor range exceeds its bufferView',()=>{const r=run(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],byteOffset:36});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;}));expect(r.status).toBe(1);expect(r.stderr).toContain('accessor out of bounds');});
it('rejects non-POSITION vertex attributes with unsupported component types',()=>{const r=run(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],componentType:5125});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;}));expect(r.status).toBe(1);expect(r.stderr).toContain('unsupported vertex attribute accessor');});
it('rejects inherited object keys as non-POSITION accessor types',()=>{const r=run(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],type:'toString'});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;}));expect(r.status).toBe(1);expect(r.stderr).toContain('unsupported vertex attribute accessor');});
it('rejects inherited object keys as non-POSITION component types',()=>{const r=run(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],componentType:'toString'});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;}));expect(r.status).toBe(1);expect(r.stderr).toContain('unsupported vertex attribute accessor');});
it('accepts structurally valid non-POSITION vertex attributes without claiming semantic payload validation',()=>{const r=run(rewriteJsonFixture(d=>{d.bufferViews.push({...d.bufferViews[0],byteStride:12});d.accessors.push({...d.accessors[0],bufferView:d.bufferViews.length-1});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;}));expect(r.status).toBe(0);expect(JSON.parse(r.stdout).technicalScreen).toBe('PASS');});


it.each(['KHR_draco_mesh_compression','EXT_meshopt_compression'])('rejects unsupported required extension %s',extension=>{
  const r=run(rewriteJsonFixture(d=>{d.extensionsUsed=[extension];d.extensionsRequired=[extension];}));
  expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('unsupported required glTF extension: '+extension);
});
it('rejects empty extensionsUsed list',()=>{const r=run(rewriteJsonFixture(d=>{d.extensionsUsed=[];}));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid extensionsUsed');});
it('rejects empty extensionsRequired list',()=>{const r=run(rewriteJsonFixture(d=>{d.extensionsRequired=[];}));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid extensionsRequired');});
it('rejects malformed extensionsUsed list',()=>{const r=run(rewriteJsonFixture(d=>{d.extensionsUsed='KHR_draco_mesh_compression';}));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid extensionsUsed');});
it('rejects empty extension names',()=>{const r=run(rewriteJsonFixture(d=>{d.extensionsUsed=[''];}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid extensionsUsed');});
it('rejects duplicate extension declarations',()=>{const r=run(rewriteJsonFixture(d=>{d.extensionsUsed=['KHR_materials_unlit','KHR_materials_unlit'];}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid extensionsUsed');});
it('rejects required extension absent from extensionsUsed',()=>{const r=run(rewriteJsonFixture(d=>{d.extensionsRequired=['KHR_draco_mesh_compression'];}));expect(r.status).toBe(1);expect(r.stderr).toContain('required extension missing from extensionsUsed');});
it('accepts declared optional extension when no extension is required',()=>{const r=run(rewriteJsonFixture(d=>{d.extensionsUsed=['KHR_materials_unlit'];}));expect(r.status).toBe(0);expect(JSON.parse(r.stdout).technicalScreen).toBe('PASS');});

it('rejects object-valued buffers container',()=>{const r=run(rewriteJsonFixture(d=>{d.buffers={0:d.buffers[0],length:1};}));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid glTF storage arrays');});
it('rejects object-valued bufferViews container',()=>{const r=run(rewriteJsonFixture(d=>{d.bufferViews=Object.fromEntries(d.bufferViews.map((value,index)=>[index,value]));}));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid glTF storage arrays');});
it('rejects object-valued accessors container',()=>{const r=run(rewriteJsonFixture(d=>{d.accessors=Object.fromEntries(d.accessors.map((value,index)=>[index,value]));}));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid glTF storage arrays');});


function webpPaddingFixture(paddingByte = 0, declareExtension = true) {
  const glb = fixture({});
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

it('rejects signed BYTE NORMAL storage without KHR_mesh_quantization',()=>{const r=run(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],componentType:5120});d.meshes[0].primitives[0].attributes.NORMAL=d.accessors.length-1;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid vertex attribute storage: NORMAL');});
it('rejects signed SHORT JOINTS_0 storage',()=>{const r=run(rewriteJsonFixture(d=>{d.accessors.push({...d.accessors[0],type:'VEC4',componentType:5122});d.meshes[0].primitives[0].attributes.JOINTS_0=d.accessors.length-1;}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid vertex attribute storage: JOINTS_0');});
it('accepts core glTF unsigned SHORT JOINTS_0 storage',()=>{const r=run(rewriteJsonFixture(d=>{d.bufferViews.push({...d.bufferViews[0],byteStride:8});d.accessors.push({...d.accessors[0],bufferView:d.bufferViews.length-1,type:'VEC4',componentType:5123});d.meshes[0].primitives[0].attributes.JOINTS_0=d.accessors.length-1;}));expect(r.status).toBe(0);expect(JSON.parse(r.stdout).technicalScreen).toBe('PASS');});
it('rejects WebP texture extension without a fallback image',()=>{const r=run(rewriteJsonFixture(d=>{d.extensionsUsed=['EXT_texture_webp'];d.textures=[{extensions:{EXT_texture_webp:{source:1}}}];d.images.push({bufferView:3,mimeType:'image/webp'});}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid fallback image index');});
it('rejects WebP texture extension when no WebP image target exists',()=>{const r=run(rewriteJsonFixture(d=>{d.extensionsUsed=['EXT_texture_webp'];d.textures=[{source:0,extensions:{EXT_texture_webp:{source:0}}}];}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid EXT_texture_webp image references');});
it('rejects undeclared WebP texture extension when no WebP image target exists',()=>{const r=run(rewriteJsonFixture(d=>{d.textures=[{source:0,extensions:{EXT_texture_webp:{source:0}}}];}));expect(r.status).toBe(1);expect(r.stderr).toContain('WebP image requires EXT_texture_webp in extensionsUsed');});
it('rejects non-array textures container',()=>{const r=run(rewriteJsonFixture(d=>{d.textures={};}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid textures');});
it('rejects WebP image without EXT_texture_webp declaration',()=>{const r=run(webpPaddingFixture(0,false));expect(r.status).toBe(1);expect(r.stderr).toContain('WebP image requires EXT_texture_webp in extensionsUsed');});

it('rejects a non-zero RIFF padding byte in an embedded WebP image',()=>{
  const r=run(webpPaddingFixture(0x7f));
  expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid WebP');
});
it('accepts a zero RIFF padding byte in an embedded WebP image',()=>{
  const r=run(webpPaddingFixture(0));
  expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({embeddedImages:1,technicalScreen:'PASS',releaseEligible:false});
});

it('rejects bufferView shared between vertex attributes and primitive indices', () => {
  const r = run(rewriteJsonFixture(d => { d.accessors[2].bufferView = 0; }));
  expect(r.status).toBe(1); expect(r.stderr).toContain('bufferView mixes vertex attribute and index data');
});

it('rejects bufferView shared between vertex attributes and embedded images', () => {
  const r = run(rewriteJsonFixture(d => { d.images[0].bufferView = 0; }));
  expect(r.status).toBe(1); expect(r.stderr).toContain('bufferView mixes vertex attribute and image data');
});
