import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Offline inspection only. No external URIs, execution, or asset mutation.
export function inspectGlb(input, { triangleBudget = 30000 } = {}) {
  const b = Buffer.from(input);
  const fail = msg => { throw new Error(msg); };
  if (!Number.isSafeInteger(triangleBudget) || triangleBudget < 1) fail('invalid triangle budget');
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length) fail('invalid GLB header');
  let at = 12, d, bin, chunks = 0;
  while (at < b.length) {
    if (at + 8 > b.length) fail('truncated chunk header');
    const len = b.readUInt32LE(at), type = b.readUInt32LE(at + 4);
    at += 8;
    if (len % 4 || at + len > b.length) fail('invalid chunk length');
    if (chunks++ === 0 && type !== 0x4e4f534a) fail('JSON must be first');
    if (type === 0x4e4f534a) { if (d) fail('duplicate JSON'); d = JSON.parse(b.subarray(at, at + len).toString('utf8')); }
    else if (type === 0x004e4942) { if (bin) fail('duplicate BIN'); bin = b.subarray(at, at + len); }
    at += len;
  }
  if (d?.asset?.version !== '2.0' || !bin || d.buffers?.length !== 1 || d.buffers[0].uri != null) fail('unsupported non-embedded GLB');
  const logical = d.buffers[0].byteLength;
  if (!Number.isSafeInteger(logical) || logical < 0 || logical > bin.length || bin.length - logical > 3) fail('invalid buffer length');
  const integer = (x, name) => { if (!Number.isSafeInteger(x) || x < 0) fail('invalid ' + name); return x; };
  function view(i) {
    const v = d.bufferViews?.[integer(i, 'view index')];
    if (!v || v.buffer !== 0) fail('invalid buffer view');
    const start = integer(v.byteOffset ?? 0, 'view offset'), length = integer(v.byteLength, 'view length');
    if (start > logical || length > logical - start) fail('buffer view out of bounds');
    return { v, start, length };
  }
  function accessor(i, kind, types) {
    const a = d.accessors?.[integer(i, 'accessor index')];
    if (!a || a.type !== kind || !types.includes(a.componentType) || a.sparse || a.normalized) fail('unsupported accessor');
    const { v, start, length } = view(a.bufferView);
    const count = integer(a.count, 'accessor count'), off = integer(a.byteOffset ?? 0, 'accessor offset');
    const components = { SCALAR:1, VEC2:2, VEC3:3 }[kind];
    const size = {5121:1,5123:2,5125:4,5126:4}[a.componentType], width = size * components;
    const stride = integer(v.byteStride ?? width, 'stride');
    if (!count || stride < width || stride % size || (start + off) % size || off > length || width > length - off || count - 1 > Math.floor((length - off - width) / stride)) fail('accessor out of bounds');
    const reader = {5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];
    return { count, get:(n,c=0) => bin[reader](start + off + n*stride + c*size) };
  }
  if (!Array.isArray(d.meshes) || !d.meshes.length) fail('missing meshes');
  const meshes = []; let total = 0, morphTargets = 0, uvMissing = 0, uvOutOfRange = 0, degenerate = 0;
  for (const [mi,m] of d.meshes.entries()) {
    if (!Array.isArray(m.primitives) || !m.primitives.length) fail('missing primitives');
    let triangles = 0, vertices = 0;
    for (const p of m.primitives) {
      if ((p.mode ?? 4) !== 4) fail('only triangle primitives supported');
      const pos = accessor(p.attributes?.POSITION, 'VEC3', [5126]);
      const uv = p.attributes?.TEXCOORD_0 == null ? null : accessor(p.attributes.TEXCOORD_0, 'VEC2', [5126]);
      if (uv && uv.count !== pos.count) fail('UV count mismatch');
      if (!uv) uvMissing++;
      for (let n=0;n<pos.count;n++) {
        for(let c=0;c<3;c++) if(!Number.isFinite(pos.get(n,c))) fail('non-finite position');
        if(uv) for(let c=0;c<2;c++) { const x=uv.get(n,c); if(!Number.isFinite(x)) fail('non-finite UV'); if(x<0||x>1) uvOutOfRange++; }
      }
      const idx = p.indices == null ? null : accessor(p.indices,'SCALAR',[5121,5123,5125]);
      const count = idx?.count ?? pos.count;
      if (count % 3) fail('non-triangle index count');
      for(let k=0;k<count;k+=3) {
        const a=idx?idx.get(k):k, c=idx?idx.get(k+1):k+1, e=idx?idx.get(k+2):k+2;
        if(a>=pos.count||c>=pos.count||e>=pos.count) fail('index out of bounds');
        const x=[0,1,2].map(j=>pos.get(c,j)-pos.get(a,j)), y=[0,1,2].map(j=>pos.get(e,j)-pos.get(a,j));
        const cross=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
        if(cross.every(v=>v===0)) degenerate++;
      }
      triangles+=count/3; vertices+=pos.count; morphTargets+=p.targets?.length??0;
    }
    total+=triangles; meshes.push({name:m.name??'mesh-'+mi,triangles,vertices});
  }
  const images=d.images??[];
  for(const im of images) { if(im.uri!=null || !['image/png','image/jpeg','image/webp'].includes(im.mimeType)) fail('unsupported image'); if(!view(im.bufferView).length) fail('empty image'); }
  const skins=d.skins?.length??0, animations=d.animations?.length??0;
  return { schema:'tig-glb-inspection-v1',sha256:createHash('sha256').update(b).digest('hex'),meshes,triangles:total,triangleBudget,embeddedImages:images.length,uvMissing,uvOutOfRange,degenerate,skins,morphTargets,animations,
    technicalScreen:total<=triangleBudget&&uvMissing===0&&uvOutOfRange===0&&degenerate===0&&images.length>0?'PASS':'NOT_MET',
    rigScreen:skins>0&&morphTargets>0?'PRESENT_NOT_VALIDATED':'NOT_MET',
    likeness:'NOT_EVALUATED',deformation:'NOT_EVALUATED',ownerVisualApproval:'REQUIRED',releaseEligible:false };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(inspectGlb(readFileSync(process.argv[2])),null,2)); }
  catch(e) { console.error(e.message); process.exitCode=1; }
}
