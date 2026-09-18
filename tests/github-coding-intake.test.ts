import { describe, it, expect } from 'vitest';
import { parseCodingIssue, extractCodingDependencies } from '../apps/tigeriq-core/github-coding-intake.mjs';

describe('GitHub Coding Intake Tests', () => {
  it('parses coding issues and dependencies', () => {
    const issue = { number: 99, title: 'Coding', body: 'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nAUTONOMOUS_CODE=true\nZERO_COST=true\nNO_PC01_SHELL=true\nNO_PAID_COST=true\nNO_CREDENTIAL_CHANGE=true\nDEPENDS_ON=#10,#11', state: 'open' };
    const parsed = parseCodingIssue(issue);
    expect(parsed?.number).toBe(99);
    expect(extractCodingIssueDeps(issue.body)).toEqual([10, 11]);
  });
});

function extractCodingIssueDeps(body: string) {
  return extractCodingDependencies(body);
}
