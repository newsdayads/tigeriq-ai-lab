import { describe, expect, it } from 'vitest';
import { applyNativeSelfHealStateV5 } from '../apps/dashboard/src/server-v17.js';

describe('Web V5 native self-heal projection', () => {
  it('projects verified native tasks into System without touching OpenClaw', () => {
    const data:any={generatedAt:'x',works:[],people:[],systems:[
      {key:'worker',name:'Worker',status:'Chưa xác minh',tone:'unknown',note:'x'},
      {key:'planner',name:'Planner',status:'Chưa xác minh',tone:'unknown',note:'x'},
      {key:'supervisor',name:'Supervisor',status:'Chưa xác minh',tone:'unknown',note:'x'},
      {key:'openclaw',name:'OpenClaw',status:'Chưa xác minh',tone:'unknown',note:'x'},
    ],activeCount:0,waitingCount:0,blockedCount:0,doneCount:0,pausedCount:0,progressAverage:null,ownerActionRequired:false,ownerActionText:''};
    const out=applyNativeSelfHealStateV5(data,{result:'READY',runtimeMode:'NATIVE',updatedAt:'2026-09-08T12:00:00Z',nativeTasks:{'TigerIQ PC01 Native Worker':'Running','TigerIQ Autonomous Planner':'Running','TigerIQ Autonomy Supervisor V2':'Running'},nativePorts:{'8787':true,'8790':true}});
    expect(out.systems.find((x:any)=>x.key==='worker')?.tone).toBe('active');
    expect(out.systems.find((x:any)=>x.key==='planner')?.tone).toBe('active');
    expect(out.systems.find((x:any)=>x.key==='supervisor')?.tone).toBe('active');
    expect(out.systems.find((x:any)=>x.key==='openclaw')?.tone).toBe('unknown');
    const heal=out.systems.find((x:any)=>x.key==='self-heal');
    expect(heal?.tone).toBe('active'); expect(heal?.note).toContain('3/3');
  });
  it('does not downgrade fresh telemetry when native task map is absent', () => {
    const data:any={generatedAt:'x',works:[],people:[],systems:[
      {key:'control',name:'Controller',status:'Hoạt động',tone:'active',note:'Cổng 8790 phản hồi'},
      {key:'worker',name:'Worker',status:'Hoạt động',tone:'active',note:'1 tiến trình'},
      {key:'ollama',name:'Ollama',status:'Hoạt động',tone:'active',note:'4 mô hình'},
    ],activeCount:0,waitingCount:0,blockedCount:0,doneCount:0,pausedCount:0,progressAverage:null,ownerActionRequired:false,ownerActionText:''};
    const out=applyNativeSelfHealStateV5(data,{result:'FAILED',runtimeMode:'NATIVE',updatedAt:'2026-09-08T21:55:30Z',error:'NATIVE_RUNTIME_NOT_READY'});
    expect(out.systems.find((x:any)=>x.key==='control')?.tone).toBe('active');
    expect(out.systems.find((x:any)=>x.key==='worker')?.tone).toBe('active');
    expect(out.systems.find((x:any)=>x.key==='ollama')?.tone).toBe('active');
  });

});
