// Deterministic pure helpers for work‑handoff
// These helpers are pure, deterministic and have no side‑effects.

/** Simple stable hash – sum of char codes */
function _stableHash(str){
  let h=0;
  for(let i=0;i<str.length;i++) h+=str.charCodeAt(i);
  return h>>>0; // ensure unsigned 32‑bit
}

/** Normalize a child objective definition */
export function normalizeChildObjective(input){
  if(!input||typeof input!=='object') throw new Error('CHILD_OBJECTIVE_INVALID');
  const id=String(input.id||'').trim();
  const title=String(input.title||'').trim();
  const payload=input.payload||{};
  if(!id||!title) throw new Error('CHILD_OBJECTIVE_MISSING_FIELDS');
  return {id:id.slice(0,200),title:title.slice(0,200),payload:payload};
}

/** Scope a child objective under a parent */
export function scopeChildObjective(parentId, child){
  const pid=String(parentId||'').trim();
  if(!pid) throw new Error('PARENT_ID_REQUIRED');
  const norm=normalizeChildObjective(child);
  return {...norm, scopedId:`${pid}:${norm.id}`};
}

/** Deduplicate child objectives by scopedId */
export function dedupeChildObjectives(list){
  const seen=new Set();
  const out=[];
  for(const item of list){
    const scoped=item.scopedId||item.id;
    if(!scoped||seen.has(scoped)) continue;
    seen.add(scoped);
    out.push(item);
  }
  return out;
}

/** Generate a deterministic child key */
export function generateChildKey(parentId, childTitle){
  const pid=String(parentId||'').trim();
  const title=String(childTitle||'').trim();
  if(!pid) throw new Error('PARENT_ID_REQUIRED');
  const hash=_stableHash(title).toString(36);
  return `CHILD-${pid}-${hash}`;
}

/** Evaluate child state based on job history */
export function evaluateChildState(child, history=[]){
  // history: array of job records {status:string}
  if(!Array.isArray(history)) throw new Error('HISTORY_INVALID');
  const done=history.filter(j=>j.status==='done').length;
  return done>0 ? 'complete' : 'pending';
}
