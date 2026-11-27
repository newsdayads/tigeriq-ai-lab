import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'tig-glb-qa-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let seq = 0;
function fixture(opts: { index?: number; nan?: boolean; noUv?: boolean; degenerate?: boolean; outsideUv?: boolean; truncated?: boolean; stride?: number; external?: boolean; badHeader?: boolean; imageDamage?: 'crc' | 'signature' | 'truncated'; imageMime?: string } = {}) {
  let png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP438AAAAQBAYDFKhhdAAAAAElFTkSuQmCC', 'base64');
  if (opts.imageDamage === 'signature') png[0] ^= 1;
  if (opts.imageDamage === 'crc') png[29] ^= 1;
  if (opts.imageDamage === 'truncated') png = png.subarray(0, -4);
  const bin = Buffer.alloc(68 + png.length + (4 - png.length % 4) % 4);
  [0,0,0,1,0,0,0,opts.degenerate?0:1,0].forEach((x,i)=>bin.writeFloatLE(opts.nan&&i===0?NaN:x,i*4));
  [0,0,1,0,0,opts.outsideUv?2:1].forEach((x,i)=>bin.writeFloatLE(x,36+i*4));
  [0,1,opts.index??2].forEach((x,i)=>bin.writeUInt16LE(x,60+i*2));
  png.copy(bin,68);
  const doc = { asset:{version:'2.0'}, buffers:[{byteLength:68+png.length,...(opts.external?{uri:'external.bin'}:{})}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36,...(opts.stride?{byteStride:opts.stride}:{})},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:6},{buffer:0,byteOffset:68,byteLength:png.length}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},{bufferView:1,componentType:5126,count:3,type:'VEC2'},{bufferView:2,componentType:5123,count:3,type:'SCALAR'}],
    meshes:[{name:'test',primitives:[{attributes:{POSITION:0,...(opts.noUv?{}:{TEXCOORD_0:1})},indices:2}]}],
    images:[{bufferView:3,mimeType:opts.imageMime??'image/png'}] };
  const json=Buffer.from(JSON.stringify(doc)); const padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const header=Buffer.alloc(12);header.writeUInt32LE(opts.badHeader?0:0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+bin.length,8);
  const chunk=(type:number,b:Buffer)=>{const h=Buffer.alloc(8);h.writeUInt32LE(b.length);h.writeUInt32LE(type,4);return Buffer.concat([h,b]);};
  const glb=Buffer.concat([header,chunk(0x4e4f534a,padded),chunk(0x004e4942,bin)]);
  return opts.truncated?glb.subarray(0,-1):glb;
}
function run(b: Buffer) {
  const path=join(dir,`fixture-${seq++}.glb`);writeFileSync(path,b);
  return spawnSync(process.execPath,[resolve('tools/tig-glb-qa/inspect.mjs'),path],{encoding:'utf8'});
}
function normalizedUvFixture(componentType: 5121 | 5123 | 5126, normalized = true) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP438AAAAQBAYDFKhhdAAAAAElFTkSuQmCC', 'base64');
  const pos = Buffer.alloc(36);
  [0,0,0,1,0,0,0,1,0].forEach((value,i)=>pos.writeFloatLE(value,i*4));
  const width = componentType === 5121 ? 1 : componentType === 5123 ? 2 : 4;
  const uv = Buffer.alloc(6*width), values=[0,0,1,0,0,1];
  values.forEach((value,i)=>{
    if(componentType===5121) uv.writeUInt8(Math.round(value*255),i);
    else if(componentType===5123) uv.writeUInt16LE(Math.round(value*65535),i*2);
    else uv.writeFloatLE(value,i*4);
  });
  const indices=Buffer.alloc(6);[0,1,2].forEach((value,i)=>indices.writeUInt16LE(value,i*2));
  const uvOffset=pos.length, indexOffset=uvOffset+uv.length, imageOffset=indexOffset+indices.length;
  const logical=imageOffset+png.length;
  const bin=Buffer.concat([pos,uv,indices,png,Buffer.alloc((4-logical%4)%4)]);
  const doc={asset:{version:'2.0'},buffers:[{byteLength:logical}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:pos.length},{buffer:0,byteOffset:uvOffset,byteLength:uv.length},{buffer:0,byteOffset:indexOffset,byteLength:indices.length},{buffer:0,byteOffset:imageOffset,byteLength:png.length}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},{bufferView:1,componentType,count:3,type:'VEC2',...(normalized?{normalized:true}:{})},{bufferView:2,componentType:5123,count:3,type:'SCALAR'}],
    meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2}]}],images:[{bufferView:3,mimeType:'image/png'}]};
  const raw=Buffer.from(JSON.stringify(doc)), json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]);
  const header=Buffer.alloc(12);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);
  const chunk=(type,bytes)=>{const h=Buffer.alloc(8);h.writeUInt32LE(bytes.length);h.writeUInt32LE(type,4);return Buffer.concat([h,bytes]);};
  return Buffer.concat([header,chunk(0x4e4f534a,json),chunk(0x004e4942,bin)]);
}
describe('TiG bounded GLB screen (not likeness or release acceptance)',()=>{
  it.each([5121,5123] as const)('accepts normalized integer TEXCOORD_0 %s',componentType=>{
    const r=run(normalizedUvFixture(componentType));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({uvMissing:0,uvOutOfRange:0,technicalScreen:'PASS',releaseEligible:false});
  });
  it('rejects unnormalized integer TEXCOORD_0',()=>{
    const r=run(normalizedUvFixture(5121,false));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid normalized accessor');
  });
  it('rejects normalized FLOAT TEXCOORD_0',()=>{
    const r=run(normalizedUvFixture(5126,true));expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('invalid normalized accessor');
  });

  it('counts valid embedded geometry without certifying rig or release',()=>{const r=run(fixture());expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({triangles:1,embeddedImages:1,technicalScreen:'PASS',rigScreen:'NOT_MET',likeness:'NOT_EVALUATED',ownerVisualApproval:'REQUIRED',releaseEligible:false});});
  it.each([{index:3},{nan:true},{truncated:true},{stride:24},{external:true},{badHeader:true}])('rejects malformed input %j',opts=>{const r=run(fixture(opts));expect(r.status).toBe(1);expect(r.stdout).toBe('');});
  it.each([3,5,256])('rejects invalid GLB byteStride %s',stride=>{const r=run(fixture({stride}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid buffer view stride');});
  it.each(['signature','crc','truncated'] as const)('rejects damaged PNG %s',imageDamage=>{const r=run(fixture({imageDamage}));expect(r.status).toBe(1);expect(r.stderr).toContain('invalid PNG');});
  it.each(['image/jpeg','image/webp'])('rejects mismatched image MIME %s',imageMime=>{const r=run(fixture({imageMime}));expect(r.status).toBe(1);expect(r.stderr).toMatch(/invalid (JPEG|WebP)/);});
  it.each([{noUv:true},{degenerate:true},{outsideUv:true}])('reports an unmet technical screen %j',opts=>{const r=run(fixture(opts));expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({technicalScreen:'NOT_MET',releaseEligible:false});});
});
