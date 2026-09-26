import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-ignore legacy JS module
import { safeRepoPath } from '../apps/tigeriq-coding-lane/policy.mjs';
// @ts-ignore legacy JS module
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
  it('keeps zero-touch discovery safe under PowerShell StrictMode when issue lacks pull_request',()=>{
    const script=readFileSync('scripts/tigeriq-core/appchrome-zero-touch.ps1','utf8');
    expect(script).toContain("$issue.PSObject.Properties.Name -contains 'pull_request'");
    expect(script).not.toContain('if($issue.pull_request){continue}');
  });

  it('revalidates exact authorization/request/artifact after Wait-SafeBoundary',()=>{
    const script=readFileSync('scripts/tigeriq-core/appchrome-zero-touch.ps1','utf8');
    expect(script).toContain('function Request-Fingerprint');
    expect(script).toContain('function Revalidate-After-SafeBoundary');
    const wait=script.indexOf('Wait-SafeBoundary|Out-Null;$paused=$true');
    const revalidate=script.indexOf('$revalidated=Revalidate-After-SafeBoundary');
    const rollback=script.indexOf('New-Item -ItemType Directory -Force -Path $rollback');
    const installer=script.indexOf('& powershell.exe');
    expect(revalidate).toBeGreaterThan(wait);
    expect(revalidate).toBeLessThan(rollback);
    expect(revalidate).toBeLessThan(installer);
  });

  it('fails closed for cancellation/revocation during the safe-boundary wait',()=>{
    const script=readFileSync('scripts/tigeriq-core/appchrome-zero-touch.ps1','utf8');
    expect(script).toContain('APPCHROME_ZERO_TOUCH_AUTH_REVOKED_DURING_WAIT');
    expect(script).toContain('APPCHROME_OWNER_AUTH_REVOKED');
    expect(script).toContain('APPCHROME_OWNER_ISSUE_NOT_OPEN');
  });

  it('fails closed for supersede or target/artifact changes during the safe-boundary wait',()=>{
    const script=readFileSync('scripts/tigeriq-core/appchrome-zero-touch.ps1','utf8');
    expect(script).toContain('APPCHROME_OWNER_AUTH_SUPERSEDED');
    expect(script).toContain('APPCHROME_ZERO_TOUCH_REQUEST_CHANGED_DURING_WAIT');
    expect(script).toContain('APPCHROME_ZERO_TOUCH_ARTIFACT_CHANGED_DURING_WAIT');
    expect(script).toContain('Request-Fingerprint $fresh');
  });
});
