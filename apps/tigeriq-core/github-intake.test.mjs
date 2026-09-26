import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { contextIssueRefs,extractExplicitContextIssues,extractIssueRefs,extractPcOperatorInstruction,extractRepoPaths,formatResultComment,githubDispatchLane,githubPcOperatorJobId,githubSpecBlockedByActive,hydrateContext,isBoundedAppChromeRequestOnly,parseExecutableIssue } from './github-intake.mjs';
import { appendPublicEvidenceToSummary,extractPublicEvidence,formatPublicEvidenceBlock,parsePublicEvidenceKeys,sanitizePublicEvidenceValue } from './public-evidence.mjs';
import { openClawTerminalDecision } from '../openclaw-tigeriq-runtime/dispatch.mjs';

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
  it('uses explicit CONTEXT_ISSUES deterministically up to sixteen and excludes self/duplicates/invalid tokens',()=>{
    const body='CONTEXT_ISSUES=#101,#102,garbage,#588,#101,0,#103,#104,#105,#106,#107,#108,#109,#110,#111,#112,#113,#114,#115,#116,#117,#118,#119';
    expect(extractExplicitContextIssues(body,588)).toEqual([101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116]);
    expect(contextIssueRefs(body,588)).toEqual({explicit:true,refs:[101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116]});
  });

  it('preserves legacy five-ref extraction when CONTEXT_ISSUES is absent',()=>{
    const body='Refs #101 #102 #103 #104 #105 #106 #107';
    expect(contextIssueRefs(body,588)).toEqual({explicit:false,refs:[101,102,103,104,105]});
  });

  it('hydrates all explicit refs in order and records unavailable refs instead of silently omitting them',async()=>{
    const spec={...base,number:588,title:'context test',url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/588',body:'CONTEXT_ISSUES=#101,#102,#103,#104,#105,#106,#107,#108'};
    const seen=[];
    const fetchImpl=async url=>{
      const n=Number(String(url).match(/\/issues\/(\d+)$/)?.[1]||0);
      seen.push(n);
      if(n===104)return new Response(JSON.stringify({message:'not found'}),{status:404});
      return new Response(JSON.stringify({number:n,title:'Issue '+n,body:'Body '+n}),{status:200,headers:{'content-type':'application/json'}});
    };
    const hydrated=await hydrateContext(fetchImpl,'newsdayads','tigeriq-ai-lab',spec,'');
    expect(seen).toEqual([101,102,103,104,105,106,107,108]);
    for(const n of [101,102,103,105,106,107,108])expect(hydrated).toContain('REFERENCED ISSUE #'+n+': Issue '+n);
    expect(hydrated).toContain('REFERENCED ISSUE #104: UNAVAILABLE');
    expect(hydrated).toContain('ERROR: GITHUB_HTTP_404');
  });

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

  it('parses only supported PUBLIC_EVIDENCE_KEYS and preserves marker-absent behavior',()=>{
    expect(parsePublicEvidenceKeys('PUBLIC_EVIDENCE_KEYS=installedSha,result,token,changedPaths,installedSha,foo')).toEqual(['installedSha','result','changedPaths']);
    expect(parsePublicEvidenceKeys('NO_PUBLIC_EVIDENCE=true')).toEqual([]);
    const parsed=parseExecutableIssue({...base,body:[
      'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','PRIORITY=P1','CAPABILITY=pc_operator',
      'NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=READBACK_X',
      'PUBLIC_EVIDENCE_KEYS=installedSha,result,remoteDesktopGuard,changedPaths,updaterTaskTarget,token',
      'ASSIGNED_ACTION','tigeriq_pc file_read path="D:\\TigerIQ\\State\\core-runtime-updater.json"',
      'ACCEPTANCE','PASS'
    ].join('\n')});
    expect(parsed.publicEvidenceKeys).toEqual(['installedSha','result','remoteDesktopGuard','changedPaths','updaterTaskTarget']);
  });

  it('extracts requested fields only from structured agent evidence and redacts sensitive nested keys',()=>{
    const jobResult={evidence:{agentResult:{evidence:{
      wrapper:{
        installedSha:'abc123',
        result:{status:'PASS',token:'must-not-leak',nested:{password:'no',ok:'yes'}},
        remoteDesktopGuard:'PASS',
        changedPaths:['a','b'],
        updaterTaskTarget:'D:\\TigerIQ\\Core',
        secret:{installedSha:'evil'}
      },
      arbitraryText:'do not publish'
    }}}};
    const out=extractPublicEvidence(jobResult,['installedSha','result','remoteDesktopGuard','changedPaths','updaterTaskTarget','token']);
    expect(out).toEqual({
      installedSha:'abc123',
      result:{status:'PASS',nested:{ok:'yes'}},
      remoteDesktopGuard:'PASS',
      changedPaths:['a','b'],
      updaterTaskTarget:'D:\\TigerIQ\\Core',
    });
    const block=formatPublicEvidenceBlock(out);
    expect(block).toContain('PUBLIC_EVIDENCE_JSON=');
    expect(block).not.toContain('must-not-leak');
    expect(block).not.toContain('password');
    expect(block).not.toContain('arbitraryText');
  });

  it('caps public evidence depth, arrays, and summary publication while leaving unmarked outcomes unchanged',()=>{
    const deep={a:{b:{c:{d:{e:'too-deep'}}}}};
    expect(JSON.stringify(sanitizePublicEvidenceValue(deep))).toContain('[TRUNCATED_DEPTH]');
    const noMarker=appendPublicEvidenceToSummary('base',{evidence:{agentResult:{evidence:{result:'PASS'}}}},[]);
    expect(noMarker).toBe('base');
    const marked=appendPublicEvidenceToSummary('base',{evidence:{agentResult:{evidence:{result:'PASS'}}}},['result']);
    expect(marked).toBe('base\nPUBLIC_EVIDENCE_JSON={"result":"PASS"}');
  });

  it('wires public evidence metadata and both bounded pc_operator reconciliation paths',()=>{
    const intake=readFileSync(new URL('./github-intake.mjs',import.meta.url),'utf8');
    const core=readFileSync(new URL('./core.mjs',import.meta.url),'utf8');
    expect(intake).toContain('publicEvidenceKeys:spec.publicEvidenceKeys||[]');
    expect(intake).toContain('appendPublicEvidenceToSummary(`bounded pc_operator completed');
    expect(core).toContain('o.metadata as objective_metadata');
    expect(core).toContain('appendPublicEvidenceToSummary(`bounded pc_operator completed');
  });

  it('accepts receipt-backed structured OpenClaw success even when outer wrapper reports error',()=>{
    const result={exitCode:1,status:'error',agentResult:{status:'SUCCESS',evidence:{fileRead:{path:'D:\\TigerIQ\\State\\x.json'}}},successfulToolNames:['tigeriq_pc']};
    expect(openClawTerminalDecision(result,{timedOut:false,parsedPresent:true})).toMatchObject({success:true,trustedToolReceipt:true,agentSuccess:true});
  });

  it('rejects contradictory structured success without a trusted TigerIQ tool receipt',()=>{
    const result={exitCode:1,status:'error',agentResult:{status:'SUCCESS',evidence:{marker:'model-only'}},successfulToolNames:[]};
    expect(openClawTerminalDecision(result,{timedOut:false,parsedPresent:true})).toMatchObject({success:false,invalidTerminal:true,trustedToolReceipt:false});
  });

  it('keeps clean wrapper success and rejects prose-only or timed-out terminals',()=>{
    expect(openClawTerminalDecision({exitCode:0,status:'ok',agentResult:{status:'PASS'},successfulToolNames:[]},{timedOut:false,parsedPresent:true})).toMatchObject({success:true,wrapperClean:true});
    expect(openClawTerminalDecision({exitCode:0,status:'ok',agentResult:null,successfulToolNames:['tigeriq_pc']},{timedOut:false,parsedPresent:true})).toMatchObject({success:false,invalidTerminal:true});
    expect(openClawTerminalDecision({exitCode:0,status:'ok',agentResult:{status:'PASS'},successfulToolNames:['tigeriq_pc']},{timedOut:true,parsedPresent:true})).toMatchObject({success:false});
  });

  it('formats a terminal result with objective evidence',()=>{expect(formatResultComment({id:'OBJ-GH-588',status:'completed',summary:'ok'})).toContain('[RESULT] TigerIQ Core completed OBJ-GH-588');});
});
