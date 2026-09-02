import { describe, expect, it } from 'vitest';
import { buildCompanyControlTowerViewModel, controlTowerTruthCheck, kpiHealthScore } from '../public/web-v1/company-control-tower-adapter.js';
import { MOCK_CONTROLLER_SNAPSHOT, MOCK_CONTROL_TOWER_PREVIEW } from '../public/web-v1/mock-data.js';

function liveSnapshot(extra = {}) {
  return {
    ...MOCK_CONTROLLER_SNAPSHOT,
    ...extra,
    source: { mode: 'controller', authoritative: true, label: 'PC01 Workforce Controller' },
    controller: { state: 'online' },
  };
}

describe('Company Control Tower preview adapter', () => {
  it('keeps mock preview explicitly non-authoritative', () => {
    const vm = buildCompanyControlTowerViewModel(MOCK_CONTROLLER_SNAPSHOT, { previewBusiness: MOCK_CONTROL_TOWER_PREVIEW });
    expect(vm.source.mode).toBe('mock');
    expect(vm.source.authoritative).toBe(false);
    expect(vm.source.businessAvailable).toBe(true);
    expect(vm.goals[0].goalId).toBe('GOAL-COMPANY-001');
    expect(vm.ownerActions[0].status).toBe('NEEDS_OWNER');
    expect(() => controlTowerTruthCheck(vm)).not.toThrow();
  });

  it('never injects preview business facts into an authoritative Controller snapshot', () => {
    const vm = buildCompanyControlTowerViewModel(liveSnapshot(), { previewBusiness: MOCK_CONTROL_TOWER_PREVIEW });
    expect(vm.source.authoritative).toBe(true);
    expect(vm.source.businessAvailable).toBe(false);
    expect(vm.source.businessReason).toBe('BUSINESS_CONTRACT_PENDING');
    expect(vm.goals).toEqual([]);
    expect(vm.kpis).toEqual([]);
    expect(vm.missions).toEqual([]);
    expect(vm.ownerActions).toEqual([]);
  });

  it('accepts optional business projection only when it actually arrives from the live snapshot', () => {
    const vm = buildCompanyControlTowerViewModel(liveSnapshot({
      businessState: {
        goals: [{ goalId: 'GOAL-LIVE-001', title: 'Live Goal' }],
        kpis: [{ kpiId: 'KPI-LIVE-001', healthPct: 80 }],
        performance: { availability: 'available', metrics: [{ label: 'Doanh thu', value: 1 }] },
        missions: [{ missionId: 'MISSION-LIVE-001' }],
        ownerActions: [], outcomes: [], processes: [],
      },
    }));
    expect(vm.source.authoritative).toBe(true);
    expect(vm.source.businessAvailable).toBe(true);
    expect(vm.goals[0].goalId).toBe('GOAL-LIVE-001');
    expect(vm.missions[0].missionId).toBe('MISSION-LIVE-001');
  });

  it('keeps Job/lease/provider/device details in technical projection', () => {
    const vm = buildCompanyControlTowerViewModel(MOCK_CONTROLLER_SNAPSHOT, { previewBusiness: MOCK_CONTROL_TOWER_PREVIEW });
    expect(vm.technical.jobs.length).toBeGreaterThan(0);
    expect(vm.technical.devices.length).toBeGreaterThan(0);
    expect(vm.technical.providers.length).toBeGreaterThan(0);
    expect(vm.technical).toHaveProperty('leases');
  });

  it('computes KPI health only from explicit KPI health values', () => {
    expect(kpiHealthScore([{ healthPct: 80 }, { healthPct: 60 }, { healthPct: null }])).toBe(70);
    expect(kpiHealthScore([])).toBeNull();
  });
});
