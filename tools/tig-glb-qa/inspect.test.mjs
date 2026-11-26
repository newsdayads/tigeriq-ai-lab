import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectGlb } from './inspect.mjs';

function fixture(options = {}) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0eoAAAAASUVORK5CYII=', 'base64');
  const bin = Buffer.alloc(68 + png.length + (4 - png.length % 4) % 4);
  [0,0,0,1,0,0,0,options.degenerate ? 0 : 1,0].forEach((x,i) => bin.writeFloatLE(options.nan && i === 0 ? NaN : x,i*4));
  [0,0,1,0,0,options.outsideUv ? 2 : 1].forEach((x,i) => bin.writeFloatLE(options.nanUv && i === 0 ? NaN : x,36+i*4));
  [0,1,options.index ?? 2].forEach((x,i) => bin.writeUInt16LE(x,60+i*2));
  png.copy(bin,68);
  const doc = {asset:{version:'2.0'},buffers:[{byteLength:68+png.length,...(options.external ? {uri:'external.bin'} : {})}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36,...(options.stride ? {byteStride:options.stride} : {})},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:6},{buffer:0,byteOffset:68,byteLength:png.length}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},{bufferView:1,componentType:5126,count:3,type:'VEC2'},{bufferView:2,componentType:5123,count:3,type:'SCALAR'}],meshes:[{name:'fixture',primitives:[{attributes:{POSITION:0,...(options.noUv ? {} : {TEXCOORD_0:1})},indices:2}]}],images:options.noImage ? [] : [{bufferView:3,mimeType:'image/png'}]};
  if (options.extraPrimitive) doc.meshes[0].primitives.push(doc.meshes[0].primitives[0]);
  if (options.skin) doc.skins=[{joints:[0]}];
  if (options.imageUri) doc.images=[{uri:'https://example.invalid/a.png',mimeType:'image/png'}];
  const raw=Buffer.from(JSON.stringify(doc)); const json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]);
  const h=Buffer.alloc(12);h.writeUInt32LE(options.badHeader?0:0x46546c67);h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length+bin.length,8);
  const chunk=(type,bytes)=>{const header=Buffer.alloc(8);header.writeUInt32LE(bytes.length);header.writeUInt32LE(type,4);return Buffer.concat([header,bytes]);};
  const glb=Buffer.concat([h,chunk(0x4e4f534a,json),chunk(0x004e4942,bin)]);
  return options.truncated ? glb.subarray(0,-1) : glb;
}

test('valid triangle, embedded image bytes and fail-closed release fields',()=>{
  const r=inspectGlb(fixture());assert.equal(r.triangles,1);assert.equal(r.embeddedImages,1);assert.equal(r.technicalScreen,'PASS');assert.equal(r.rigScreen,'NOT_MET');assert.equal(r.likeness,'NOT_EVALUATED');assert.equal(r.ownerVisualApproval,'REQUIRED');assert.equal(r.releaseEligible,false);
});
for (const [name,options,error] of [
  ['bad header',{badHeader:true},/header/],['truncated',{truncated:true},/header/],['bad index',{index:3},/index out of bounds/],['NaN position',{nan:true},/non-finite position/],['NaN UV',{nanUv:true},/non-finite UV/],['bad stride',{stride:24},/accessor out of bounds/],['external buffer',{external:true},/non-embedded/],['external image',{imageUri:true},/unsupported image/]
]) test('rejects '+name,()=>assert.throws(()=>inspectGlb(fixture(options)),error));
for (const [name,options,field] of [['missing UV',{noUv:true},'uvMissing'],['out-of-range UV',{outsideUv:true},'uvOutOfRange'],['degenerate triangle',{degenerate:true},'degenerate']]) test(name+' fails screen',()=>{const r=inspectGlb(fixture(options));assert.equal(r[field],1);assert.equal(r.technicalScreen,'NOT_MET');assert.equal(r.releaseEligible,false);});
test('missing embedded image fails screen',()=>assert.equal(inspectGlb(fixture({noImage:true})).technicalScreen,'NOT_MET'));
test('triangle budget is enforced across primitives',()=>{const r=inspectGlb(fixture({extraPrimitive:true}),{triangleBudget:1});assert.equal(r.triangles,2);assert.equal(r.technicalScreen,'NOT_MET');});
test('invalid budget rejected',()=>assert.throws(()=>inspectGlb(fixture(),{triangleBudget:0}),/invalid triangle budget/));
test('skin presence alone never proves rig or release',()=>{const r=inspectGlb(fixture({skin:true}));assert.equal(r.skins,1);assert.equal(r.rigScreen,'NOT_MET');assert.equal(r.releaseEligible,false);});
