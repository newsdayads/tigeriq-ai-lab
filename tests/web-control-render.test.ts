import { describe,expect,it } from 'vitest';
import { renderWebControlCenter } from '../apps/web-control/src/render.js';
import type { WebControlSnapshot } from '../apps/web-control/src/core.js';

function snapshot():WebControlSnapshot{return {
  version:1,generatedAt:new Date().toISOString(),
  goals:{queued:2,running:1,waitingAuthorization:1,blocked:0,done:5,failed:0},
  goalRows:[{goalId:'G1',stage:'running',missionId:'OPS-G1'}],
  tasks:{queued:4,running:2,review:1,authorization:1,blocked:0,done:8,failed:0},
  taskRows:[{taskId:'T1',goalId:'G1',stage:'running',priority:'P0',dependencies:[],modelId:'qwen3:8b',attempts:1}],
  workers:{total:2,busy:1,online:1,waiting:0,offline:0,failed:0},
  workerRows:[{workerId:'W1',employeeId:'coder-01',providerId:'ollama',modelId:'qwen3:8b',status:'busy',currentTaskId:'T1'}],
  providers:[{providerId:'ollama',enabled:true,healthy:true,kind:'local',costClass:'free',maxConcurrency:2,latencyMs:120}],
  employees:[{employeeId:'coder-01',role:'coder',enabled:true}],
  authorization:{goalIds:['G-AUTH'],taskIds:['T-AUTH']},
  evidence:{subjects:4,judgePass:3,judgePending:1}
};}

describe('Web Control Center renderer',()=>{
  it('renders the approved operational surfaces from snapshot data',()=>{
    const html=renderWebControlCenter(snapshot());
    for(const text of ['WEB CONTROL CENTER','AI Workforce','Task Graph','Live Queue','Provider / API Center','Authorization Center','Evidence & Results','Massive AI Workflow','qwen3:8b','G-AUTH','T-AUTH'])expect(html).toContain(text);
    expect(html).toContain('PC01 = SOURCE + RUNTIME');
    expect(html).toContain('NO DAILY PHONE VPN');
  });

  it('shows unavailable state instead of inventing AI data',()=>{
    const html=renderWebControlCenter(null);
    expect(html).toContain('chưa có snapshot runtime PC01');
    expect(html).toContain('Chưa có AI Worker runtime');
    expect(html).toContain('Chưa có provider runtime');
    expect(html).not.toContain('GPT-5');
    expect(html).not.toContain('Claude Sonnet');
  });

  it('escapes runtime data before rendering into HTML',()=>{
    const data=snapshot();
    data.workerRows=[{workerId:'<script>alert(1)</script>',employeeId:'evil<img src=x onerror=1>',status:'busy'}];
    const html=renderWebControlCenter(data);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=1>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
