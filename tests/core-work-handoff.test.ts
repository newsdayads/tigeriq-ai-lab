import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error TigerIQ Core runtime module is JavaScript and intentionally has no TypeScript declaration file.
import {buildAutonomousCodingHandoffWorkOrder,normalizeTerminalWorkItems,handoffGenerationKey,evaluateChildObjectiveStates,isCodingHandoff,normalizeWorkItemLifecycle} from '../apps/tigeriq-core/work-handoff.mjs';

describe('durable autonomous work handoff',()=>{
  it('uses deterministic idempotency keys and child ids',()=>{
    const jobs=[{title:'Research next step',prompt:'SCOPE: market\nACCEPTANCE: evidence saved\nDo the research',capability:'reasoning'}];
    const a=normalizeTerminalWorkItems('OBJ-PARENT',jobs);
    const b=normalizeTerminalWorkItems('OBJ-PARENT',jobs);
    expect(a).toEqual(b);
    expect(a[0].childObjectiveId).toMatch(/^OBJ-CHILD-[a-f0-9]{24}$/);
    expect(a[0].kind).toBe('research');
  });

  it('dedupes one active owner per scope in a generation',()=>{
    const items=normalizeTerminalWorkItems('OBJ-PARENT',[
      {title:'First',prompt:'SCOPE: same-resource\nACCEPTANCE: first done',capability:'general'},
      {title:'Second',prompt:'SCOPE: same-resource\nACCEPTANCE: second done',capability:'review'},
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].scopeResourceKey).toBe('same-resource');
  });

  it('keeps coding as durable handoff only',()=>{
    const [item]=normalizeTerminalWorkItems('OBJ-PARENT',[
      {title:'[CODING] Patch repository',prompt:'SCOPE: apps/core\nACCEPTANCE: PR evidence',capability:'general'},
    ]);
    expect(item.kind).toBe('source_mutation');
    expect(item.authorityClass).toBe('coding_handoff_only');
    expect(item.childObjectiveId).toBeNull();
    expect(isCodingHandoff(item)).toBe(true);
  });

  it('builds a deterministic fail-closed GitHub coding child from a coding handoff',()=>{
    const [normal]=normalizeTerminalWorkItems('OBJ-GH-5144-RTEST',[
      {title:'[CODING] Patch bounded helper',prompt:'SCOPE: packages/helper,tests/helper\nACCEPTANCE: exact regression passes',capability:'general'},
    ]);
    const normalSpec=buildAutonomousCodingHandoffWorkOrder({parentIssueNumber:5144,parentObjectiveId:'OBJ-GH-5144-RTEST',parentPriority:'P1',item:normal});
    expect(normalSpec?.executable).toBe(true);
    expect(normalSpec?.body).toContain('AUTONOMOUS_CODING_HANDOFF_KEY='+normal.idempotencyKey);
    expect(normalSpec?.body).toContain('MUTATION_OWNER=CORE_DYNAMIC_LEASE');
    expect(normalSpec?.body).toContain('AUTONOMOUS_CODE=true');
    expect(normalSpec?.body).toContain('ALLOW_PATH_PREFIX=packages/helper,tests/helper');

    const [protectedItem]=normalizeTerminalWorkItems('OBJ-GH-5144-RTEST',[
      {title:'[CODING] Patch Core router',prompt:'SCOPE: apps/tigeriq-core/core.mjs,tests/core-work-handoff.test.ts\nACCEPTANCE: exact regression passes',capability:'general'},
    ]);
    const protectedSpec=buildAutonomousCodingHandoffWorkOrder({parentIssueNumber:5144,parentObjectiveId:'OBJ-GH-5144-RTEST',parentPriority:'P1',item:protectedItem});
    expect(protectedSpec?.protectedScope).toBe(true);
    expect(protectedSpec?.executable).toBe(false);
    expect(protectedSpec?.body).toContain('AUTO_QUEUE=EXCLUDED_NV02_CONTROL_PLANE_HANDOFF');
    expect(protectedSpec?.body).toContain('MUTATION_OWNER=GITHUB_AUTHORIZED_USER_ACTIONS_ONLY');
    expect(protectedSpec?.body).not.toContain('OWNER_PROXY=NV02');

    const [invalid]=normalizeTerminalWorkItems('OBJ-GH-5144-RTEST',[
      {title:'[CODING] unsafe',prompt:'SCOPE: ../secrets\nACCEPTANCE: never create',capability:'general'},
    ]);
    expect(buildAutonomousCodingHandoffWorkOrder({parentIssueNumber:5144,parentObjectiveId:'OBJ-GH-5144-RTEST',parentPriority:'P1',item:invalid})).toBeNull();
  });

  it('generates the same wave key regardless of item order',()=>{
    const items=normalizeTerminalWorkItems('OBJ-PARENT',[
      {title:'A',prompt:'SCOPE: a\nACCEPTANCE: A done',capability:'general'},
      {title:'B',prompt:'SCOPE: b\nACCEPTANCE: B done',capability:'review'},
    ]);
    expect(handoffGenerationKey(items)).toBe(handoffGenerationKey([...items].reverse()));
  });

  it('reconstructs restart state from persisted child objective rows',()=>{
    const ids=['OBJ-CHILD-a','OBJ-CHILD-b'];
    expect(evaluateChildObjectiveStates(ids,[{id:ids[0],status:'completed',summary:'done'}]).state).toBe('waiting');
    const complete=evaluateChildObjectiveStates(ids,[
      {id:ids[0],status:'completed',summary:'one'},
      {id:ids[1],status:'completed',summary:'two'},
    ]);
    expect(complete.state).toBe('completed');
    expect(complete.results).toHaveLength(2);
    expect(evaluateChildObjectiveStates(ids,[{id:ids[0],status:'blocked',summary:'gate'}]).state).toBe('blocked');
  });

  it('wires persistence, reconciliation and final-phase handoff into the real Core',()=>{
    const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
    expect(core).toContain('async function reconcileAutonomousHandoff');
    expect(core).toContain('async function persistTerminalHandoff');
    expect(core).toContain('AUTONOMOUS_CHILD_CREATED');
    expect(core).toContain('AUTONOMOUS_CODING_HANDOFF_CREATED');
    expect(core).toContain('materializeManagerCodingHandoff');
    expect(core).toContain('AUTONOMOUS_CODING_GITHUB_CHILD_CREATED');
    expect(core).toContain('githubFindAutonomousCodingHandoffIssue');
    expect(core).toContain('completedGenerationKeys');
    expect(core).toContain('terminalHandoffInstruction');
    expect(core).toContain("handoff?.state!=='waiting_children'");
    expect(core).toContain("case when o.metadata#>>'{handoff,state}'='waiting_children' then 1 else 0 end");
  });
  it('normalizes work item lifecycle in handoff',()=>{
    const normalized = normalizeWorkItemLifecycle({ metadata: { issueOrPr: 'Issue #10', implementer: 'NV01', reviewer: 'NV03', stage: 'review', blocker: '', nextAction: 'merge' } });
    expect(normalized.issueOrPr).toBe('Issue #10');
    expect(normalized.implementer).toBe('NV01');
    expect(normalized.stage).toBe('review');
  });
  it('includes unit tests for aggregateWorkforceHealth function', async () => {
    // @ts-expect-error test import
    const { aggregateWorkforceHealth } = await import('../apps/tigeriq-core/workforce-registry.mjs');
    const workforceRoster = [{ employee_id: 'NV09', name: 'Qwen3', admin_state: 'READY' }];
    const resources = [{ employee_id: 'NV09', status: 'ready', ok: true, provider: 'ollama' }];
    const health = aggregateWorkforceHealth(workforceRoster, resources);
    expect(health.total).toBe(1);
    expect(health.healthy).toBe(1);
    expect(health.members[0].employee_id).toBe('NV09');
  });
});
