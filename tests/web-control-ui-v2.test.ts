import { describe,expect,it } from 'vitest';
import { renderWebControlCenter } from '../apps/web-control/src/render.js';
import type { WebControlSnapshot } from '../apps/web-control/src/core.js';

const data:WebControlSnapshot={
  version:1,generatedAt:new Date().toISOString(),
  goals:{queued:2,running:1,waitingAuthorization:1,blocked:0,done:5,failed:0},
  goalRows:[{goalId:'G1',stage:'running',missionId:'mission-G1'}],
  tasks:{queued:3,running:2,review:1,authorization:1,blocked:0,done:8,failed:0},
  taskRows:[{taskId:'mission-G1-code',goalId:'G1',stage:'running',priority:'P0',dependencies:[],modelId:'qwen3:8b',attempts:1}],
  workers:{total:3,busy:2,online:1,waiting:0,offline:0,failed:0},
  workerRows:[{workerId:'runtime.autonomous-planner',employeeId:'NV01',providerId:'ollama',modelId:'qwen3:8b',status:'busy',currentTaskId:'mission-G1-code',lastSeenAt:new Date().toISOString()}],
  providers:[{providerId:'ollama',enabled:true,healthy:true,kind:'local',costClass:'free',maxConcurrency:2,latencyMs:20}],
  employees:[{employeeId:'NV01',role:'coder',enabled:true}],
  authorization:{goalIds:['G-AUTH'],taskIds:[]},
  evidence:{subjects:4,judgePass:3,judgePending:1}
};

describe('Web Control UI V2 contract',()=>{
  it('renders dense command-center navigation, health, progress and mobile controls',()=>{
    const html=renderWebControlCenter(data);
    for(const text of ['WEB CONTROL CENTER','System Health','PC01 Runtime','AI Workforce','Live Queue','Provider / API Center','Authorization Center','Evidence & Results','Massive AI Workflow','mobile-nav','Owner Gates','Queue Load'])expect(html).toContain(text);
    expect(html).toContain('brand-logo');
    expect(html).toContain('nav-icon');
    expect(html).toContain('meter');
    expect(html).toContain('qwen3:8b');
  });
});
