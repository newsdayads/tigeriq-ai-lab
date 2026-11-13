// Animal City R03A — presentation-only projection of the canonical workforce.
// Never creates identities, dispatches work, or infers live activity from admin labels.
export const TIGER_CEO = Object.freeze({id: 'tiger-ceo', name: 'Tiger', role: 'CEO'});

export const ANIMAL_ZONES = Object.freeze([
  Object.freeze({id:'leadership', name:'Ban điều hành'}),
  Object.freeze({id:'execution', name:'Thực thi và thiết bị'}),
  Object.freeze({id:'engineering', name:'Kỹ thuật và Core'}),
  Object.freeze({id:'review', name:'QA và nghiên cứu'}),
  Object.freeze({id:'cloud', name:'AI Cloud/API'}),
  Object.freeze({id:'restricted', name:'Chờ và giới hạn'}),
]);

const MEMBERS = Object.freeze({
  leadership:'NV00 NV08',
  execution:'NV02 NV06 NV07 NV102',
  engineering:'NV09 NV10 NV17',
  review:'NV03 NV04',
  cloud:'NV11 NV12 NV13 NV14 NV15 NV16 NV19',
  restricted:'NV01 NV05 NV18 NV20',
});
const ZONE_FOR = new Map(Object.entries(MEMBERS)
  .flatMap(([zone, ids]) => ids.split(' ').map(id => [id, zone])));
const ANIMALS = Object.freeze(['fox','wolf','owl','beaver','panda','deer','rabbit']);
const safeText = (value, max=120) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max) : '';
const employeeId = value => {
  const id = safeText(value,8).toUpperCase();
  return /^NV\d{2,3}$/.test(id) ? id : '';
};
const animalFor = id => ANIMALS[[...id].reduce((a,c)=>a+c.charCodeAt(0),0)%ANIMALS.length];

// fresh must be independently verified by the server, not supplied by a worker.
// workers must be the normalized /api/live Core projection (verified job/resource bind).
export function projectAnimalRoster(workforce, {fresh=false,workers=[]}={}) {
  const sourceFresh = fresh === true;
  const roster = Array.isArray(workforce) ? workforce.slice(0,100) : [];
  const live = new Set();
  if (sourceFresh && Array.isArray(workers)) {
    for (const w of workers.slice(0,200)) {
      if (!w || w.activeWorkerVerified !== true || !safeText(w.resourceId) ||
          !safeText(w.currentJobId)) continue;
      const id = employeeId(w.employeeId);
      if (id) live.add(id);
    }
  }
  const seen = new Set(), staff = [];
  for (const entry of roster) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const id = employeeId(entry.employee_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = safeText(entry.name,100) || id;
    const adminState = safeText(entry.admin_state,240).toUpperCase();
    const zoneId = ZONE_FOR.get(id) || 'execution';
    const blocked = /(?:OWNER_STOPPED|DO_NOT_ROUTE|RETIRED|REVOKED)/.test(adminState);
    const waiting = /(?:WAIT_KEY|RATE_LIMIT|QUOTA_EXHAUSTED|CORE_BLOCKED|CORE_EXTERNAL_BLOCKED|PROVISIONING)/.test(adminState);
    const status = !sourceFresh ? 'UNKNOWN' : blocked ? 'STOPPED' : waiting ? 'WAIT' :
      live.has(id) ? 'BUSY' : 'IDLE';
    staff.push({employeeId:id,name,adminState,zoneId,animal:animalFor(id),status,
      activeWorkerVerified:status==='BUSY'});
  }
  const zones = ANIMAL_ZONES.map(z => ({...z,
    members: staff.filter(person=>person.zoneId===z.id)}));
  return {sourceFresh, ceo:TIGER_CEO, zones, staff};
}
