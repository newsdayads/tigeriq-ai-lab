import { describe,expect,test } from 'vitest';
import { containsHumanAuthBlock,parseOpenClawJson } from '../apps/nv06-openclaw-worker/src/openclaw.js';
import { NV06_CAPABILITIES,NV06_EMPLOYEE_ID,NV06_PERMISSIONS } from '../apps/nv06-openclaw-worker/src/types.js';

describe('NV06 OpenClaw worker contract',()=>{
  test('declares a single-role browser worker identity and capability',()=>{
    expect(NV06_EMPLOYEE_ID).toBe('EMP-NV06-OPENCLAW');
    expect(NV06_CAPABILITIES).toContain('browser.chatgpt');
    expect(NV06_CAPABILITIES).toContain('continuity.signal');
    expect(NV06_PERMISSIONS).toEqual(['browser:execute','evidence:write']);
  });
  test('parses clean and prefixed OpenClaw JSON output',()=>{
    expect(parseOpenClawJson('{"status":"ok"}')).toEqual({status:'ok'});
    expect(parseOpenClawJson('notice\n{"status":"ok","result":{"payloads":[]}}\n')).toMatchObject({status:'ok'});
  });
  test('fails closed on human-verification signals',()=>{
    expect(containsHumanAuthBlock('Please verify you are human')).toBe(true);
    expect(containsHumanAuthBlock('CAPTCHA challenge')).toBe(true);
    expect(containsHumanAuthBlock('normal ChatGPT response')).toBe(false);
  });
});
