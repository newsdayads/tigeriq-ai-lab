import {describe,it,expect} from 'vitest';
import {sortBacklogSpecs} from '../apps/tigeriq-core/github-backlog-policy.mjs';

const work=(number,priority,scopeLease,extra={})=>({
  number,priority,sourcePriority:priority,
  scopeLease:{resourceScope:scopeLease,paths:[],ambiguous:false},
  ...extra,
});

describe('Owner 2026-10-14 canonical coding workstream priority',()=>{
  it('dispatches safe provider source repair ahead of optional evaluation within P1',()=>{
    const rows=[
      work(4532,'P1','TIGERIQ_CLINE_NV02_SOURCE_AND_EVAL_V1'),
      work(4625,'P1','DEXCAM_PERSONAL_GH4625_SOURCE_AND_BUILD'),
      work(4696,'P1','API_DOCTOR_SOURCE_REPAIR_NV20_NVIDIA'),
      work(4756,'P1','API_DOCTOR_SOURCE_REPAIR_NV19_COHERE'),
    ];
    expect(sortBacklogSpecs(rows).map(x=>x.number)).toEqual([4696,4756,4532,4625]);
  });
  it('never overrides true priority, current lease, dependency or capability gates',()=>{
    const rows=[
      work(2293,'P2','API_DOCTOR_SOURCE_REPAIR_OTHER'),
      work(4625,'P1','DEXCAM_PERSONAL_GH4625_SOURCE_AND_BUILD'),
      work(4696,'P1','API_DOCTOR_SOURCE_REPAIR_NV20_NVIDIA',{dependencySatisfied:false}),
      work(4532,'P1','TIGERIQ_CLINE_NV02_SOURCE_AND_EVAL_V1',{activeLeaseValid:true}),
      work(4756,'P1','API_DOCTOR_SOURCE_REPAIR_NV19_COHERE'),
    ];
    expect(sortBacklogSpecs(rows).map(x=>x.number)).toEqual([4532,4756,4625,4696,2293]);
  });
  it('keeps unknown workstreams and same-priority ranks deterministic',()=>{
    const rows=[
      work(4756,'P1','GENERIC_WORK'),
      work(4696,'P1','GENERIC_WORK'),
    ];
    expect(sortBacklogSpecs(rows).map(x=>x.number)).toEqual([4696,4756]);
  });
});
