import { describe, expect, test } from 'vitest';
import { LiveEventBufferV5, RuntimeLiveEventProjectionV5 } from '../apps/dashboard/src/live-events-v5.js';
import { mergeRuntimeWorkTruthV5, type ExecutiveDashboardV4, type ExecutiveWorkV4 } from '../apps/dashboard/src/executive-data-v4.js';
import type { ServerTelemetry } from '../apps/dashboard/src/server.js';

const base:ExecutiveDashboardV4={generatedAt:'2026-09-09T05:00:00Z',works:[],people:[],systems:[{key:'control',name:'Controller',status:'Hoạt động',tone:'active',note:'runtime truth'}],activeCount:0,waitingCount:0,blockedCount:0,doneCount:0,pausedCount:0,progressAverage:null,ownerActionRequired:false,ownerActionText:'Không'};
function telemetry(task:Record<string,unknown>,heartbeat='2026-09-09T04:59:59Z'):ServerTelemetry{return {available:true,server:'PC01',generatedAt:'2026-09-09T05:00:00Z',cpu:null,memory:null,uptimeSeconds:1,disk:null,worker:{online:true,pid:1,instances:1},controller:{online:true,ip:'127.0.0.1',port:8790,protocol:'runtime-truth-v1'},workforce:{employeesTotal:1,idle:0,busy:1,offline:0,degraded:0,activeTasks:1,tasksActive:1,tasksFailed:0,roster:[{employeeId:'EMP-PC01-NATIVE',displayName:'PC01 Native Worker',department:'Runtime',role:'worker',nodeId:'DEV-PC01',provider:null,model:null,availability:'busy',healthScore:100,concurrencyLimit:1,activeTaskCount:1,currentTaskIds:['J1'],lastHeartbeatAt:heartbeat,stale:false} as never],taskList:[{taskId:'J1',objective:'DO NOT LEAK D:\\secret\\token.txt',stage:'leased',priority:'P0',assignedEmployeeId:'EMP-PC01-NATIVE',leaseId:'L1',leaseEmployeeId:'EMP-PC01-NATIVE',leasedAt:'2026-09-09T04:59:56Z',workerHeartbeatAt:heartbeat,workerOnline:true,workerStale:false,sourceRef:'runtime-truth-v1:job:J1',createdAt:'2026-09-09T04:59:00Z',updatedAt:'2026-09-09T04:59:58Z',...task} as never]},postgresql:{online:true,service:'runtime',port:5432},ollama:null,tailscale:null,gpu:null,truthSource:'workforce-controller-v1',staleAfterMs:45000,jobStages:{leased:1},providers:[]};}

describe('Web V5 runtime live projection',()=>{
  test('orders claimed -> started, dedupes, heartbeats, steps and terminal events from lease/heartbeat truth',()=>{
    let current=telemetry({});
    const projection=new RuntimeLiveEventProjectionV5(()=>current),buffer=new LiveEventBufferV5(50);
    const first=buffer.append(projection.ingest(base,Date.parse('2026-09-09T05:00:00Z')));
    expect(first.filter(row=>row.entity_type==='work').map(row=>row.event_type)).toEqual(['work.claimed','work.started']);
    expect(first[0]).toMatchObject({correlation_key:'J1',evidence_ref:'runtime-truth-v1:job:J1',worker_id:'EMP-PC01-NATIVE',stale:false});
    expect(JSON.stringify(first)).not.toContain('secret');
    expect(buffer.append(projection.ingest(base,Date.parse('2026-09-09T05:00:01Z')))).toHaveLength(0);

    current=telemetry({workerHeartbeatAt:'2026-09-09T05:00:10Z',updatedAt:'2026-09-09T05:00:10Z'},'2026-09-09T05:00:10Z');
    expect(buffer.append(projection.ingest({...base,generatedAt:'2026-09-09T05:00:10Z'},Date.parse('2026-09-09T05:00:10Z'))).some(row=>row.event_type==='work.heartbeat')).toBe(true);

    current=telemetry({stage:'reviewing',updatedAt:'2026-09-09T05:00:12Z',workerHeartbeatAt:'2026-09-09T05:00:12Z'},'2026-09-09T05:00:12Z');
    expect(buffer.append(projection.ingest({...base,generatedAt:'2026-09-09T05:00:12Z'},Date.parse('2026-09-09T05:00:12Z'))).some(row=>row.event_type==='work.step')).toBe(true);

    current=telemetry({stage:'failed',leaseId:null,workerOnline:false,workerStale:true,lastFailureCode:'TEST_FAIL',updatedAt:'2026-09-09T05:00:15Z'});
    expect(buffer.append(projection.ingest({...base,generatedAt:'2026-09-09T05:00:15Z'},Date.parse('2026-09-09T05:00:15Z'))).some(row=>row.event_type==='work.failed')).toBe(true);

    current=telemetry({stage:'done',leaseId:null,workerOnline:false,workerStale:true,updatedAt:'2026-09-09T05:00:20Z'});
    expect(buffer.append(projection.ingest({...base,generatedAt:'2026-09-09T05:00:20Z'},Date.parse('2026-09-09T05:00:20Z'))).some(row=>row.event_type==='work.completed')).toBe(true);
    const last=buffer.lastEventId();expect(last).toBeTruthy();expect(buffer.since(last!)).toEqual([]);
  });

  test('marks active leased work stale only after real worker heartbeat exceeds threshold',()=>{
    const current=telemetry({workerHeartbeatAt:'2026-09-09T04:59:00Z'},'2026-09-09T04:59:00Z');
    const projection=new RuntimeLiveEventProjectionV5(()=>current);
    const rows=projection.ingest(base,Date.parse('2026-09-09T05:00:00Z'));
    const blocked=rows.find(row=>row.event_type==='work.blocked');
    expect(blocked).toMatchObject({stale:true,correlation_key:'J1'});
    expect(blocked?.last_activity_age_ms).toBe(60000);
  });

  test('never projects GitHub governance or leased stage as active without both lease and fresh heartbeat',()=>{
    const now=Date.parse('2026-09-09T05:00:00Z');
    const governance:ExecutiveWorkV4[]=[{number:508,title:'GitHub says active',ownerCode:'NV01',owner:'Minh (NV01)',progressPercent:null,progressLabel:'—',status:'Đang làm',tone:'active',next:'runtime proof',updated:'—',workId:'GH-508'}];
    const noRuntime=telemetry({});
    noRuntime.workforce={...noRuntime.workforce!,activeTasks:0,tasksActive:0,taskList:[]};
    expect(mergeRuntimeWorkTruthV5(governance,noRuntime,now)[0].tone).toBe('waiting');

    const noLease=telemetry({leaseId:null,leaseEmployeeId:null});
    expect(mergeRuntimeWorkTruthV5([],noLease,now)[0]).toMatchObject({workId:'J1',tone:'waiting'});

    const fresh=telemetry({});
    expect(mergeRuntimeWorkTruthV5([],fresh,now)[0]).toMatchObject({workId:'J1',tone:'active',evidenceRef:'runtime-truth-v1:job:J1'});

    const stale=telemetry({workerHeartbeatAt:'2026-09-09T04:59:00Z'},'2026-09-09T04:59:00Z');
    expect(mergeRuntimeWorkTruthV5([],stale,now)[0]).toMatchObject({workId:'J1',tone:'stale'});
  });
});
