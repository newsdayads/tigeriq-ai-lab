// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_STATE_V2_CONTRACT_SHA,
  buildCompanyControlTowerViewModel,
  controlTowerTruthCheck,
  kpiHealthScore,
} from '../public/web-v1/company-control-tower-adapter.js';
import { MOCK_CONTROLLER_SNAPSHOT, MOCK_CONTROL_TOWER_PREVIEW } from '../public/web-v1/mock-data.js';

const CONTRACT_SHA = '3b8323b788f40a964d9415140aba2e7ac9e92870';

function liveSnapshot(extra: Record<string, unknown> = {}) {
  return {
    ...MOCK_CONTROLLER_SNAPSHOT,
    ...extra,
    source: { mode: 'controller', authoritative: true, label: 'PC01 Workforce Controller' },
    controller: { state: 'online' },
  };
}

describe('Company Control Tower Business State V2 adapter', () => {
  it('binds the read model to PR153 exact contract and keeps preview non-authoritative', () => {
    const vm = buildCompanyControlTowerViewModel(MOCK_CONTROLLER_SNAPSHOT, { previewBusiness: MOCK_CONTROL_TOWER_PREVIEW });
    expect(BUSINESS_STATE_V2_CONTRACT_SHA).toBe(CONTRACT_SHA);
    expect(vm.contract).toEqual(expect.objectContaining({ sourcePr: 153, exactSha: CONTRACT_SHA }));
    expect(vm.source).toEqual(expect.objectContaining({ mode: 'mock', authoritative: false, businessAvailable: true }));
    expect(vm.goals[0]).toEqual(expect.objectContaining({ goalId: 'GOAL-COMPANY-001', status: 'RUNNING', lifecycleSource: 'PR141_OPERATIONAL_GOAL', isMock: true }));
    expect(vm.signals[0]).toEqual(expect.objectContaining({ signalId: 'SIGNAL-MOCK-001', status: 'CONSUMED', isMock: true }));
    expect(vm.departments.find((row: any) => row.departmentId === 'DEP-RESEARCH')?.employeeCount).toBe(1);
    expect(vm.employees.find((row: any) => row.employeeId === 'EMP-CHIEF-001')).toEqual(expect.objectContaining({ businessRole: 'Chief of Staff AI', autonomyLevel: 'A2', isMock: true }));
    expect(vm.ownerActions[0]).toEqual(expect.objectContaining({ exceptionId: 'EXC-MOCK-001', status: 'AWAITING_OWNER', requiredOwnerAction: expect.stringContaining('Quyết định') }));
    expect(vm.outcomes[0].provenance[0]).toEqual(expect.objectContaining({ source_system: 'web-preview-mock' }));
    expect(() => controlTowerTruthCheck(vm)).not.toThrow();
  });

  it('derives KPI current value only from the newest observation and preserves provenance', () => {
    const preview = {
      ...MOCK_CONTROL_TOWER_PREVIEW,
      kpi_observations: [
        { observation_id:'OBS-OLD', kpi_id:'KPI-TOP3', value:1, observed_at:'2026-09-02T10:00:00+07:00', provenance:{source_system:'crm',source_ref:'crm://old',observed_at:'2026-09-02T10:00:00+07:00'}, evidence_refs:['EVIDENCE-OLD'] },
        ...MOCK_CONTROL_TOWER_PREVIEW.kpi_observations,
        { observation_id:'OBS-NEW', kpi_id:'KPI-TOP3', value:3, observed_at:'2026-09-02T17:00:00+07:00', provenance:{source_system:'crm',source_ref:'crm://new',observed_at:'2026-09-02T17:00:00+07:00'}, evidence_refs:['EVIDENCE-NEW'] },
      ],
    };
    const vm = buildCompanyControlTowerViewModel(MOCK_CONTROLLER_SNAPSHOT, { previewBusiness: preview });
    const kpi = vm.kpis.find((row: any) => row.kpiId === 'KPI-TOP3');
    expect(kpi).toEqual(expect.objectContaining({ currentValue:3, observationId:'OBS-NEW', evidenceRefs:['EVIDENCE-NEW'], healthPct:100, state:'ON_TRACK' }));
    expect(kpi.provenance).toEqual(expect.objectContaining({ source_system:'crm', source_ref:'crm://new' }));
  });

  it('accepts contract-shaped live projection, ignores preview, and does not accept legacy Web aliases', () => {
    const live = buildCompanyControlTowerViewModel(liveSnapshot({ businessStateV2: MOCK_CONTROL_TOWER_PREVIEW }), {
      previewBusiness: { goal_profiles:[{goal_id:'SHOULD-NOT-LEAK',title:'preview',owner_ref:'x',related_kpi_ids:[],updated_at:'2026-09-02T00:00:00Z'}] },
    });
    expect(live.source).toEqual(expect.objectContaining({ authoritative:true, businessAvailable:true }));
    expect(live.goals[0].goalId).toBe('GOAL-COMPANY-001');
    expect(live.goals.some((row:any)=>row.goalId==='SHOULD-NOT-LEAK')).toBe(false);
    expect(live.goals.every((row:any)=>row.isMock===false)).toBe(true);
    expect(() => controlTowerTruthCheck(live)).not.toThrow();

    const legacy = buildCompanyControlTowerViewModel(liveSnapshot({ businessState:{goals:[{goalId:'LEGACY-GOAL'}],missions:[{missionId:'LEGACY-MISSION'}]} }));
    expect(legacy.source.businessAvailable).toBe(false);
    expect(legacy.source.businessReason).toBe('BUSINESS_STATE_V2_PROJECTION_PENDING');
    expect(legacy.goals).toEqual([]);
  });

  it('keeps Mission to Job reference-only and leaves Job/Lease/Result/Evidence in Technical Operations', () => {
    const vm = buildCompanyControlTowerViewModel(MOCK_CONTROLLER_SNAPSHOT, { previewBusiness: MOCK_CONTROL_TOWER_PREVIEW });
    const mission = vm.missions.find((row:any)=>row.missionId==='COMPANY-001');
    expect(mission.jobRefs).toEqual([expect.objectContaining({jobId:'MOCK-JOB-RESEARCH',relation:'execution'}),expect.objectContaining({jobId:'MOCK-JOB-SCORING',relation:'verification'})]);
    expect(Object.keys(mission.jobRefs[0]).sort()).toEqual(['createdAt','jobId','relation']);
    expect(mission).not.toHaveProperty('stage');
    expect(mission).not.toHaveProperty('lease');
    expect(mission).not.toHaveProperty('result');
    expect(vm.technical.jobs.some((row:any)=>row.jobId==='MOCK-JOB-RESEARCH')).toBe(true);
    expect(vm.technical).toHaveProperty('leases');
    expect(vm.technical).toHaveProperty('results');
  });

  it('does not create shadow finance state when CRM/accounting projection is absent', () => {
    const vm = buildCompanyControlTowerViewModel(MOCK_CONTROLLER_SNAPSHOT,{previewBusiness:MOCK_CONTROL_TOWER_PREVIEW});
    expect(vm.performance.availability).toBe('unavailable');
    expect(vm.performance.metrics).toEqual(expect.arrayContaining([expect.objectContaining({key:'revenue',value:null,state:'NO_SOURCE'}),expect.objectContaining({key:'cost',value:null,state:'NO_SOURCE'})]));
    expect(vm.performance.note).toContain('không tạo shadow CRM/accounting');
  });

  it('keeps authoritative runtime live but business-empty when Business State V2 projection is missing', () => {
    const vm = buildCompanyControlTowerViewModel(liveSnapshot(),{previewBusiness:MOCK_CONTROL_TOWER_PREVIEW});
    expect(vm.source.authoritative).toBe(true);
    expect(vm.source.businessAvailable).toBe(false);
    expect(vm.source.businessReason).toBe('BUSINESS_STATE_V2_PROJECTION_PENDING');
    expect(vm.goals).toEqual([]); expect(vm.kpis).toEqual([]); expect(vm.signals).toEqual([]); expect(vm.missions).toEqual([]); expect(vm.ownerActions).toEqual([]); expect(vm.outcomes).toEqual([]);
  });

  it('only shows Trello coordination cards from an explicit read-only, provenance-bearing Controller projection', () => {
    const absent = buildCompanyControlTowerViewModel(MOCK_CONTROLLER_SNAPSHOT, { previewBusiness: MOCK_CONTROL_TOWER_PREVIEW });
    expect(absent.workCoordination).toEqual(expect.objectContaining({ available:false, reason:'NON_AUTHORITATIVE_SOURCE', cards:[] }));

    const live = buildCompanyControlTowerViewModel(liveSnapshot({
      workCoordination: {
        schemaVersion:'tigeriq.work-coordination.trello-readonly.v1', sourceSystem:'trello', readOnly:true,
        provenance:{source_system:'trello',source_ref:'trello://board/company',observed_at:'2026-09-02T10:00:00Z'},
        cards:[{cardId:'trello-1',title:'Chốt nhận diện thương hiệu',status:'in_progress',due_at:'2026-09-05T10:00:00Z',board_name:'Company',list_name:'Đang làm',members:['Sơn'],provenance:{source_system:'trello',source_ref:'trello://card/1'}}],
      },
    }));
    expect(live.workCoordination).toEqual(expect.objectContaining({ available:true, sourceSystem:'trello', readOnly:true }));
    expect(live.workCoordination.cards[0]).toEqual(expect.objectContaining({ cardId:'trello-1',title:'Chốt nhận diện thương hiệu' }));

    const rejected = buildCompanyControlTowerViewModel(liveSnapshot({ workCoordination:{ sourceSystem:'trello', readOnly:false, cards:live.workCoordination.cards } }));
    expect(rejected.workCoordination).toEqual(expect.objectContaining({ available:false, cards:[] }));
  });

  it('computes aggregate KPI health only from explicit read-model health values', () => {
    expect(kpiHealthScore([{healthPct:100},{healthPct:67},{healthPct:null}])).toBe(84);
    expect(kpiHealthScore([])).toBeNull();
  });
});
