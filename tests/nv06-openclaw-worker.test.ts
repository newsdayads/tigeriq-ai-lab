import { describe,expect,test } from 'vitest';
import { extractAssistantResult } from '../apps/nv06-openclaw-worker/src/browser-executor.js';

describe('NV06 OpenClaw browser result extraction',()=>{
  test('extracts the final ChatGPT response carrying the job marker',()=>{
    const marker='TIGERIQ_JOB_DONE_JOB_1_123';
    const snapshot=['- heading "Bạn đã nói:" [level=4]','  - generic: task '+marker,'- heading "ChatGPT đã nói:" [level=4]','  - generic:','    - paragraph: {"answer":"done"}','    - paragraph: '+marker].join('\n');
    const result=extractAssistantResult(snapshot,marker);
    expect(result).toContain('{"answer":"done"}');
    expect(result).toContain(marker);
  });
});
