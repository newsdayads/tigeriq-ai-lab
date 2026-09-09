import { describe,expect,test } from 'vitest';
import { containsHumanAuthBlock,openClawSpawn,parseOpenClawJson } from '../apps/nv06-openclaw-worker/src/openclaw.js';
import { NV06_CAPABILITIES,NV06_EMPLOYEE_ID,NV06_PERMISSIONS } from '../apps/nv06-openclaw-worker/src/types.js';

describe('NV06 OpenClaw worker contract',()=>{
  test('declares a single-role browser worker identity and capability',()=>{
    expect(NV06_EMPLOYEE_ID).toBe('EMP-NV06-OPENCLAW');
    expect(NV06_CAPABILITIES).toContain('browser.chatgpt');
    expect(NV06_CAPABILITIES).toContain('continuity.signal');
    expect(NV06_PERMISSIONS).toEqual(['browser:execute','evidence:write']);
  });
  test('builds a shell-free OpenClaw Node invocation',()=>{
    const run=openClawSpawn('D:\\OpenClaw\\npm-global\\openclaw.cmd','agent:main:test','D:\\TigerIQ\\Temp\\message.txt',90);
    expect(run.command).toBe(process.execPath);
    expect(run.args[0]).toBe('D:\\OpenClaw\\npm-global\\node_modules\\openclaw\\openclaw.mjs');
    expect(run.args).toContain('agent:main:test');
    expect(run.args).toContain('D:\\TigerIQ\\Temp\\message.txt');
    expect(run.args).not.toContain('/c');
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