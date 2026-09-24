import { describe,expect,it } from 'vitest';
import { extractIssueRefs,extractPcOperatorInstruction,extractRepoPaths,formatResultComment,parseExecutableIssue } from './github-intake.mjs';

describe('GitHub Core intake guardrails',()=>{
  const base={number:588,title:'safe test',state:'open',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/588',body:'TIGERIQ_EXECUTABLE=true\nPRIORITY=P2\nCAPABILITY=reasoning\nOWNER_POLICY=AUTO\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nRead #280 and #335 plus `docs/CURRENT_STATE.md`.'};
  it('accepts an explicitly safe autonomous issue',()=>{expect(parseExecutableIssue(base)).toMatchObject({number:588,priority:'P2',capability:'reasoning'});});
  it('supports fast hybrid change detection for Work Orders without unbounded full hydration and NV06/OpenClaw routing',()=>{expect(parseExecutableIssue({...base,body:'TIGERIQ_EXECUTABLE=true
PRIORITY=P1
CAPABILITY=pc_operator
OWNER_POLICY=AUTO
OWNER_DIRECT=true
WORK_ORDER_HYBRID=fast
CORE_DISPATCH=NV06_OPENCLAW
NO_CMD_POWERSHELL=true
ASSIGNED_ACTION
tigeriq_pc status
ACCEPTANCE
PASS'})).toMatchObject({number:588,priority:'P1',capability:'pc_operator',coreDispatch:'NV06_OPENCLAW'});});
  it('fails closed if shell/code guardrails are missing',()=>{expect(parseExecutableIssue({...base,body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO'})).toBeNull();});
  it('does not treat CENTRAL prose/backticks as an executable marker',()=>{expect(parseExecutableIssue({...base,body:'Rule: `TIGERIQ_EXECUTABLE=true`; OWNER_POLICY=AUTO'})).toBeNull();});
  it('extracts bounded issue refs and safe repository paths',()=>{expect(extractIssueRefs(base.body,588)).toEqual([280,335]);expect(extractRepoPaths(base.body)).toEqual(['docs/CURRENT_STATE.md']);});
  it('accepts OWNER_DIRECT bounded pc_operator but rejects non-owner pc_operator',()=>{
    const owner={...base,number:1528,body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nOWNER_DIRECT=true\nPRIORITY=P0\nCAPABILITY=pc_operator\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nRESOURCE_SCOPE=OPENCLAW_TEST\nASSIGNED_ACTION\ntigeriq_pc tcp_probe host=127.0.0.1 port=18789\nACCEPTANCE\nPASS'};
    expect(parseExecutableIssue(owner)).toMatchObject({number:1528,priority:'P0',capability:'pc_operator',ownerDirect:true});
    expect(extractPcOperatorInstruction(owner.body)).toContain('tcp_probe');
    expect(parseExecutableIssue({...owner,body:owner.body.replace('OWNER_DIRECT=true\n','')})).toBeNull();
    expect(parseExecutableIssue({...owner,body:owner.body.replace('ASSIGNED_ACTION\ntigeriq_pc tcp_probe host=127.0.0.1 port=18789\nACCEPTANCE\nPASS','')})).toBeNull();
  });
  it('formats a terminal result with objective evidence',()=>{expect(formatResultComment({id:'OBJ-GH-588',status:'completed',summary:'ok'})).toContain('[RESULT] TigerIQ Core completed OBJ-GH-588');});
});
