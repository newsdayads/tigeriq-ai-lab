import { describe, it, expect } from 'vitest';
import { completeRoster, parseRegistryBody, workforceSnapshot, resetWorkforceRegistryForTests } from '../apps/tigeriq-core/workforce-registry.mjs';

describe('NV07 canonical registration and safe offline fallback',()=>{
  it('retains NV05 retirement and provisions NV07 without runtime claims',()=>{
    resetWorkforceRegistryForTests();
    const state=workforceSnapshot();
    expect(state.workforce.find(x=>x.employee_id==='NV05')).toMatchObject({retired:true,assigned:false});
    const nv07=state.workforce.find(x=>x.employee_id==='NV07');
    expect(nv07).toMatchObject({name:'Google Antigravity',retired:false,assigned:true});
    expect(nv07.admin_state).toContain('NOT_YET_ROUTABLE');
    expect(nv07.admin_state).not.toContain('ACTIVE_CORE_RESOURCE');
    expect(state.workforceMeta.stale).toBe(true);
  });
  it('historical NV07 RETIRED text cannot override present registration',()=>{
    const source=[
      'REGISTRY_ROOT_VERSION=57',
      '| Mã | Tên | Trạng thái |',
      '|---|---|---|',
      '| `NV07` | Google Antigravity | `ADMIN_ENABLED / PROVISIONING / NOT_YET_ROUTABLE` |',
      '`5`,`7` RETIRED (historical)',
    ].join(String.fromCharCode(10));
    const out=parseRegistryBody(source);
    expect(out.version).toBe('57');
    expect(out.workforce.find(x=>x.employee_id==='NV07')).toMatchObject({name:'Google Antigravity',retired:false,assigned:true});
    expect(out.workforce.find(x=>x.employee_id==='NV05')).toMatchObject({retired:true});
  });
  it('unknown NV07 remains unassigned if not in dynamic registry or fallback map',()=>{
    const a=new Map([['NV00',{employee_id:'NV00',name:'Vy',admin_state:'OWNER'}]]);
    const r=completeRoster(a,new Set(['NV05']));
    expect(r.find(x=>x.employee_id==='NV07')).toMatchObject({assigned:false,retired:false,admin_state:'UNASSIGNED'});
  });
});
