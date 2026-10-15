import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {projectNv07GatewayCanaryEvidence,readNv07GatewayCanarySnapshot} from '../apps/tigeriq-core/nv07-gateway-receipt-observer.mjs';

const NOW=Date.parse('2026-10-15T10:21:00.000Z');
const V3=Object.freeze({
  schema:'NV07_GATEWAY_CANARY_V3',accepted:true,
  state:'GATEWAY_USER_CLI_JSON_VERIFIED_NOT_CORE_LEASE',
  reason:'NV07_READ_METADATA_TRANSPORT_OK',
  jobId:'NV07-4783-GW-STRUCTURE-V3',
  startedAt:'2026-10-15T10:18:23.511Z',
  completedAt:'2026-10-15T10:19:02.197Z',
  exitCode:0,timedOut:false,
  totalTokens:36558,proposedFileCount:0,
  outputHash:'2406fb0aab91f4f1860401584b591e950d421da50edf36978a29931b5f45f81a',
  coreLeaseVerified:false,nv07Active:false,
});
describe('NV07 Core read-only Gateway receipt telemetry',()=>{
  it('classifies verified V3 but never claims Core lease or ACTIVE',()=>{
    const r=projectNv07GatewayCanaryEvidence(V3,'V3',NOW);
    expect(r).toMatchObject({
      version:'V3',available:true,status:'PASSED_GATEWAY_ONLY',accepted:true,
      tokens:36558,proposedFileCount:0,coreLeaseVerified:false,nv07Active:false,
    });
    expect(r.durationMs).toBeGreaterThan(38000);
    expect(JSON.stringify(r)).not.toContain('schema');
  });
  it('projects V1/V2 failures and V3 success without reading other files',()=>{
    const read=(path)=>{
      if(path.endsWith('gateway-read-metadata-v3.json'))return JSON.stringify(V3);
      if(path.endsWith('gateway-read-metadata-v2.json'))return JSON.stringify({
        schema:'NV07_GATEWAY_CANARY_V2',accepted:false,
        state:'GATEWAY_CANARY_FAILED',reason:'NV07_PROPOSAL_SCHEMA_INVALID',
        jobId:'NV07-4783-GW-VALIDATED-V2',
        startedAt:'2026-10-15T07:18:07.424Z',
        completedAt:'2026-10-15T07:19:00.463Z',exitCode:0,timedOut:false,
        outputHash:'9'.repeat(64),coreLeaseVerified:false,nv07Active:false,
      });
      throw Error('NOT_FOUND');
    };
    const r=readNv07GatewayCanarySnapshot({read,nowMs:NOW});
    expect(r).toMatchObject({
      gatewayTransportVerified:true,latestAcceptedVersion:'V3',
      coreLeaseVerified:false,nv07Active:false,state:'PROVISIONING_NOT_ROUTABLE',
    });
    expect(r.canaries.map(x=>x.status)).toEqual([
      undefined,'FAILED','PASSED_GATEWAY_ONLY',
    ]);
    expect(r.canaries[0].available).toBe(false);
  });
  it('rejects forged activation, changed schema, missing digest and future receipt',()=>{
    for(const bad of [
      {coreLeaseVerified:true},{nv07Active:true},{outputHash:'bad'},
      {schema:'OTHER'},{jobId:'DIFFERENT'},
      {completedAt:'2099-01-01T00:00:00.000Z'},
    ])expect(projectNv07GatewayCanaryEvidence({...V3,...bad},'V3',NOW).accepted).toBe(false);
    expect(projectNv07GatewayCanaryEvidence(null,'V3',NOW).accepted).toBe(false);
  });
  it('keeps HTTP route authenticated/loopback-only with no write side effect',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    const start=core.indexOf("if(req.method==='GET'&&url.pathname==='/api/nv07/gateway-status')");
    expect(start).toBeGreaterThan(0);
    const route=core.slice(start,start+410);
    expect(route).toContain('if(!auth(req)&&!localSelf(req))');
    expect(route).toContain('readNv07GatewayCanarySnapshot()');
    expect(route).not.toMatch(/POST|INSERT|UPDATE/);
  });
});