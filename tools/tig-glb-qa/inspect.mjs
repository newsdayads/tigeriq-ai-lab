import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

// Framing checks only: no pixel decode or full codec conformance claim.
const crcTable = Uint32Array.from({length:256}, (_, i) => {
  for (let bit=0; bit<8; bit++) i = (i >>> 1) ^ ((i & 1) ? 0xedb88320 : 0);
  return i >>> 0;
});
function crc32(bytes) {
  let crc=0xffffffff;
  for (const byte of bytes) crc=(crc >>> 8)^crcTable[(crc^byte)&255];
  return (crc^0xffffffff)>>>0;
}

function jsonDocumentEnd(text) {
  let start=0;
  while (start<text.length && /\s/.test(text[start])) start++;
  const first=text[start];
  if (first==='"') {
    let escaped=false;
    for (let i=start+1;i<text.length;i++) {
      if (escaped) escaped=false;
      else if (text[i]==='\\') escaped=true;
      else if (text[i]==='"') return i+1;
    }
    throw new Error('invalid JSON chunk');
  }
  if (first!=='{' && first!=='[') {
    let end=start;
    while (end<text.length && !/\s/.test(text[end])) end++;
    if (end===start) throw new Error('invalid JSON chunk');
    return end;
  }
  let depth=0, inString=false, escaped=false;
  for (let i=start;i<text.length;i++) {
    const ch=text[i];
    if (inString) {
      if (escaped) escaped=false;
      else if (ch==='\\') escaped=true;
      else if (ch==='"') inString=false;
      continue;
    }
    if (ch==='"') inString=true;
    else if (ch==='{' || ch==='[') depth++;
    else if (ch==='}' || ch===']') {
      depth--;
      if (depth===0) return i+1;
      if (depth<0) throw new Error('invalid JSON chunk');
    }
  }
  throw new Error('invalid JSON chunk');
}
function checkImage(bytes, mime) {
  const bad = name => { throw new Error('invalid '+name+' image framing'); };
  if (mime==='image/png') {
    if(bytes.length<45 || !bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) bad('PNG');
    let at=8, first=true, hasData=false, ended=false;
    while(at<bytes.length) {
      if(bytes.length-at<12) bad('PNG');
      const len=bytes.readUInt32BE(at), type=bytes.toString('ascii',at+4,at+8);
      if(len>bytes.length-at-12) bad('PNG');
      const end=at+8+len;
      if(crc32(bytes.subarray(at+4,end))!==bytes.readUInt32BE(end)) bad('PNG');
      if(first) {
        if(type!=='IHDR'||len!==13||!bytes.readUInt32BE(at+8)||!bytes.readUInt32BE(at+12)) bad('PNG');
        first=false;
      } else if(type==='IHDR') bad('PNG');
      if(type==='IDAT'&&len>0) hasData=true;
      at=end+4;
      if(type==='IEND') { if(len!==0||at!==bytes.length||!hasData) bad('PNG'); ended=true; break; }
    }
    if(!ended) bad('PNG');
  } else if(mime==='image/jpeg') {
    if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217) bad('JPEG');
  } else if(mime==='image/webp') {
    if(bytes.length<20||bytes.toString('ascii',0,4)!=='RIFF'||bytes.readUInt32LE(4)!==bytes.length-8||bytes.toString('ascii',8,12)!=='WEBP') bad('WebP');
    let at=12, hasImage=false;
    while(at<bytes.length) {
      if(bytes.length-at<8) bad('WebP');
      const type=bytes.toString('ascii',at,at+4), len=bytes.readUInt32LE(at+4);
      if(len+(len&1)>bytes.length-at-8) bad('WebP');
      if((len&1)!==0 && bytes[at+8+len]!==0) bad('WebP');
      if((type==='VP8 '||type==='VP8L'||type==='ANMF')&&len>0) hasImage=true;
      at+=8+len+(len&1);
    }
    if(!hasImage) bad('WebP');
  }
}

// Offline inspection only. No external URIs, execution, or asset mutation.
export function inspectGlb(input, { triangleBudget = 30000 } = {}) {
  const b = Buffer.from(input);
  const fail = msg => { throw new Error(msg); };
  if (!Number.isSafeInteger(triangleBudget) || triangleBudget < 1) fail('invalid triangle budget');
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length) fail('invalid GLB header');
  let at = 12, d, bin, chunks = 0, hasJson = false;
  while (at < b.length) {
    if (at + 8 > b.length) fail('truncated chunk header');
    const len = b.readUInt32LE(at), type = b.readUInt32LE(at + 4);
    at += 8;
    if (len % 4 || at + len > b.length) fail('invalid chunk length');
    if (chunks++ === 0 && type !== 0x4e4f534a) fail('JSON must be first');
    if (type === 0x004e4942 && chunks !== 2) fail('BIN chunk must be second');
    if (type === 0x4e4f534a) { if (hasJson) fail('duplicate JSON'); hasJson = true; let jsonText;
      try { jsonText = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(at, at + len)); }
      catch { fail('invalid UTF-8 JSON'); }
      let documentEnd;
      try { documentEnd = jsonDocumentEnd(jsonText); }
      catch { fail('invalid JSON chunk'); }
      const hasUtf8Bom = b[at] === 0xef && b[at + 1] === 0xbb && b[at + 2] === 0xbf;
      const documentBytes = (hasUtf8Bom ? 3 : 0) + Buffer.byteLength(jsonText.slice(0, documentEnd), 'utf8');
      const paddingLength = (4 - (documentBytes % 4)) % 4;
      if (len - documentBytes !== paddingLength) fail('invalid JSON chunk padding');
      const jsonPadding = b.subarray(at + len - paddingLength, at + len);
      if (jsonPadding.some(byte => byte !== 0x20)) fail('invalid JSON chunk padding');
      d = JSON.parse(jsonText); }
    else if (type === 0x004e4942) { if (bin) fail('duplicate BIN'); bin = b.subarray(at, at + len); }
    at += len;
  }
  if (!Array.isArray(d?.buffers) || !Array.isArray(d.bufferViews) || !Array.isArray(d.accessors)) fail('invalid glTF storage arrays');
  if (d?.asset?.version !== '2.0' || !bin || d.buffers.length !== 1 || d.buffers[0].uri !== undefined) fail('unsupported non-embedded GLB');
  const readExtensionList = (name, value) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length === 0 || value.some(extension => typeof extension !== 'string' || extension.trim().length === 0) || new Set(value).size !== value.length) {
      fail('invalid ' + name);
    }
    return value;
  };
  const extensionsUsed = readExtensionList('extensionsUsed', d.extensionsUsed);
  const extensionsRequired = readExtensionList('extensionsRequired', d.extensionsRequired);
  const usedExtensions = new Set(extensionsUsed);
  function validateVertexAttribute(semantic, attribute) {
    const type = attribute.type, componentType = attribute.componentType, normalized = attribute.normalized === true;
    let valid = false;
    if (semantic === 'POSITION') valid = type === 'VEC3' && componentType === 5126 && !normalized;
    else if (semantic === 'NORMAL') valid = type === 'VEC3' && componentType === 5126 && !normalized;
    else if (semantic === 'TANGENT') valid = type === 'VEC4' && componentType === 5126 && !normalized;
    else {
      const indexed = /^(TEXCOORD|COLOR|JOINTS|WEIGHTS)_(0|[1-9][0-9]{0,8})$/.exec(semantic);
      if (indexed) {
        const family = indexed[1];
        if (family === 'TEXCOORD') valid = type === 'VEC2' && (componentType === 5126 && !normalized || (componentType === 5121 || componentType === 5123) && normalized);
        else if (family === 'COLOR') valid = (type === 'VEC3' || type === 'VEC4') && (componentType === 5126 && !normalized || (componentType === 5121 || componentType === 5123) && normalized);
        else if (family === 'JOINTS') valid = type === 'VEC4' && (componentType === 5121 || componentType === 5123) && !normalized;
        else if (family === 'WEIGHTS') valid = type === 'VEC4' && (componentType === 5126 && !normalized || (componentType === 5121 || componentType === 5123) && normalized);
      } else if (semantic.startsWith('_')) {
        // Application-specific attributes may use supported component types, but never UNSIGNED_INT.
        valid = ['SCALAR', 'VEC2', 'VEC3', 'VEC4'].includes(type) && [5120, 5121, 5122, 5123, 5126].includes(componentType);
      } else if (/^[A-Za-z][A-Za-z0-9_]*:[A-Za-z_][A-Za-z0-9_]*$/.test(semantic)) {
        const extension = semantic.slice(0, semantic.indexOf(':'));
        if (!usedExtensions.has(extension)) fail('undeclared vertex attribute extension');
        return;
      }
    }
    if (!valid) fail('invalid vertex attribute storage: ' + semantic);
  }
  const supportedRequiredExtensions = new Set();
  for (const extension of extensionsRequired) {
    if (!usedExtensions.has(extension)) fail('required extension missing from extensionsUsed');
    if (!supportedRequiredExtensions.has(extension)) fail('unsupported required glTF extension: ' + extension);
  }
  const logical = d.buffers[0].byteLength;
  if (!Number.isSafeInteger(logical) || logical < 0 || logical > bin.length || bin.length - logical > 3) fail('invalid buffer length');
  if (bin.subarray(logical).some(byte => byte !== 0)) fail('invalid BIN padding');
  const integer = (x, name) => { if (!Number.isSafeInteger(x) || x < 0) fail('invalid ' + name); return x; };
  function view(i, { allowStride = false } = {}) {
    const v = d.bufferViews?.[integer(i, 'view index')];
    if (!v || v.buffer !== 0) fail('invalid buffer view');
    const start = integer(v.byteOffset === undefined ? 0 : v.byteOffset, 'view offset'), length = integer(v.byteLength, 'view length');
    if (start > logical || length > logical - start) fail('buffer view out of bounds');
    if (v.byteStride !== undefined) {
      if (!allowStride) fail('byteStride only allowed for vertex attributes');
      if (!Number.isSafeInteger(v.byteStride) || v.byteStride < 4 || v.byteStride > 252 || v.byteStride % 4 !== 0) fail('invalid buffer view stride');
    }
    return { v, start, length };
  }
  function accessor(i, kind, types, { allowNormalizedInteger = false, vertexAttribute = false } = {}) {
    const a = d.accessors?.[integer(i, 'accessor index')];
    if (!a || a.type !== kind || !types.includes(a.componentType) || a.sparse !== undefined) fail('unsupported accessor');
    if (a.normalized !== undefined && typeof a.normalized !== 'boolean') fail('invalid normalized accessor');
    if (allowNormalizedInteger) {
      const unsignedInteger = a.componentType === 5121 || a.componentType === 5123;
      if (unsignedInteger !== (a.normalized === true)) fail('invalid normalized accessor');
      if (![5126, 5121, 5123].includes(a.componentType)) fail('unsupported normalized accessor');
    } else if (a.normalized) fail('unsupported accessor');
    const { v, start, length } = view(a.bufferView, { allowStride: vertexAttribute });
    const count = integer(a.count, 'accessor count'), off = integer(a.byteOffset === undefined ? 0 : a.byteOffset, 'accessor offset');
    const components = { SCALAR:1, VEC2:2, VEC3:3 }[kind];
    const size = {5121:1,5123:2,5125:4,5126:4}[a.componentType], width = size * components;
    const stride = integer(v.byteStride === undefined ? width : v.byteStride, 'stride');
    if (off % size !== 0 || (start + off) % size !== 0) fail('invalid accessor alignment');
    if (vertexAttribute && (off % 4 !== 0 || (v.byteStride == null && size % 4 !== 0))) fail('invalid vertex attribute alignment');
    if (!count || stride < width || stride % size || off > length || width > length - off || count - 1 > Math.floor((length - off - width) / stride)) fail('accessor out of bounds');
    const reader = {5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];
    return { count, componentType: a.componentType, get:(n,c=0) => {
      const value = bin[reader](start + off + n*stride + c*size);
      if (!a.normalized) return value;
      if (a.componentType === 5121) return value / 255;
      if (a.componentType === 5123) return value / 65535;
      fail('unsupported normalized accessor');
    }};
  }
  if (!Array.isArray(d.meshes) || !d.meshes.length) fail('missing meshes');
  const meshes = []; let total = 0, morphTargets = 0, uvMissing = 0, uvOutOfRange = 0, degenerate = 0;
  const vertexViewAccessors = new Map();
  for (const [mi,m] of d.meshes.entries()) {
    if (!Array.isArray(m.primitives) || !m.primitives.length) fail('missing primitives');
    let triangles = 0, vertices = 0;
    for (const p of m.primitives) {
      if (p.mode !== undefined && p.mode !== 4) fail('only triangle primitives supported');
      let vertexAttributeCount;
      for (const [semantic, accessorIndex] of Object.entries(p.attributes ?? {})) {
        const index = integer(accessorIndex, 'vertex attribute accessor index');
        const attribute = d.accessors?.[index];
        if (!attribute || typeof attribute !== 'object' || Array.isArray(attribute) || attribute.bufferView == null || attribute.sparse !== undefined) fail('unsupported vertex attribute accessor');
        validateVertexAttribute(semantic, attribute);
        const components = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4 }[attribute.type];
        const componentSize = {5120:1,5121:1,5122:2,5123:2,5126:4}[attribute.componentType];
        if (!Number.isSafeInteger(components) || !Number.isSafeInteger(componentSize)) fail('unsupported vertex attribute accessor');
        if (attribute.normalized !== undefined && typeof attribute.normalized !== 'boolean') fail('invalid normalized accessor');
        if (attribute.normalized === true && attribute.componentType === 5126) fail('unsupported normalized accessor');
        const { v, start, length } = view(attribute.bufferView, { allowStride: true });
        const count = integer(attribute.count, 'accessor count'), offset = integer(attribute.byteOffset === undefined ? 0 : attribute.byteOffset, 'accessor offset');
        if (!count) fail('invalid accessor count');
        const width = components * componentSize;
        const stride = integer(v.byteStride === undefined ? width : v.byteStride, 'stride');
        if (offset % componentSize !== 0 || (start + offset) % componentSize !== 0) fail('invalid accessor alignment');
        if (offset % 4 !== 0 || (v.byteStride == null && componentSize % 4 !== 0)) fail('invalid vertex attribute alignment');
        if (stride < width || stride % componentSize || offset > length || width > length - offset || count - 1 > Math.floor((length - offset - width) / stride)) fail('accessor out of bounds');
        if (vertexAttributeCount !== undefined && count !== vertexAttributeCount) fail('vertex attribute count mismatch');
        vertexAttributeCount = count;
        let references = vertexViewAccessors.get(attribute.bufferView);
        if (!references) vertexViewAccessors.set(attribute.bufferView, references = new Set());
        references.add(index);
      }
      if (!p.attributes || typeof p.attributes !== 'object' || Array.isArray(p.attributes)) fail('invalid primitive attributes');
      const positionIndex = integer(p.attributes.POSITION, 'vertex attribute accessor index');
      const pos = accessor(positionIndex, 'VEC3', [5126], { vertexAttribute: true });
      const positionDefinition = d.accessors[positionIndex];
      if (!Array.isArray(positionDefinition.min) || !Array.isArray(positionDefinition.max) || positionDefinition.min.length !== 3 || positionDefinition.max.length !== 3 || [...positionDefinition.min, ...positionDefinition.max].some(value => !Number.isFinite(value))) fail('invalid POSITION bounds');
      const positionMin = [Infinity, Infinity, Infinity], positionMax = [-Infinity, -Infinity, -Infinity];
      const uv = p.attributes.TEXCOORD_0 === undefined ? null : accessor(p.attributes.TEXCOORD_0, 'VEC2', [5126,5121,5123], { allowNormalizedInteger:true, vertexAttribute: true });
      if (uv && uv.count !== pos.count) fail('UV count mismatch');
      if (!uv) uvMissing++;
      for (let n=0;n<pos.count;n++) {
        for(let c=0;c<3;c++) { const value = pos.get(n,c); if(!Number.isFinite(value)) fail('non-finite position'); positionMin[c] = Math.min(positionMin[c], value); positionMax[c] = Math.max(positionMax[c], value); }
        if(uv) for(let c=0;c<2;c++) { const x=uv.get(n,c); if(!Number.isFinite(x)) fail('non-finite UV'); if(x<0||x>1) uvOutOfRange++; }
      }
      if (p.targets !== undefined && !Array.isArray(p.targets)) fail('invalid morph targets');
      if (positionDefinition.min.some((value, component) => Math.fround(value) !== positionMin[component]) || positionDefinition.max.some((value, component) => Math.fround(value) !== positionMax[component])) fail('invalid POSITION bounds');
      const idx = p.indices === undefined ? null : accessor(p.indices,'SCALAR',[5121,5123,5125]);
      const count = idx?.count ?? pos.count;
      if (count % 3) fail('non-triangle index count');
      for(let k=0;k<count;k+=3) {
        const a=idx?idx.get(k):k, c=idx?idx.get(k+1):k+1, e=idx?idx.get(k+2):k+2;
        if(idx && [5121,5123,5125].some(type => idx.componentType === type && [a,c,e].includes({5121:255,5123:65535,5125:4294967295}[type]))) fail('reserved maximum index value');
        if(a>=pos.count||c>=pos.count||e>=pos.count) fail('index out of bounds');
        const x=[0,1,2].map(j=>pos.get(c,j)-pos.get(a,j)), y=[0,1,2].map(j=>pos.get(e,j)-pos.get(a,j));
        const cross=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
        if(cross.every(v=>v===0)) degenerate++;
      }
      triangles+=count/3; vertices+=pos.count; morphTargets+=p.targets?.length??0;
    }
    total+=triangles; meshes.push({name:m.name??'mesh-'+mi,triangles,vertices});
  }
  for (const [viewIndex, references] of vertexViewAccessors) {
    const bufferView = d.bufferViews?.[viewIndex];
    if (references.size > 1 && bufferView?.byteStride == null) fail('shared vertex attributes require byteStride');
  }
  if (d.images !== undefined && !Array.isArray(d.images)) fail('invalid images');
  if (d.skins !== undefined && !Array.isArray(d.skins)) fail('invalid skins');
  if (d.animations !== undefined && !Array.isArray(d.animations)) fail('invalid animations');
  const images=d.images ?? [];
  const webpImageIndices = new Set(images.flatMap((image, index) => image?.mimeType === 'image/webp' ? [index] : []));
  if (d.textures !== undefined && !Array.isArray(d.textures)) fail('invalid textures');
  if (webpImageIndices.size && !usedExtensions.has('EXT_texture_webp')) fail('WebP image requires EXT_texture_webp in extensionsUsed');
  if (webpImageIndices.size && !Array.isArray(d.textures)) fail('WebP image requires texture extension references');
  const referencedWebpImages = new Set();
  for (const texture of d.textures ?? []) {
    if (!texture || typeof texture !== 'object' || Array.isArray(texture)) fail('invalid texture');
    const webpExtension = texture.extensions?.EXT_texture_webp;
    if (webpExtension === undefined) continue;
    if (!usedExtensions.has('EXT_texture_webp')) fail('WebP image requires EXT_texture_webp in extensionsUsed');
    if (!webpExtension || typeof webpExtension !== 'object' || Array.isArray(webpExtension)) fail('invalid EXT_texture_webp source');
    const webpSource = integer(webpExtension.source, 'WebP image index');
    const fallbackSource = integer(texture.source, 'fallback image index');
    if (!webpImageIndices.has(webpSource) || fallbackSource >= images.length || !['image/png','image/jpeg'].includes(images[fallbackSource]?.mimeType)) fail('invalid EXT_texture_webp image references');
    referencedWebpImages.add(webpSource);
  }
  for (const index of webpImageIndices) if (!referencedWebpImages.has(index)) fail('unreferenced WebP image');
  for(const im of images) { if (!im || typeof im !== 'object' || Array.isArray(im) || im.uri !== undefined || !['image/png','image/jpeg','image/webp'].includes(im.mimeType)) fail('unsupported image'); const {start,length}=view(im.bufferView); if(!length) fail('empty image'); checkImage(bin.subarray(start,start+length),im.mimeType); }
  const skins=d.skins?.length??0, animations=d.animations?.length??0;
  return { schema:'tig-glb-inspection-v1',sha256:createHash('sha256').update(b).digest('hex'),meshes,triangles:total,triangleBudget,embeddedImages:images.length,uvMissing,uvOutOfRange,degenerate,skins,morphTargets,animations,
    technicalScreen:total<=triangleBudget&&uvMissing===0&&uvOutOfRange===0&&degenerate===0&&images.length>0?'PASS':'NOT_MET',
    rigScreen:skins>0?'NOT_CHECKED':'NOT_MET',
    likeness:'NOT_EVALUATED',deformation:'NOT_EVALUATED',ownerVisualApproval:'REQUIRED',releaseEligible:false };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [file, ...flags] = process.argv.slice(2);
    if (!file || file.startsWith('--') || flags.length>1 || (flags.length===1 && flags[0]!=='--require-technical-pass')) {
      throw new Error('Usage: node inspect.mjs FILE [--require-technical-pass]');
    }
    const report=inspectGlb(readFileSync(file));
    console.log(JSON.stringify(report,null,2));
    if (flags.length===1 && report.technicalScreen!=='PASS') process.exitCode=2;
  } catch(e) { console.error(e.message); process.exitCode=1; }
}
