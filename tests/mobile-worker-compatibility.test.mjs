import { describe, expect, it } from 'vitest';
import {
  LIVE_WORKER_MIN_VERSION,
  enqueueFreshLiveMobileTask,
  isLiveWorkerCompatible,
  selectCompatibleLiveWorker,
} from '../apps/tigeriq-core/mobile-worker-api.mjs';

describe('mobile worker compatibility routing', () => {
  it('accepts current and future compatible OTA versions', () => {
    expect(LIVE_WORKER_MIN_VERSION).toBe('0.22.0');
    expect(isLiveWorkerCompatible({
      agentVersion:'0.22.0-live-worker',
      capabilities:['android-ui','chatgpt-ui'],
    })).toBe(true);
    expect(isLiveWorkerCompatible({
      agentVersion:'0.24.0-pause-resume',
      capabilities:['android-ui','chatgpt-ui'],
    })).toBe(true);
    expect(isLiveWorkerCompatible({
      agentVersion:'0.30.1-next',
      capabilities:['android-ui','gemini-ui'],
    })).toBe(true);
  });

  it('rejects unsupported or incapable workers', () => {
    expect(isLiveWorkerCompatible({
      agentVersion:'0.21.0-packageinstaller-stream-fix',
      capabilities:['android-ui','chatgpt-ui'],
    })).toBe(false);
    expect(isLiveWorkerCompatible({
      agentVersion:'0.24.0-pause-resume',
      capabilities:['android-ui'],
    })).toBe(false);
    expect(isLiveWorkerCompatible({
      agentVersion:'garbage',
      capabilities:['android-ui','chatgpt-ui'],
    })).toBe(false);
  });

  it('selects the freshest compatible worker from ordered candidates', () => {
    const selected=selectCompatibleLiveWorker([
      {node_id:'new-but-incapable',agent_version:'0.24.0-pause-resume',capabilities:['android-ui']},
      {node_id:'v024',agent_version:'0.24.0-pause-resume',capabilities:['android-ui','chatgpt-ui']},
      {node_id:'v022',agent_version:'0.22.0-live-worker',capabilities:['android-ui','chatgpt-ui']},
    ]);
    expect(selected?.node_id).toBe('v024');
  });

  it('enqueue accepts v0.24 without exact-version equality', async () => {
    const calls=[];
    const db={
      async query(sql,args=[]){
        calls.push({sql,args});
        if(sql.includes('where idempotency_key=$1'))return {rows:[]};
        if(sql.includes('from tigeriq_mobile_devices'))return {rows:[{
          node_id:'PHONE-V024',
          employee_id:'NV102',
          provider:'ChatGPT',
          agent_version:'0.24.0-pause-resume',
          capabilities:['android-ui','research','chatgpt-ui'],
          last_seen_at:'2026-10-05T13:00:00.000Z',
        }]};
        if(sql.includes('insert into tigeriq_mobile_tasks'))return {rows:[]};
        throw new Error('unexpected query');
      },
    };
    const result=await enqueueFreshLiveMobileTask(db,{
      idempotencyKey:'compat-v024',
      prompt:'test',
      expectedToken:'TIGERIQ_MOBILE_DONE_1234567890ABCDEF',
      now:new Date('2026-10-05T13:00:30.000Z'),
    });
    expect(result.employeeId).toBe('NV102');
    expect(result.nodeId).toBe('PHONE-V024');
    const candidateCall=calls.find(call=>call.sql.includes('from tigeriq_mobile_devices'));
    expect(candidateCall.args).toHaveLength(1);
    expect(candidateCall.sql).not.toContain('agent_version=$');
  });
});
