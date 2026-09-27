import {describe,expect,it} from 'vitest';
import {applyChatMutationOwnerHandoff,chatMutationOwnerPlan} from '../apps/tigeriq-core/github-backlog-policy.mjs';
import {parseExecutableIssue,reconcileStaleChatMutationOwner} from '../apps/tigeriq-core/github-intake.mjs';
import {parseCodingIssue} from '../apps/tigeriq-core/github-coding-intake.mjs';

const SAFE_CODING=`TIGERIQ_EXECUTABLE=false
AUTO_QUEUE=EXCLUDED
OWNER_POLICY=AUTO
OWNER_DIRECT=true
OWNER_MAINTENANCE_AUTHORIZED=true
PRIORITY=P2
CAPABILITY=coding
AUTONOMOUS_CODE=true
EXECUTION_SURFACE=CODING
ZERO_COST=true
NO_PC01_SHELL=true
NO_BROWSER_AUTH=true
NO_DIRECT_MAIN=true
NO_PRODUCTION_RELEASE=true
NO_PAID_COST=true
NO_CREDENTIAL_CHANGE=true
NO_SECURITY_BOUNDARY_CHANGE=true
NO_DESTRUCTIVE=true
RESOURCE_SCOPE=CHAT_OWNER_TEST
MUTATION_OWNER=VY
ALLOW_PATH_PREFIX=docs/`;

function issue(body,title='Safe coding task'){
  return {number:2223,title,body,state:'open',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/2223'};
}
function response(data,status=200){
  return {ok:status>=200&&status<300,status,headers:{get:()=>null},text:async()=>JSON.stringify(data)};
}

describe('bounded private-chat mutation ownership',()=>{
  it('keeps an active chat lease fail-closed from background intake',()=>{
    const body=SAFE_CODING+'\nCHAT_SESSION_LEASE_UNTIL=2030-01-01T00:00:00.000Z\n';
    const plan=chatMutationOwnerPlan(body,'Safe coding task',Date.parse('2029-12-31T23:00:00Z'));
    expect(plan.action).toBe('hold');
    expect(parseCodingIssue(issue(body))).toBeNull();
  });

  it('hands missing/expired safe Vy lease back to Core and rearms execution',()=>{
    const at=Date.parse('2026-09-28T00:30:00Z');
    const applied=applyChatMutationOwnerHandoff(SAFE_CODING,'Safe coding task',at);
    expect(applied.changed).toBe(true);
    expect(applied.plan.reason).toBe('CHAT_LEASE_MISSING');
    expect(applied.body).toContain('MUTATION_OWNER=CORE_DYNAMIC_LEASE');
    expect(applied.body).toContain('TIGERIQ_EXECUTABLE=true');
    expect(applied.body).toContain('AUTO_QUEUE=INCLUDED');
    expect(applied.body).toContain('VY_BACKGROUND_OWNER_FORBIDDEN=true');
    expect(applied.body).not.toContain('MUTATION_OWNER=VY');
    expect(parseCodingIssue(issue(applied.body))).not.toBeNull();
  });

  it('restores ACTIVE_EXECUTION when an expired chat takeover paused a V1 contract',()=>{
    const body=SAFE_CODING+'\nACTIVE_EXECUTION=false\nCHAT_SESSION_LEASE_UNTIL=2026-09-27T00:00:00Z\n';
    const applied=applyChatMutationOwnerHandoff(body,'Safe coding task',Date.parse('2026-09-28T00:30:00Z'));
    expect(applied.body).toContain('ACTIVE_EXECUTION=true');
    expect(applied.body).not.toContain('CHAT_SESSION_LEASE_UNTIL=');
  });

  it('never auto-releases App Chrome, P0, or incomplete safety scopes',()=>{
    expect(chatMutationOwnerPlan(SAFE_CODING,'[P1][APP-CHROME] owner task').action).toBe('preserve');
    expect(chatMutationOwnerPlan(SAFE_CODING.replace('PRIORITY=P2','PRIORITY=P0'),'P0 owner task').action).toBe('preserve');
    expect(chatMutationOwnerPlan(SAFE_CODING.replace('NO_SECURITY_BOUNDARY_CHANGE=true','NO_SECURITY_BOUNDARY_CHANGE=false'),'unsafe').action).toBe('preserve');
  });

  it('Core read-only intake also refuses any live Vy mutation owner',()=>{
    const body=`TIGERIQ_EXECUTABLE=true
OWNER_POLICY=AUTO
OWNER_DIRECT=true
PRIORITY=P2
CAPABILITY=reasoning
NO_CODE_CHANGE=true
NO_PC01_SHELL=true
RESOURCE_SCOPE=READ_ONLY_CHAT_OWNER
MUTATION_OWNER=VY
CHAT_SESSION_LEASE_UNTIL=2030-01-01T00:00:00Z`;
    expect(parseExecutableIssue(issue(body,'Read-only chat owner'))).toBeNull();
  });

  it('patches a stale safe chat owner exactly once; normalized body is idempotent',async()=>{
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      calls.push({url,method:init.method,body:init.body});
      const body=JSON.parse(init.body||'{}').body||'';
      return response({number:2223,state:'open',title:'Safe coding task',body});
    };
    const first=await reconcileStaleChatMutationOwner({
      fetchImpl,owner:'newsdayads',repo:'tigeriq-ai-lab',token:'fake',
      issue:issue(SAFE_CODING),nowMs:Date.parse('2026-09-28T00:30:00Z')
    });
    expect(first.changed).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PATCH');
    expect(first.issue.body).toContain('MUTATION_OWNER=CORE_DYNAMIC_LEASE');

    const second=await reconcileStaleChatMutationOwner({
      fetchImpl,owner:'newsdayads',repo:'tigeriq-ai-lab',token:'fake',
      issue:first.issue,nowMs:Date.parse('2026-09-28T00:31:00Z')
    });
    expect(second.changed).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
