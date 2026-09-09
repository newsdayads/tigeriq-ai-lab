import { describe, expect, test } from 'vitest';
import { normalizeControllerRuntimeTruth } from '../apps/dashboard/src/runtime-truth-client.js';

describe('Web runtime truth adapter',()=>{
  test('maps controller runtime-truth-v1 without shell telemetry',()=>{
    const telemetry=normalizeControllerRuntimeTruth({ok:true,source:'workforce-controller-v1',protocol:'runtime-truth-v1',generatedAt:'2026-09-09T05:00:00Z',staleAfterMs:45000,postgres:true,queue:{queued:1,activeLeases:1,stageCounts:{queued:1,leased:1,done:7,failed:2}},pc01:{employeeId:'EMP-PC01-NATIVE',deviceId:'DEV-PC01',health:'ok',heartbeatAt:'2026-09-09T04:59:59Z',online:true,metadata:{pid:4321,processUptimeSeconds:90,model:'qwen3:4b',resources:{cpuPercent:25,totalRamBytes:1000,freeRamBytes:400},ollama:{ok:true,model:'qwen3:4b'}}},employees:[{employeeId:'EMP-PC01-NATIVE',displayName:'PC01 Native Worker',roles:['pc01-native-worker'],concurrencyLimit:4,deviceId:'DEV-PC01',health:'ok',online:true}],providers:[{providerId:'GROQ',provider:'groq',model:'gpt-oss',state:'active',lastHeartbeatAt:'2026-09-09T04:59:59Z',stale:false}],jobs:[{jobId:'J1',objective:'test',stage:'leased',priority:'P0',targetEmployeeId:'EMP-PC01-NATIVE'}],leases:[{jobId:'J1',employeeId:'EMP-PC01-NATIVE'}]},'http://100.97.23.87:8790');
    expect(telemetry).toMatchObject({available:true,truthSource:'workforce-controller-v1',worker:{online:true,pid:4321},controller:{online:true,queuedJobs:1,activeLeases:1},jobStages:{queued:1,leased:1,done:7,failed:2},postgresql:{online:true},ollama:{online:true}});
    expect(telemetry.providers?.[0]).toMatchObject({provider:'groq',state:'active',stale:false});
    expect(telemetry.workforce?.taskList?.[0]).toMatchObject({taskId:'J1',stage:'leased',assignedEmployeeId:'EMP-PC01-NATIVE'});
  });
});
