import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {completeRoster,parseRegistryBody} from '../apps/tigeriq-core/workforce-registry.mjs';

describe('#1600 full API Health workforce roster',()=>{
  it('keeps all canonical slots NV00 through NV20, including retired slots',()=>{
    const assignments=new Map([
      ['NV00',{employee_id:'NV00',name:'Vy (Trợ lý)',admin_state:'CHIEF_OF_STAFF / PRIMARY_UI / OWNER_INTERFACE'}],
      ['NV09',{employee_id:'NV09',name:'Qwen3-Coder Local',admin_state:'IDLE_ON_DEMAND / LOCAL_OLLAMA_11434'}],
    ]);
    const roster=completeRoster(assignments,new Set(['NV05','NV07','NV08']));
    expect(roster).toHaveLength(21);
    expect(roster[0]).toMatchObject({employee_id:'NV00',name:'Vy (Trợ lý)',assigned:true});
    expect(roster[9]).toMatchObject({employee_id:'NV09',name:'Qwen3-Coder Local',assigned:true});
    expect(roster.find(x=>x.employee_id==='NV05')).toMatchObject({retired:true,admin_state:'RETIRED'});
    expect(roster.at(-1)?.employee_id).toBe('NV20');
  });

  it('parses NV00 from Registry #335 instead of dropping it',()=>{
    const parsed=parseRegistryBody([
      'REGISTRY_ROOT_VERSION=52',
      '| mã | tên chuẩn | trạng thái quản trị |',
      '|---|---|---|',
      '| `NV00` | Vy (Trợ lý) | `CHIEF_OF_STAFF / PRIMARY_UI / OWNER_INTERFACE` |',
      '| `NV09` | Qwen3-Coder Local | `PROVISIONING / LOCAL_CODER / IDLE_ON_DEMAND_AFTER_PASS` |',
      '5,7,8 RETIRED'
    ].join('\n'));
    expect(parsed.version).toBe('52');
    expect(parsed.workforce.find(x=>x.employee_id==='NV00')?.name).toBe('Vy (Trợ lý)');
    expect(parsed.workforce.find(x=>x.employee_id==='NV09')?.name).toBe('Qwen3-Coder Local');
  });

  it('exposes workforce in Core status and renders full roster filters in API Health',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    const dashboard=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
    expect(core).toContain("refreshRegistryWorkforce, normalizeRuntimeResources");
    expect(core).toContain("const {workforce,workforceMeta}=await refreshRegistryWorkforce()");
    expect(core).toContain("resources:rr,workforce,workforceMeta");
    expect(dashboard).toContain('NV00→NV20 theo Registry #335');
    expect(dashboard).toContain("function mergeWorkforce(workforce,resources)");
    expect(dashboard).toContain("data-filter=\"manual\">UI/Manual");
    expect(dashboard).toContain("id==='NV09'?'ollama'");
    expect(dashboard).toContain("qwen3-coder:30b");
    expect(dashboard).toContain("RETIRED:'ĐÃ NGỪNG'");
    expect(dashboard).toContain("function shortRole(x)");
    expect(dashboard).toContain("Gateway ONLINE");
    expect(dashboard).toContain("WORKER TẠM DỪNG");
    expect(dashboard).toContain("Registry #335");
    expect(dashboard).toContain("if(!x.live_resource)");
    expect(dashboard).not.toContain("Registry: ${esc(x.admin_state)}");
  });
});
