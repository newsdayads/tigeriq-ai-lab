import { describe, expect, it } from 'vitest';
import { applyNativeSelfHealStateV5 } from '../apps/dashboard/src/server-v17.js';

describe('Web V5 native self-heal projection', () => {
  it('projects verified native tasks into System without touching OpenClaw', () => {
    const data:any={generatedAt:'x',works:[],people:[],systems:[
      {key:'worker',name:'Worker',status:'Chưa xác minh',tone:'unknown',note:'x'},
      {key:'planner',name:'Planner',status:'Chưa xác minh',tone:'unknown',note:'x'},
      {key:'openclaw',name:'OpenClaw',status:'Chưa xác minh',tone:'unknown',note:'x'},
    ],activeCount:0,waitingCount:0,blockedCount:0,doneCount:0,pausedCount:0,progressAverage:null,ownerActionRequired:false,ownerActionText:''};
    const out=applyNativeSelfHealStateV5(data,{result:'READY',runtimeMode:'NATIVE',updatedAt:'2026-09-08T12:00:00Z',nativeTasks:{'TigerIQ PC01 Native Worker':'Running','TigerIQ Autonomous Planner':'Running'},nativePorts:{'8787':true,'8790':true}});
    expect(out.systems.find((x:any)=>x.key==='worker')?.tone).toBe('active');
    expect(out.systems.find((x:any)=>x.key==='planner')?.tone).toBe('active');
    expect(out.systems.find((x:any)=>x.key==='openclaw')?.tone).toBe('unknown');
    const heal=out.systems.find((x:any)=>x.key==='self-heal');
    expect(heal?.tone).toBe('active'); expect(heal?.note).toContain('2/2');
  });
});
