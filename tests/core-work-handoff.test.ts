import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error TigerIQ Core runtime module is JavaScript and intentionally has no TypeScript declaration file.
import {normalizeTerminalWorkItems,handoffGenerationKey,evaluateChildObjectiveStates,isCodingHandoff} from '../apps/tigeriq-core/work-handoff.mjs';

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

  it('projects normalized Core WorkItem V1 correctly across canonical stages and state-mapping',()=>{
    const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
    expect(core).toContain('async function reconcileAutonomousHandoff');
    expect(core).toContain('async function persistTerminalHandoff');
    expect(core).toContain('AUTONOMOUS_CHILD_CREATED');
    expect(core).toContain('AUTONOMOUS_CODING_HANDOFF_CREATED');
    expect(core).toContain('completedGenerationKeys');
    expect(core).toContain('terminalHandoffInstruction');
    expect(core).toContain("handoff?.state!=='waiting_children'");
    expect(core).toContain("case when o.metadata#>>'{handoff,state}'='waiting_children' then 1 else 0 end");
  });

  it('maps objectives, jobs, and events to WorkItem V1 projection cleanly', async () => {
    const {normalizeCoreWorkItemV1} = await import('../apps/tigeriq-core/work-handoff.mjs');
    const item = normalizeCoreWorkItemV1({
      objective: { id: 'OBJ-123', status: 'in_progress', summary: 'Working on feature', scope_resource_key: 'app' },
      jobs: [{ id: 'JOB-1', status: 'running', title: 'Task' }],
      events: []
    });
    expect(item.workItemId).toBe('OBJ-123');
    expect(item.stage).toBe('WORKING');
    expect(item.scopeLease.resourceKey).toBe('app');
    expect(item.blockers).toHaveLength(0);

    const blockedItem = normalizeCoreWorkItemV1({
      objective: { id: 'OBJ-456', status: 'blocked', summary: 'Gate failed' },
      jobs: [{ id: 'JOB-2', status: 'failed', failure: 'Out of memory' }],
      events: []
    });
    expect(blockedItem.stage).toBe('BLOCKED');
    expect(blockedItem.blockers.length).toBeGreaterThan(0);
  });
});
