import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {
  boundedOpenClawObjectiveState,
  buildDirectOpenClawGithubPrompt,
  directOpenClawGithubJobId,
  extractPcOperatorAssignment,
} from '../apps/tigeriq-core/openclaw-objective-policy.mjs';

describe('#1615 bounded OpenClaw objective policy',()=>{
  const body=`TIGERIQ_EXECUTABLE=true
OWNER_POLICY=AUTO
OWNER_DIRECT=true
CAPABILITY=pc_operator
NO_CODE_CHANGE=true
NO_PC01_SHELL=true

SINGLE ASSIGNED JOB
1. tigeriq_pc tcp_probe host=127.0.0.1 port=18789.
2. tigeriq_pc file_write path=D:\\TigerIQ\\State\\x.txt content=OK.
3. tigeriq_pc file_read the same path and verify OK.

ACCEPTANCE
One structured PASS result.`;

  it('extracts only the assigned job and builds a bounded prompt',()=>{
    const assignment=extractPcOperatorAssignment(body);
    expect(assignment).toContain('tigeriq_pc tcp_probe');
    expect(assignment).not.toContain('ACCEPTANCE');
    const prompt=buildDirectOpenClawGithubPrompt({number:1611,body});
    expect(prompt).toContain('SOURCE_ISSUE=#1611');
    expect(prompt).toContain('tigeriq_pc file_write');
    expect(prompt).toContain('Do not inspect or choose backlog');
    expect(prompt).not.toContain('TIGERIQ_EXECUTABLE=true');
  });

  it('uses a deterministic single GitHub job id',()=>{
    expect(directOpenClawGithubJobId(1611)).toBe('JOB-OC-GH-1611');
  });

  it('settles exactly-one-job objectives without Manager AI',()=>{
    expect(boundedOpenClawObjectiveState([])).toMatchObject({terminal:true,status:'blocked',reason:'missing_job'});
    expect(boundedOpenClawObjectiveState([{id:'a',status:'queued'}])).toMatchObject({terminal:false,status:'active'});
    expect(boundedOpenClawObjectiveState([{id:'a',status:'waiting_resource'}])).toMatchObject({terminal:false,status:'active'});
    expect(boundedOpenClawObjectiveState([{id:'a',status:'done'}])).toMatchObject({terminal:true,status:'completed',reason:'job_done'});
    expect(boundedOpenClawObjectiveState([{id:'a',status:'failed'}])).toMatchObject({terminal:true,status:'blocked',reason:'job_failed'});
    expect(boundedOpenClawObjectiveState([{id:'a',status:'done'},{id:'b',status:'done'}])).toMatchObject({terminal:true,status:'blocked',reason:'unexpected_job_count'});
  });

  it('Core invokes deterministic bounded lifecycle before Manager AI',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(core).toContain("if(o.metadata?.executionSurface==='CORE_OPENCLAW_BOUNDED')");
    expect(core).toContain('boundedOpenClawObjectiveState(boundedJobs)');
    const boundedIndex=core.indexOf("if(o.metadata?.executionSurface==='CORE_OPENCLAW_BOUNDED')");
    const managerIndex=core.indexOf('callManagerDecision(prompt,o.id)',boundedIndex);
    expect(boundedIndex).toBeGreaterThan(-1);
    expect(managerIndex).toBeGreaterThan(boundedIndex);
  });
});
