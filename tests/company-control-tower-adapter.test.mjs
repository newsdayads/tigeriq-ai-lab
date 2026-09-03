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

describe('Company Control Tower adapter compatibility boundary', () => {
  it('keeps mock preview explicitly non-authoritative and CẦN SẾP fail-closed', () => {
    const vm = buildCompanyControlTowerViewModel(MOCK_CONTROLLER_SNAPSHOT, { previewBusiness: MOCK_CONTROL_TOWER_PREVIEW });
    expect(vm.source.mode).toBe('mock');
    expect(vm.source.authoritative).toBe(false);
    expect(vm.source.businessAvailable).toBe(true);
    expect(vm.goals[0].goalId).toBe('GOAL-COMPANY-001');
    expect(vm.ownerActions[0].status).toBe('AWAITING_OWNER');
    expect(vm.ownerActions[0].authorizationState).toBe('BLOCKED_PENDING_OWNER_DECISION');
    expect(() => controlTowerTruthCheck(vm)).not.toThrow();
  });

  it('never injects preview business facts into an authoritative Controller snapshot', () => {
    const vm = buildCompanyControlTowerViewModel(liveSnapshot(), { previewBusiness: MOCK_CONTROL_TOWER_PREVIEW });
    expect(vm.source.authoritative).toBe(true);
    expect(vm.source.businessAvailable).toBe(false);
    expect(vm.source.businessReason).toBe('BUSINESS_STATE_V2_PROJECTION_PENDING');
    expect(vm.goals).toEqual([]);
    expect(vm.kpis).toEqual([]);
    expect(vm.missions).toEqual([]);
    expect(vm.ownerActions).toEqual([]);
  });

  it('accepts only contract-shaped Business State V2 live projection and rejects legacy aliases', () => {
    const vm = buildCompanyControlTowerViewModel(liveSnapshot({ businessStateV2: MOCK_CONTROL_TOWER_PREVIEW }));
    expect(vm.source.authoritative).toBe(true);
    expect(vm.source.businessAvailable).toBe(true);
    expect(vm.goals[0].goalId).toBe('GOAL-COMPANY-001');
    expect(vm.missions[0].missionId).toBe('COMPANY-001');

    const legacy = buildCompanyControlTowerViewModel(liveSnapshot({
      businessState: {
        goals: [{ goalId: 'GOAL-LIVE-LEGACY' }],
        missions: [{ missionId: 'MISSION-LIVE-LEGACY' }],
      },
    }));
    expect(legacy.source.businessAvailable).toBe(false);
    expect(legacy.source.businessReason).toBe('BUSINESS_STATE_V2_PROJECTION_PENDING');
    expect(legacy.goals).toEqual([]);
    expect(legacy.missions).toEqual([]);
  });

  it('keeps removed external workboard fail-closed even if legacy payload exists', () => {
    const vm = buildCompanyControlTowerViewModel(liveSnapshot({
      workCoordination: { sourceSystem: 'trello', readOnly: true, cards: [{ cardId: 'legacy' }] },
    }));
    expect(vm.workCoordination).toEqual(expect.objectContaining({
      available: false,
      reason: 'EXTERNAL_WORKBOARD_REMOVED_BY_OWNER_DECISION',
      sourceSystem: null,
      cards: [],
    }));
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
