import { describe,expect,it } from 'vitest';
import { eligible } from '../apps/autonomous-planner/src/github-queue-sync.js';

describe('NV02 GitHub queue source',()=>{
  const issue=(number:number,title:string,extra:Record<string,unknown>={})=>({number,title,body:'body',html_url:`https://github.com/x/y/issues/${number}`,...extra});
  it('accepts safe NV02 work',()=>{
    expect(eligible(issue(362,'[P0][NV02][FIX PLAN] Controller health probe'))).toBe(true);
    expect(eligible(issue(458,'[P0][PERF][NV02] HOT STATE fast-start'))).toBe(true);
  });
  it('rejects deployment/security/web lanes and PRs',()=>{
    expect(eligible(issue(429,'[P0][NV02] Vercel deploy self-heal'))).toBe(false);
    expect(eligible(issue(423,'[P0][NV02][WEB] website worker'))).toBe(false);
    expect(eligible(issue(999,'[P0][NV02] credential rotation'))).toBe(false);
    expect(eligible(issue(998,'[P0][NV02] safe',{pull_request:{}}))).toBe(false);
  });
});
