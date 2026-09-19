import assert from 'node:assert';
import { test } from 'node:test';
import { mapWorkItemProjection, CANONICAL_LIFECYCLE } from '../apps/tigeriq-core/core.mjs';

test('WorkItem projection maps states to canonical lifecycle',async()=>{    const base={kind:'objective',priority:1};
  const queued=mapWorkItemProjection({...base,state:'queued'});
  assert.strictEqual(queued.stage,'QUEUED');
  assert.ok(queued.workItemId);

  const claimed=mapWorkItemProjection({...base,state:'claimed',assignedExecutor:'NV17'});
  assert.strictEqual(claimed.stage,'CLAIMED');
  assert.strictEqual(claimed.assignedExecutor,'NV17');

  const evidence=mapWorkItemProjection({...base,state:'evidence',evidenceRefs:['file:1','file:2']});
  assert.strictEqual(evidence.stage,'EVIDENCE');
  assert.strictEqual(evidence.evidenceRefs.length,2);
});

test('WorkItem projection defaults workItemId if missing',()=>{
  const out=mapWorkItemProjection({kind:'job',state:'queued'});
  assert.ok(out.workItemId);
});

test('SourceRef prioritizes sourceRef over issueRef',()=>{
  const out=mapWorkItemProjection({sourceRef:'github:123',issueRef:'jira:456'});
  assert.strictEqual(out.sourceRef,'github:123');
});

test('WorkItem projection exposes all required view fields',()=>{
  const payload={kind:'objective',state:'working',priority:1,assignedExecutor:'NV17',blockers:['blocked:block1'],nextAction:'fix'};
  const out=mapWorkItemProjection(payload);
  for(const k of['workItemId','sourceRef','kind','assignedExecutor','stage','priority','scopeLease','blockers','evidenceRefs','nextAction']){
    assert.ok(Object.prototype.hasOwnProperty.call(out,k));
  }
});
