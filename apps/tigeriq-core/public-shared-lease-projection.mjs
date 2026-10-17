// GH-4780 / NV02: read-only Core status must not expose arbitrary
// shared-lease metadata. Keep the full DB record INSIDE Core for fencing.
// Neither this projection nor a public status response grants a lease.
const publicFields=Object.freeze([
  'resource_id','employee_id','lane','work_id','role','lease_until','heartbeat_at'
]);
const timestampFields=new Set(['lease_until','heartbeat_at']);
const invalid=()=>new TypeError('INVALID_SHARED_LEASE_PROJECTION');

function validPublicValue(key,value){
  if(timestampFields.has(key))
    // PostgreSQL timestamptz arrives as a Date in Core; fixtures may be ISO strings.
    return value instanceof Date
      ? Number.isFinite(value.getTime())
      : typeof value==='string' && Number.isFinite(Date.parse(value));
  return typeof value==='string' && value.trim().length>0;
}

export function projectPublicSharedLeases(rows){
  if(!Array.isArray(rows))throw invalid();
  return rows.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row))throw invalid();
    const safe={};
    for(const key of publicFields){
      // Require own data values: missing, inherited or accessor-backed identities
      // must not collapse into anonymous '{}' rows in read-only public status.
      const desc=Object.getOwnPropertyDescriptor(row,key);
      if(!desc||!Object.hasOwn(desc,'value')||!validPublicValue(key,desc.value))
        throw invalid();
      safe[key]=desc.value;
    }
    return safe;
  });
}
