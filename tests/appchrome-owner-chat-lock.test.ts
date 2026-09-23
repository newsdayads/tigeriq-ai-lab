import { describe, expect, it } from 'vitest';
import { safeRepoPath } from '../apps/tigeriq-coding-lane/policy.mjs';
import { parseExecutableIssue } from '../apps/tigeriq-core/github-intake.mjs';
import { isSelfRunSafe } from '../apps/chrome-controller/src/github-self-run.js';

describe('App Chrome Owner-chat-only maintenance lock',()=>{
  it('blocks autonomous Coding Lane mutation of App Chrome source',()=>{
    expect(safeRepoPath('apps/chrome-controller/src/server.ts')).toBe(false);
    expect(safeRepoPath('apps/chrome-controller/runtime/Start-Unified-AppChrome.ps1')).toBe(false);
    expect(safeRepoPath('apps/tigeriq-core/github-intake.mjs')).toBe(true);
  });

  it('blocks Core GitHub intake for App Chrome maintenance work orders',()=>{
    const issue={
      number:9991,state:'open',title:'[OWNER_DIRECT][P0][APP-CHROME] fix runtime',
      body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nPRIORITY=P0\nRESOURCE_SCOPE=APP_CHROME_RUNTIME_FIX'
    };
    expect(parseExecutableIssue(issue)).toBeNull();
  });

  it('blocks App Chrome self-run from selecting App Chrome maintenance/review work',()=>{
    const issue={
      number:9992,state:'open',title:'[REVIEW][P0][APP-CHROME] review fix',
      html_url:'https://github.com/x/y/issues/9992',
      body:'TIGERIQ_EXECUTABLE=true\nAUTO_QUEUE=INCLUDED\nSTATE=READY\nPRIORITY=P0\nZERO_COST=true\nNO_DIRECT_MAIN=true\nNO_PRODUCTION_RELEASE=true\nNO_PAID_COST=true\nNO_CREDENTIAL_CHANGE=true\nNO_DESTRUCTIVE=true\nRESOURCE_SCOPE=APP_CHROME_REVIEW_ONLY'
    };
    expect(isSelfRunSafe(issue)).toBe(false);
  });
});
