import {describe,expect,it} from 'vitest';
import {parseCodingIssue} from '../apps/tigeriq-core/github-coding-intake.mjs';

function issue(body,extra={}){
  return {number:777,title:'Safe autonomous coding task',body,state:'open',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/777',...extra};
}

const SAFE=`TIGERIQ_EXECUTABLE=true
OWNER_POLICY=AUTO
AUTONOMOUS_CODE=true
ZERO_COST=true
NO_PC01_SHELL=true
NO_PAID_COST=true
NO_CREDENTIAL_CHANGE=true
NO_DESTRUCTIVE=true
NO_PRODUCTION_RELEASE=true
NO_BROWSER_AUTH=true
NO_DIRECT_MAIN=true
PRIORITY=P1`;

import {materializeGithubCodingIssues} from '../apps/tigeriq-core/github-coding-intake.mjs';

describe('GitHub coding intake guard',()=>{
  it('accepts only explicit safe autonomous coding issues',()=>{
    const parsed=parseCodingIssue(issue(SAFE));
    expect(parsed?.number).toBe(777);
    expect(parsed?.priority).toBe('P1');
  });
  it('fails closed when a required guard is missing',()=>{
    expect(parseCodingIssue(issue(SAFE.replace('NO_DIRECT_MAIN=true','')))).toBeNull();
  });
  it('ignores pull requests and closed issues',()=>{
    expect(parseCodingIssue(issue(SAFE,{pull_request:{}}))).toBeNull();
    expect(parseCodingIssue(issue(SAFE,{state:'closed'}))).toBeNull();
  });
});

describe('GitHub coding intake dependencies',()=>{
  it('aborts intake and emits warning if any DEPENDS_ON work order is open',async()=>{
    const workOrderBody = SAFE + '\nDEPENDS_ON=100';
    const mockIssues = [ {
      number: 101,
      title: 'Dependent Task',
      body: workOrderBody,
      state: 'open',
      html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/101'
    } ];
    const mockPool = {
      query: async () => ({ rowCount: 0 })
    };
    const fetchImpl = async (url, init) => {
      if (url.includes('/issues?')) {
        return { ok: true, text: async () => JSON.stringify(mockIssues) };
      } else if (url.includes('/issues/100')) {
        return { ok: true, text: async () => JSON.stringify({ number: 100, state: 'open' }) };
      }
      return { ok: false, text: async () => '{}' };
    };
    const res = await materializeGithubCodingIssues({ pool: mockPool, fetchImpl, token: 'fake' });
    expect(res.created).toBe(0);
  });

  it('dispatches normally if all DEPENDS_ON work orders are closed',async()=>{
    const workOrderBody = SAFE + '\nDEPENDS_ON=100';
    const mockIssues = [ {
      number: 101,
      title: 'Dependent Task',
      body: workOrderBody,
      state: 'open',
      html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/101'
    } ];
    const mockPool = {
      query: async () => ({ rowCount: 0 })
    };
    let posted = false;
    const fetchImpl = async (url, init) => {
      if (url.includes('/issues?')) {
        return { ok: true, text: async () => JSON.stringify(mockIssues) };
      } else if (url.includes('/issues/100')) {
        return { ok: true, text: async () => JSON.stringify({ number: 100, state: 'closed' }) };
      } else if (url.includes('/api/objectives')) {
        posted = true;
        return { ok: true, text: async () => JSON.stringify({ id: 'obj-123' }) };
      } else if (url.includes('/comments')) {
        return { ok: true, text: async () => '{}' };
      }
      return { ok: false, text: async () => '{}' };
    };
    const res = await materializeGithubCodingIssues({ pool: mockPool, fetchImpl, token: 'fake' });
    expect(res.created).toBe(1);
    expect(posted).toBe(true);
  });
});
