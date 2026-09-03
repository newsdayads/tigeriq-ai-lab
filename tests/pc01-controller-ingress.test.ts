import { describe, expect, test, vi } from 'vitest';
import { WorkforceControllerV1 } from '../apps/workforce-controller/src/controller.js';
import type { SqlPoolLike } from '../packages/work-state/src/postgres-repository.js';
import type { OperationalWorkService } from '../packages/work-state/src/service.js';

const TOKEN='TIGERIQ_TEST_INGRESS_TOKEN_0123456789ABCDEF';
const pool={} as SqlPoolLike;

function request(path:string,body:Record<string,unknown>,authorization?:string){return {method:'POST',path,headers:authorization?{authorization}:{},body:Buffer.from(JSON.stringify(body),'utf8'),nowMs:Date.parse('2026-09-03T05:00:00Z')};}

function serviceStub(){
  return {
    upsertEmployee:vi.fn(async(record)=>record),
    upsertDevice:vi.fn(async(record)=>record),
    bindDevice:vi.fn(async(record)=>record),
    createJob:vi.fn(async(record)=>record),
  } as unknown as OperationalWorkService;
}

describe('PC01 Controller authenticated ingress',()=>{
  test('rejects work intake without the configured bearer credential',async()=>{
    const controller=new WorkforceControllerV1(pool,serviceStub(),TOKEN);
    const response=await controller.handle(request('/api/v1/work-orders',{idempotencyKey:'test-1',title:'test',objective:'test'}));
    expect(response.status).toBe(401);expect(response.body).toMatchObject({ok:false,error:{code:'INGRESS_AUTH_REQUIRED'}});
  });

  test('registers PC01 employee/device/binding without exposing the ingress token',async()=>{
    const service=serviceStub(),controller=new WorkforceControllerV1(pool,service,TOKEN);
    const fingerprint='a'.repeat(64),response=await controller.handle(request('/api/v1/pc01/register',{
      employeeId:'EMP-PC01-NATIVE',deviceId:'DEV-PC01',bindingId:'BIND-PC01-NATIVE',nodeId:'PC01',publicKeyFingerprint:fingerprint,publicKeyBase64:'PUBLIC_KEY_BASE64',capabilities:['local_ai','filesystem','evidence'],permissions:['local_ai:execute','workspace:read','evidence:write'],concurrencyLimit:4,
    },`Bearer ${TOKEN}`));
    expect(response.status).toBe(200);expect(response.body).toMatchObject({ok:true,employeeId:'EMP-PC01-NATIVE',deviceId:'DEV-PC01',bindingId:'BIND-PC01-NATIVE'});
    expect(service.upsertEmployee).toHaveBeenCalledTimes(1);expect(service.upsertDevice).toHaveBeenCalledTimes(1);expect(service.bindDevice).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response.body)).not.toContain(TOKEN);
  });

  test('creates a bounded PC01 work order with explicit idempotency and evidence policy',async()=>{
    const service=serviceStub(),controller=new WorkforceControllerV1(pool,service,TOKEN);
    const response=await controller.handle(request('/api/v1/work-orders',{
      idempotencyKey:'wo057-ingress-test',title:'PC01 intake',objective:'Return a resource snapshot',payload:{action:'resource_snapshot'},requiredCapabilities:['evidence'],requiredPermissions:['evidence:write'],allowedWorkerKinds:['pc01'],expectedEvidence:['json'],scopeKeys:['workspace/tigeriq'],maxAttempts:2,priority:'P1',
    },`Bearer ${TOKEN}`));
    expect(response.status).toBe(201);expect(response.body).toMatchObject({ok:true,workOrder:{idempotencyKey:'wo057-ingress-test',title:'PC01 intake',allowedWorkerKinds:['pc01'],expectedEvidence:['json'],scopeKeys:['workspace/tigeriq'],maxAttempts:2,priority:'P1'}});
    expect(service.createJob).toHaveBeenCalledTimes(1);
  });
});
