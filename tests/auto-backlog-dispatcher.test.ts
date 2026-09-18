import { describe, it, expect } from 'vitest';
import { parseExecutableIssue } from '../apps/tigeriq-core/github-intake.mjs';
import { parseCodingIssue } from '../apps/tigeriq-core/github-coding-intake.mjs';

describe('Auto Backlog Dispatcher', () => {
  it('routes correctly between core and coding lanes based on autonomous flags and priority', () => {
    const coreIssue = { id: 1, number: 101, title: 'Core Task', body: 'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nPRIORITY=P1', state: 'open' };
    const codingIssue = { id: 2, number: 102, title: 'Coding Task', body: 'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nAUTONOMOUS_CODE=true\nZERO_COST=true\nNO_PC01_SHELL=true\nNO_PAID_COST=true\nNO_CREDENTIAL_CHANGE=true\nPRIORITY=P0', state: 'open' };
    
    expect(parseExecutableIssue(coreIssue)).toBeTruthy();
    expect(parseCodingIssue(codingIssue)).toBeTruthy();
  });
});
