// Independent minimal JSON Pointer get/set implementation for a permitted MIT behavior sample.
// It is intentionally NOT a byte-copy of the upstream janl/node-jsonpointer source.
const dangerous = new Set(['__proto__', 'constructor', 'prototype']);

function compile(pointer) {
  if (typeof pointer === 'string') {
    if (!pointer.startsWith('/')) {
      if (pointer === '') return [];
      throw Error('Invalid JSON pointer.');
    }
    return pointer.slice(1).split('/').map(unescapeSegment);
  }
  if (Array.isArray(pointer)) {
    if (pointer.some(x => typeof x !== 'string' && typeof x !== 'number'))
      throw Error('Invalid JSON pointer. Must be of type string or number.');
    return pointer.slice(1).map(x=>unescapeSegment(String(x)));
  }
  throw Error('Invalid JSON pointer.');
}
function unescapeSegment(x) { return x.replace(/~[01]/g, m => m === '~1' ? '/' : '~'); }
function validObject(obj) { if (obj === null || typeof obj !== 'object') throw Error('Invalid input object.'); }
function ensureSafe(parts) {if (parts.some(p => dangerous.has(p))) throw Error('Unsafe JSON pointer segment.');}

export function get(document, pointer) {
  validObject(document);
  const parts=compile(pointer);
  ensureSafe(parts);
  let cur=document;
  for (const key of parts) {
    if (cur === null || (typeof cur!=='object' && typeof cur!=='function')) return undefined;
    // Reading an accessor is executable behavior, not JSON data.
    // Use own data descriptors for both reads and writes.
    cur=ownValue(cur,key).value;
  }
  return cur;
}
const MAX_ARRAY_ITEMS = 4096;
function safeArrayKey(obj, part) {
  if (!Array.isArray(obj)) return part;
  if (part === '-') {
    if (obj.length >= MAX_ARRAY_ITEMS) throw Error('Array item limit exceeded.');
    return String(obj.length);
  }
  // A JSON Pointer array segment must be a canonical, bounded array index.
  // Arbitrary keys or huge sparse indexes can cause surprising mutations or OOM
  // when the document is subsequently serialized as JSON.
  if (!/^(0|[1-9][0-9]*)$/.test(part)) throw Error('Unsafe array index.');
  const index = Number(part);
  if (!Number.isSafeInteger(index) || index >= MAX_ARRAY_ITEMS || index > obj.length)
    throw Error('Array item limit exceeded.');
  return part;
}
function ownValue(container, part) {
  const descriptor = Object.getOwnPropertyDescriptor(container, part);
  if (!descriptor) return { found: false, value: undefined };
  if (!Object.hasOwn(descriptor, 'value'))
    throw Error('Accessor property forbidden in JSON document.');
  return { found: true, value: descriptor.value };
}
function newContainer(nextPart) {
  return nextPart === '-' || (nextPart !== '' && Number.isFinite(Number(nextPart))) ? [] : {};
}
function traverseForSet(document, parts, value, dryRun) {
  let current = document;
  for (let i=0; i<parts.length; i++) {
    if (current === null || typeof current !== 'object')
      throw Error('Cannot traverse non-object JSON value.');
    const key = safeArrayKey(current, parts[i]);
    const prior = ownValue(current, key);
    const last = i===parts.length-1;
    if (last) {
      if (!dryRun) {
        if (value === undefined) delete current[key];
        else current[key] = value;
      }
      return prior.value;
    }
    if (!prior.found || prior.value===undefined) {
      const child = newContainer(parts[i+1]);
      if (!dryRun) current[key] = child;
      current = child;
    } else current = prior.value;
  }
}
export function set(document, pointer, value) {
  validObject(document);
  const parts=compile(pointer);
  if (!parts.length) throw Error('Invalid JSON pointer for set.');
  ensureSafe(parts);
  // Preflight the entire path before touching the caller-owned document:
  // a late invalid segment or a scalar parent must not leave partial writes.
  traverseForSet(document, parts, value, true);
  return traverseForSet(document, parts, value, false);
}
// This public API accepts JSON-shaped records only. Native structuredClone invokes
// getters on ordinary objects, even though get() itself rejects accessors.
// Reject non-JSON objects before any property-value read or mutation. This does
// NOT sandbox arbitrary Proxy traps; use JSON.parse / trusted plain inputs.
const MAX_CLONE_DEPTH = 128;
const MAX_CLONE_NODES = 12000;
function copyJsonData(value, state, depth=0) {
  if (depth > MAX_CLONE_DEPTH) throw new RangeError('JSON input depth limit exceeded.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // Undefined is preserved for JS callers; JSONL cannot express it.
  if (value === undefined) return undefined;
  if (typeof value !== 'object') throw new TypeError('Non-JSON input value forbidden.');
  if (++state.nodes > MAX_CLONE_NODES) throw new RangeError('JSON input node limit exceeded.');
  if (state.active.has(value)) throw new TypeError('Circular JSON input forbidden.');
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    throw new TypeError('Non-JSON object prototype forbidden.');
  if (array && value.length > MAX_ARRAY_ITEMS)
    throw new RangeError('Array item limit exceeded.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const descriptor of Reflect.ownKeys(descriptors).map(key => descriptors[key])) {
    if (!Object.hasOwn(descriptor, 'value'))
      throw new TypeError('Accessor property forbidden in JSON document.');
  }
  if (Reflect.ownKeys(descriptors).some(key => typeof key === 'symbol'))
    throw new TypeError('Non-JSON symbol property forbidden.');
  // JSON cannot express sparse arrays, named array properties or hidden fields.
  // Silently omitting these while cloning can change input semantics. Reject
  // them instead of returning a seemingly successful but lossy result.
  if (Object.entries(descriptors).some(([key, desc]) =>
    !desc.enumerable && !(array && key === 'length')))
    throw new TypeError('Non-enumerable JSON property forbidden.');
  if (array) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(descriptors, String(index)))
        throw new TypeError('Sparse JSON array forbidden.');
    }
    if (Object.keys(descriptors).some(key => {
      if (key === 'length') return false;
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 ||
        index >= value.length || String(index) !== key;
    }))
      throw new TypeError('Named JSON array property forbidden.');
  }
  state.active.add(value);
  try {
    const result = array ? new Array(value.length) : {};
    for (const [key, desc] of Object.entries(descriptors)) {
      if (!desc.enumerable || (array && key === 'length')) continue;
      // Explicit defineProperty avoids invoking __proto__ setters.
      Object.defineProperty(result, key, {
        value: copyJsonData(desc.value, state, depth + 1),
        enumerable: true, configurable: true, writable: true,
      });
    }
    return result;
  } finally {
    state.active.delete(value);
  }
}
function safeRecordId(record) {
  if (record === null || typeof record !== 'object') return undefined;
  const desc = Object.getOwnPropertyDescriptor(record, 'id');
  return desc && Object.hasOwn(desc, 'value') &&
    (typeof desc.value === 'string' || typeof desc.value === 'number') ? desc.value : undefined;
}
export function outcome(test) {
  let doc;
  let cloned=false;
  let id;
  try {
    id=safeRecordId(test);
    const copied=copyJsonData(test,{nodes:0,active:new WeakSet()});
    doc=copied?.document;
    cloned=true;
    const result=copied?.op==='get' ? get(doc,copied.pointer)
      : copied?.op==='set' ? set(doc,copied.pointer,copied.value) : (()=>{throw Error('Unsupported operation.');})();
    return {id:copied?.id,outcome:'ok',returned:result===undefined?{$type:'undefined'}:result,documentAfter:doc};
  } catch(e) {
    return {id,outcome:'error',name:e.name,message:e.message,documentAfter:cloned?doc:null};
  }
}
