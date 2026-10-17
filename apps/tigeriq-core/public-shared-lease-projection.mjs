// GH-4780 / NV02: read-only Core status must not expose arbitrary
// shared-lease metadata. Keep the full DB record INSIDE Core for fencing.
// Neither this projection nor a public status response grants a lease.
const publicFields=Object.freeze([
  'resource_id','employee_id','lane','work_id','role','lease_until','heartbeat_at'
]);
export function projectPublicSharedLeases(rows){
  if(!Array.isArray(rows))throw new TypeError('INVALID_SHARED_LEASE_PROJECTION');
  return rows.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row))
      throw new TypeError('INVALID_SHARED_LEASE_PROJECTION');
    const safe={};
    for(const key of publicFields)safe[key]=row[key];
    return safe;
  });
}
