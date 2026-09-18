import { describe, it, expect } from 'vitest';
import { parseExecutableIssue, hasExactFlag } from '../apps/tigeriq-core/github-intake.mjs';

describe('GitHub Intake Tests', () => {
  it('parses executable issues correctly with exact flags', () => {
    const issue = { number: 42, title: 'Test', body: 'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nPRIORITY=P2\nCAPABILITY=reasoning', state: 'open' };
    const parsed = parseExecutableIssue(issue);
    expect(parsed?.number).toBe(42);
    expect(parsed?.priority).toBe('P2');
  });
});
