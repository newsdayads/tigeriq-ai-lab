import { describe,expect,it } from 'vitest';
import { extractIssueRefs,extractRepoPaths,parseExecutableIssue } from './github-intake.mjs';

describe('GitHub Core intake guardrails',()=>{
  const base={number:588,title:'safe test',state:'open',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/588',body:'TIGERIQ_EXECUTABLE=true\nPRIORITY=P2\nCAPABILITY=reasoning\nOWNER_POLICY=AUTO\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nRead #280 and #335 plus `docs/CURRENT_STATE.md`.'};
  it('accepts an explicitly safe autonomous issue',()=>{expect(parseExecutableIssue(base)).toMatchObject({number:588,priority:'P2',capability:'reasoning'});});
  it('fails closed if shell/code guardrails are missing',()=>{expect(parseExecutableIssue({...base,body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO'})).toBeNull();});
  it('does not treat CENTRAL prose/backticks as an executable marker',()=>{expect(parseExecutableIssue({...base,body:'Rule: `TIGERIQ_EXECUTABLE=true`; OWNER_POLICY=AUTO'})).toBeNull();});
  it('extracts bounded issue refs and safe repository paths',()=>{expect(extractIssueRefs(base.body,588)).toEqual([280,335]);expect(extractRepoPaths(base.body)).toEqual(['docs/CURRENT_STATE.md']);});
});
