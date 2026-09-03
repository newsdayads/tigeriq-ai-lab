import { describe,expect,it } from 'vitest';
import { WorkforceControllerV1 } from '../apps/workforce-controller/src/controller.js';
import type { OperationalWorkService } from '../packages/work-state/src/service.js';
import type { SqlClientLike,SqlPoolLike,SqlQueryResult } from '../packages/work-state/src/postgres-repository.js';

class StatusPool implements SqlPoolLike {
  readonly queries:string[]=[];
  constructor(private readonly versions:string[]){}
  async query<Row=Record<string,unknown>>(text:string,_values?:readonly unknown[]):Promise<SqlQueryResult<Row>>{
    this.queries.push(text);
    if(text.includes('tigeriq_schema_migrations'))return{rows:this.versions.map(version=>({version})) as unknown as Row[]};
    if(text.includes('count(*)'))return{rows:[{employees:'1',devices:'1',queued_jobs:'0',active_leases:'0'}] as unknown as Row[]};
    throw new Error(`unexpected status query: ${text}`);
  }
  async connect():Promise<SqlClientLike>{throw new Error('status must not open a transaction client');}
}

const request={method:'GET',path:'/api/v1/status',headers:{},body:Buffer.alloc(0)};
const serviceStub=null as unknown as OperationalWorkService;

describe('Workforce Controller readiness truth',()=>{
  it('fails closed when replay-protection migration 002 is missing',async()=>{
    const pool=new StatusPool(['001_operational_state_v1']);
    const response=await new WorkforceControllerV1(pool,serviceStub).handle(request);
    expect(response.status).toBe(503);
    expect(response.body.postgres).toBe(false);
    expect(response.body.migrations).toEqual(['001_operational_state_v1']);
    expect(response.body.missingMigrations).toEqual(['002_device_proof_replay_v1']);
    expect(pool.queries.some(query=>query.includes('count(*)'))).toBe(false);
  });

  it('fails closed when operational migration 001 is missing',async()=>{
    const pool=new StatusPool(['002_device_proof_replay_v1']);
    const response=await new WorkforceControllerV1(pool,serviceStub).handle(request);
    expect(response.status).toBe(503);
    expect(response.body.postgres).toBe(false);
    expect(response.body.missingMigrations).toEqual(['001_operational_state_v1']);
  });

  it('reports ready only when both canonical migrations are present',async()=>{
    const pool=new StatusPool(['002_device_proof_replay_v1','001_operational_state_v1']);
    const response=await new WorkforceControllerV1(pool,serviceStub).handle(request);
    expect(response.status).toBe(200);
    expect(response.body.postgres).toBe(true);
    expect(response.body.protocol).toBe('controller-v1');
    expect(response.body.migrations).toEqual(['001_operational_state_v1','002_device_proof_replay_v1']);
    expect(response.body.requiredMigrations).toEqual(['001_operational_state_v1','002_device_proof_replay_v1']);
    expect(response.body.workforce).toEqual({employees:1,devices:1,queuedJobs:0,activeLeases:0});
  });
});
