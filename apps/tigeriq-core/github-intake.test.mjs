import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { extractIssueRefs,extractPcOperatorInstruction,extractRepoPaths,formatResultComment,githubDispatchLane,githubPcOperatorJobId,githubSpecBlockedByActive,isBoundedAppChromeRequestOnly,parseExecutableIssue } from './github-intake.mjs';

describe('GitHub Core intake guardrails',()=>{

  it('materializer has no global active-GitHub-objective stop gate',()=>{
    const source=readFileSync(new URL('./github-intake.mjs',import.meta.url),'utf8');
    expect(source).not.toContain("status='active' limit 1\")).rowCount>0");
    expect(source).toContain("select metadata from tigeriq_objectives where metadata->>'source'='github' and status='active'");
    expect(source).toContain('githubSpecBlockedByActive(spec,activeMetadata)');
    expect(source).toContain('dispatchLane:spec.dispatchLane');
  });


  const base={number:588,title:'safe test',state:'open',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/588',body:'TIGERIQ_EXECUTABLE=true\nPRIORITY=P2\nCAPABILITY=reasoning\nOWNER_POLICY=AUTO\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nRead #280 and #335 plus `docs/CURRENT_STATE.md`.'};
  it('accepts an explicitly safe autonomous issue',()=>{expect(parseExecutableIssue(base)).toMatchObject({number:588,priority:'P2',capability:'reasoning'});});
  it('accepts bounded NV06/OpenClaw pc_operator work with required safety flags',()=>{const parsed=parseExecutableIssue({...base,body:'TIGERIQ_EXECUTABLE=true\nPRIORITY=P1\nCAPABILITY=pc_operator\nOWNER_POLICY=AUTO\nOWNER_DIRECT=true\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nRESOURCE_SCOPE=OPENCLAW_FAST_TEST\nASSIGNED_ACTION\ntigeriq_pc status\nACCEPTANCE\nPASS'});expect(parsed).toMatchObject({number:588,priority:'P1',capability:'pc_operator',dispatchLane:'PC_OPERATOR',resourceScope:'OPENCLAW_FAST_TEST'});});
  it('fails closed if shell/code guardrails are missing',()=>{expect(parseExecutableIssue({...base,body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO'})).toBeNull();});
  it('does not treat CENTRAL prose/backticks as an executable marker',()=>{expect(parseExecutableIssue({...base,body:'Rule: `TIGERIQ_EXECUTABLE=true`; OWNER_POLICY=AUTO'})).toBeNull();});
  it('extracts bounded issue refs and safe repository paths',()=>{expect(extractIssueRefs(base.body,588)).toEqual([280,335]);expect(extractRepoPaths(base.body)).toEqual(['docs/CURRENT_STATE.md']);});
  it('legacy and assigned P0 pc_operator become autonomous P1 unless an explicit Owner marker exists',()=>{
    const legacy={...base,number:1528,body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nOWNER_DIRECT=true\nPRIORITY=P0\nCAPABILITY=pc_operator\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nRESOURCE_SCOPE=OPENCLAW_TEST\nASSIGNED_ACTION\ntigeriq_pc tcp_probe host=127.0.0.1 port=18789\nACCEPTANCE\nPASS'};
    expect(parseExecutableIssue(legacy)).toMatchObject({number:1528,priority:'P1',sourcePriority:'P0',legacyP0Autonomous:true,ownerControlled:false,capability:'pc_operator'});
    const assigned={...legacy,body:legacy.body.replace('CAPABILITY=pc_operator','CAPABILITY=pc_operator\nASSIGNED_EXECUTOR=NV06')};
    expect(parseExecutableIssue(assigned)).toMatchObject({priority:'P1',sourcePriority:'P0',legacyP0Autonomous:true,ownerControlled:false,targetWorker:'NV06'});
    const ownerHeld={...assigned,body:assigned.body+'\nOWNER_HOLD=true'};
    expect(parseExecutableIssue(ownerHeld)).toMatchObject({priority:'P0',sourcePriority:'P0',legacyP0Autonomous:false,ownerControlled:true,targetWorker:'NV06',route:'OPENCLAW'});
    expect(extractPcOperatorInstruction(legacy.body)).toContain('tcp_probe');
  });

  it('allows only explicitly bounded App Chrome request-state work through protected-scope filtering',()=>{
    const boundedBody=[
      'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P0','CAPABILITY=pc_operator',
      'APP_CHROME_REQUEST_ONLY=true','RESOURCE_SCOPE=APP_CHROME_DEPLOY_REQUEST_STATE',
      'NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
      'ASSIGNED_ACTION','Use tigeriq_pc file_write only:','path=D:\\TigerIQ\\State\\appchrome-install-request.json',
      'Then use tigeriq_pc file_read on the same path.','ACCEPTANCE','PASS',
    ].join('\n');
    expect(isBoundedAppChromeRequestOnly(boundedBody)).toBe(true);
    expect(parseExecutableIssue({...base,number:1881,title:'[P0][OPENCLAW] request only',body:boundedBody})).toMatchObject({
      number:1881,priority:'P1',sourcePriority:'P0',capability:'pc_operator',dispatchLane:'PC_OPERATOR',resourceScope:'APP_CHROME_DEPLOY_REQUEST_STATE'
    });
    const mutation=boundedBody.replace('APP_CHROME_REQUEST_ONLY=true\n','').replace('ASSIGNED_ACTION\nUse tigeriq_pc file_write only:','ALLOW_PATH_PREFIX=apps/chrome-controller/\nASSIGNED_ACTION\nUse tigeriq_pc file_write only:');
    expect(parseExecutableIssue({...base,number:1882,title:'[APP-CHROME] mutation',body:mutation})).toBeNull();
  });

  it('active objectives block only the same RESOURCE_SCOPE, not an entire lane',()=>{
    const reasoning={capability:'reasoning',dispatchLane:githubDispatchLane('reasoning'),resourceScope:'SCOPE_A'};
    const pc={capability:'pc_operator',dispatchLane:githubDispatchLane('pc_operator'),resourceScope:'PC_STATE'};
    const active=[{capability:'reasoning',dispatchLane:'CORE_REASONING',resourceScope:'OTHER'}];
    expect(githubSpecBlockedByActive(reasoning,active)).toBe(false);
    expect(githubSpecBlockedByActive(pc,active)).toBe(false);
    expect(githubSpecBlockedByActive(reasoning,[{capability:'review',resourceScope:'SCOPE_A'}])).toBe(true);
    expect(githubSpecBlockedByActive(pc,[{capability:'pc_operator',resourceScope:'PC_STATE'}])).toBe(true);
  });

  it('leaves preferred NV03/NV04 reviews to the UI role lane and avoids generic Core duplication',()=>{
    const reviewBody=[
      'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','PRIORITY=P1','CAPABILITY=review',
      'PREFERRED_REVIEWER=NV03','NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=REVIEW_X'
    ].join('\n');
    expect(parseExecutableIssue({...base,number:1874,title:'review',body:reviewBody})).toBeNull();
    expect(parseExecutableIssue({...base,number:1875,title:'default review',body:reviewBody.replace('PREFERRED_REVIEWER=NV03\n','')})).toBeNull();
    expect(parseExecutableIssue({...base,number:1876,title:'API review',body:reviewBody.replace('PREFERRED_REVIEWER=NV03','PREFERRED_REVIEWER=NV17')})).toMatchObject({
      capability:'review',dispatchLane:'CORE_REVIEW',targetWorker:'NV17'
    });
  });

  it('sync prioritizes active and unreported GitHub objectives instead of the oldest 100 rows',()=>{
    const source=readFileSync(new URL('./github-intake.mjs',import.meta.url),'utf8');
    expect(source).not.toContain("order by created_at asc limit 100");
    expect(source).toContain("status='active'");
    expect(source).toContain("githubResultReported");
    expect(source).toContain("order by case when status='active' then 0 else 1 end, updated_at desc, created_at desc");
  });

  it('uses legacy pc_operator job id for the initial objective and unique deterministic ids for rearms',()=>{
    const initial=githubPcOperatorJobId('OBJ-GH-588',588);
    const rearmA='OBJ-GH-588-Rabc123-20260926032117';
    const rearmB='OBJ-GH-588-Rdef456-20260926032350';
    expect(initial).toBe('JOB-GH-588-PC');
    expect(githubPcOperatorJobId(rearmA,588)).toBe(githubPcOperatorJobId(rearmA,588));
    expect(githubPcOperatorJobId(rearmA,588)).not.toBe(initial);
    expect(githubPcOperatorJobId(rearmA,588)).not.toBe(githubPcOperatorJobId(rearmB,588));
  });

  it('formats a terminal result with objective evidence',()=>{expect(formatResultComment({id:'OBJ-GH-588',status:'completed',summary:'ok'})).toContain('[RESULT] TigerIQ Core completed OBJ-GH-588');});
});
