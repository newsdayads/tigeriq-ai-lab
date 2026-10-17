import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-ignore Isolated .mjs runtime module intentionally has no declaration emit.
import {projectPublicSharedLeases} from '../../apps/tigeriq-core/public-shared-lease-projection.mjs';

const lease=()=>({
 resource_id:'res:rea:nv02',employee_id:'NV02',lane:'rea_readonly',role:'observer',
 work_id:'GH-4780',lease_until:'2026-10-17T06:00:00Z',
 heartbeat_at:'2026-10-17T05:59:00Z',
 metadata:{
  workOrderId:4780,secret:'PRIVATE_METADATA_SECRET',
  nested:{authorization:'PRIVATE_ACCESS_TOKEN'},resourceScope:'DO_NOT_ECHO'
 },
 lease_token:'PRIVATE_BEARER_LEASE_TOKEN',otherSecret:'DO_NOT_ECHO'
});

it('Core lease public status preserves bounded identity and occupancy fields only',()=>{
 const row=lease(),result=projectPublicSharedLeases([row]);
 expect(result).toEqual([{resource_id:row.resource_id,employee_id:'NV02',
  lane:'rea_readonly',role:'observer',work_id:'GH-4780',
  lease_until:row.lease_until,heartbeat_at:row.heartbeat_at}]);
 for(const forbidden of ['metadata','lease_token','otherSecret','PRIVATE_METADATA_SECRET','PRIVATE_ACCESS_TOKEN','DO_NOT_ECHO'])
  expect(JSON.stringify(result)).not.toContain(forbidden);
 expect(row.metadata.secret).toBe('PRIVATE_METADATA_SECRET');
 expect(row.lease_token).toBe('PRIVATE_BEARER_LEASE_TOKEN');
});

it('zero leases remains empty; multiple leases remain distinct, with no synthetic lease',()=>{
 expect(projectPublicSharedLeases([])).toEqual([]);
 const original=lease();
 const second={...original,resource_id:'other',employee_id:'NV08',work_id:'GH-OTHER'};
 const result=projectPublicSharedLeases([original,second]);
 expect(result).toHaveLength(2);
 expect(result.map((r:any)=>r.resource_id)).toEqual(['res:rea:nv02','other']);
 expect(result.every((r:any)=>!Object.hasOwn(r,'metadata'))).toBe(true);
});

it('malformed lease projection fails closed instead of silently hiding occupied resources',()=>{
 for(const invalid of [null,undefined,{},[null],[1],['not-a-lease']])
  expect(()=>projectPublicSharedLeases(invalid)).toThrow('INVALID_SHARED_LEASE_PROJECTION');
});

it('rejects incomplete and malformed lease identities instead of emitting anonymous public rows',()=>{
  const fields=[
    'resource_id','employee_id','lane','work_id','role','lease_until','heartbeat_at'
  ];
  expect(()=>projectPublicSharedLeases([{}])).toThrow('INVALID_SHARED_LEASE_PROJECTION');
  for(const key of fields){
    const missing:any=lease();
    delete missing[key];
    expect(()=>projectPublicSharedLeases([missing]),key+' missing').toThrow('INVALID_SHARED_LEASE_PROJECTION');
    const empty:any=lease();
    empty[key]='';
    expect(()=>projectPublicSharedLeases([empty]),key+' empty').toThrow('INVALID_SHARED_LEASE_PROJECTION');
    const nullish:any=lease();
    nullish[key]=null;
    expect(()=>projectPublicSharedLeases([nullish]),key+' null').toThrow('INVALID_SHARED_LEASE_PROJECTION');
  }
  for(const timestamp of ['lease_until','heartbeat_at']){
    const broken:any=lease();
    broken[timestamp]='not-a-date';
    expect(()=>projectPublicSharedLeases([broken])).toThrow('INVALID_SHARED_LEASE_PROJECTION');
    broken[timestamp]=new Date(NaN);
    expect(()=>projectPublicSharedLeases([broken])).toThrow('INVALID_SHARED_LEASE_PROJECTION');
  }
});

it('accepts native pg Date timestamp shapes without changing the original DB lease',()=>{
  const row:any=lease();
  row.lease_until=new Date('2026-10-17T06:00:00Z');
  row.heartbeat_at=new Date('2026-10-17T05:59:00Z');
  const output=projectPublicSharedLeases([row]);
  expect(output).toHaveLength(1);
  expect(output[0].lease_until).toBe(row.lease_until);
  expect(output[0].heartbeat_at).toBe(row.heartbeat_at);
  expect(JSON.stringify(output)).toContain('2026-10-17T06:00:00.000Z');
  expect(JSON.stringify(output)).not.toContain('PRIVATE_METADATA_SECRET');
  expect(row.metadata.secret).toBe('PRIVATE_METADATA_SECRET');
});

it('rejects accessor-backed or inherited lease identity without invoking getters',()=>{
  let hits=0;
  const row:any=lease();
  Object.defineProperty(row,'employee_id',{enumerable:true,get(){hits++;return 'NV02';}});
  expect(()=>projectPublicSharedLeases([row])).toThrow('INVALID_SHARED_LEASE_PROJECTION');
  expect(hits).toBe(0);
  const prototype=lease();
  const inherited=Object.create(prototype);
  expect(()=>projectPublicSharedLeases([inherited])).toThrow('INVALID_SHARED_LEASE_PROJECTION');
});

it('metadata accessor is never dereferenced, even if it would throw or leak credentials',()=>{
 const row:any=lease();
 Object.defineProperty(row,'metadata',{get(){throw new Error('PRIVATE_THROWN_TOKEN')}});
 const output=projectPublicSharedLeases([row]);
 expect(JSON.stringify(output)).not.toContain('PRIVATE_THROWN_TOKEN');
});

it('Core HTTP status endpoints both use bounded lease presentation while internal leases remain available',()=>{
 const source=readFileSync(new URL('../../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
 const live=source.slice(source.indexOf('async function liveStatusSnapshot(){'),source.indexOf('async function snapshot(){'));
 const entire=source.slice(source.indexOf('async function snapshot(){'),source.indexOf('let workOrdersCache=',source.indexOf('async function snapshot(){')));
 expect(live).toContain('indexSharedResourceLeases(sharedLeases)');
 expect(live).toContain('sharedLeases:projectPublicSharedLeases(sharedLeases)');
 expect(entire).toContain('indexSharedResourceLeases(sharedLeases)');
 expect(entire).toContain('sharedLeases:projectPublicSharedLeases(sharedLeases)');
 expect(source).toContain("url.pathname==='/api/live-status'");
 expect(source).toContain("url.pathname==='/api/status'");
});
