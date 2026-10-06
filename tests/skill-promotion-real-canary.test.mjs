import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { markCanaryReady, startCanary, recordCanaryResult, reconcilePromotionQueue } from '../apps/tigeriq-core/skill-promotion.mjs';

const targets=[
  'document-normalization-ingest',
  'source-grounded-knowledge-retrieval',
  'external-research-capability-routing',
  'domain-skill-packaging',
];
const requiredHeadings=['Identity','Trigger','Input','Steps','Tools / Output','Acceptance','Evidence','Fallback','Safety','Non-goals'];

function registryState(content,id){
  const match=content.match(new RegExp('  - id: '+id+'[\\s\\S]*?\\n    state: (\\S+)'));
  return match?.[1]||null;
}

test('#4380 real canaries have measurable PASS evidence and safe boundaries',()=>{
  const evidence=JSON.parse(fs.readFileSync(new URL('../docs/skills/canary/4380/evidence.json',import.meta.url),'utf8'));
  assert.equal(evidence.workOrder,4380);
  assert.equal(evidence.canaries.length,4);
  assert.deepEqual(evidence.safety,{
    packageInstall:false,credentialExpansion:false,cookieExpansion:false,productionMutation:false,appChromeMutation:false,
  });
  for(const id of targets){
    const row=evidence.canaries.find(x=>x.skillId===id);
    assert.ok(row,id);
    assert.equal(row.outcome,'PASS',id);
    assert.ok(row.useCount>=1,id);
    assert.ok(row.outputRef,id);
  }
  const external=evidence.canaries.find(x=>x.skillId==='external-research-capability-routing');
  assert.equal(external.measures.officialSources,2);
  assert.equal(external.measures.credentialsUsed,false);
  const retrieval=evidence.canaries.find(x=>x.skillId==='source-grounded-knowledge-retrieval');
  assert.equal(retrieval.measures.matchedSkillIds,retrieval.measures.expectedSkillIds);
  assert.equal(retrieval.measures.unsupportedClaims,0);
});

test('#4380 promotion queue and registry promote exactly the four evidence-backed skills',()=>{
  const registry=fs.readFileSync(new URL('../docs/skills/registry.yaml',import.meta.url),'utf8');
  const queue=JSON.parse(fs.readFileSync(new URL('../docs/skills/promotion-queue.json',import.meta.url),'utf8'));
  for(const id of targets){
    assert.equal(registryState(registry,id),'ACTIVE',id);
    const row=queue.entries.find(x=>x.skillId===id);
    assert.ok(row,id);
    assert.equal(row.status,'ACTIVE',id);
    assert.equal(row.attempts,1,id);
    assert.equal(row.blocker,null,id);
    assert.equal(row.nextCondition,null,id);
    assert.equal(row.promotionEligible,false,id);
    assert.equal(row.evidence.length,1,id);
    assert.equal(row.evidence[0].type,'USE_MEASURE',id);
    assert.equal(row.evidence[0].outcome,'PASS',id);
    assert.ok(row.evidence[0].useCount>=1,id);
  }
});

test('#4380 promoted skill contracts use the canonical 10-section contract',()=>{
  for(const id of targets){
    const content=fs.readFileSync(new URL('../docs/skills/'+id+'/SKILL.md',import.meta.url),'utf8');
    const headings=[...content.matchAll(/^## (.+)$/gm)].map(m=>m[1]);
    assert.deepEqual(headings,requiredHeadings,id);
    assert.match(content,new RegExp('- ID: '+id));
    assert.match(content,/- State: ACTIVE/);
  }
});


test('#4380 promotionEligible is consumed after evidence-backed ACTIVE transition',()=>{
  const evidence=JSON.parse(fs.readFileSync(new URL('../docs/skills/canary/4380/evidence.json',import.meta.url),'utf8'));
  for(const id of targets){
    const canary=evidence.canaries.find(x=>x.skillId===id);
    let queue={version:1,entries:[{
      skillId:id,status:'VALIDATED_WAITING_CANARY',attempts:0,maxAttempts:3,
      blocker:'NO_CANARY_FIXTURE',nextCondition:'fixture',promotionEligible:false,evidence:[],
    }]};
    queue=markCanaryReady(queue,id,{fixtureRef:'docs/skills/canary/4380/README.md',provenanceRef:'learning-log/2026-09-23-agent-review-document-research.md'});
    queue=startCanary(queue,id);
    queue=recordCanaryResult(queue,id,{
      outcome:'PASS',at:evidence.executedAt,useCount:canary.useCount,
      measureRef:'docs/skills/canary/4380/evidence.json',evidenceRef:canary.outputRef,
    });
    assert.equal(queue.entries[0].status,'PROMOTION_READY',id);
    assert.equal(queue.entries[0].promotionEligible,true,id);
    const terminal=reconcilePromotionQueue({skills:[{id,state:'ACTIVE'}]},queue);
    assert.equal(terminal.entries[0].status,'ACTIVE',id);
    assert.equal(terminal.entries[0].promotionEligible,false,id);
    assert.equal(terminal.entries[0].evidence.at(-1).outcome,'PASS',id);
  }
});
