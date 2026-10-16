import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCodingStepPacket,codingStepInstruction,codingStepPacketFromInstruction,codingRolePrompt,verifyCodingDeliverable,verifyCodingFunctionalChecks,repeatedCodingAttemptDecision,verifyClosedCodingWorkOrder,codingFailureSignature,codingMaterialSourceRevision,codingSourceRevisionPaths,codingUnverifiedLegacyHistoryDecision} from '../apps/tigeriq-coding-lane/step-contract.mjs';

const root='apps/dexcam-personal';
const job={
  step_id:'D01',title:'Khởi tạo mô-đun DeXCam',instruction:'Tạo mã nguồn Android thực.',
  paths:[root+'/app/build.gradle.kts',root+'/app/src/main/AndroidManifest.xml',root+'/app/src/main/java/ai/tigeriq/dexcam/MainActivity.kt'],
  deliverable_type:'android',
  required_changed_paths:[root+'/app/build.gradle.kts',root+'/app/src/main/AndroidManifest.xml',root+'/app/src/main/java/ai/tigeriq/dexcam/MainActivity.kt'],
  steps:['Đọc đặc tả','Tạo tệp nguồn thực','Chạy kiểm thử'],acceptance:['Gradle thật','Manifest thật','Kotlin thật'],
  evidence_required:['Commit đúng SHA','Kết quả kiểm thử']
};
const make=(j=job)=>compileCodingStepPacket({objectiveId:'GH-4625',sourceRevision:'shaA',sourceHeadSha:'a'.repeat(40),job:j,allowedPaths:job.paths,skillEvidence:[{id:'spec-first-tdd',version:'1.1.0',bytes:1800}]});
test('stable step identity and skill provenance',()=>{
  const p=make();
  assert.equal(p.step_id,'D01');assert.deepEqual(p.skill_ids,['spec-first-tdd']);
  assert.match(p.prompt_revision,/^[a-f0-9]{24}$/);
  assert.deepEqual(codingStepPacketFromInstruction(codingStepInstruction(p)),p);
});
test('invalid manager packet fails before dispatch',()=>{
  for(const [key,value] of [['step_id',''],['steps',[]],['acceptance',[]],['evidence_required',[]],['required_changed_paths',[]],['deliverable_type','nonsense']]){
    assert.throws(()=>make({...job,[key]:value}),/CODING_STEP_/);
  }
  assert.throws(()=>make({...job,paths:['apps/tigeriq-core/core.mjs']}),/SCOPE_MISMATCH/);
});
test('markdown placeholder must not be accepted as executable Android project',()=>{
  const p=make();
  const r=verifyCodingDeliverable({packet:p,changes:[{path:root,content:'# Android module will be created'}]});
  assert.equal(r.pass,false);assert.equal(r.code,'CODING_DELIVERABLE_REJECTED');
});
test('real changed source-path structure passes only the structural gate',()=>{
  const p=make();
  const r=verifyCodingDeliverable({packet:p,changes:job.paths.map(path=>({path,content:'code artifact'}))});
  assert.equal(r.pass,true);assert.equal(r.code,'CODING_DELIVERABLE_STRUCTURE_PASSED');
});
test('role-specific manager, implementer, reviewer and acceptor prompts are explicit',()=>{
  const p=make();
  for(const role of ['manager','implementer','reviewer','acceptor']){
    const s=codingRolePrompt({role,packet:p,skillContext:'ACTIVE SKILL'});
    assert.match(s,/STEP_ID=D01/);assert.match(s,/ACTIVE SKILL/);assert.match(s,/PROMPT_REVISION=/);
  }
});
test('corrupt stored packet fails closed',()=>{
  assert.equal(codingStepPacketFromInstruction('legacy instruction'),null);
  assert.throws(()=>codingStepPacketFromInstruction('CODING_STEP_PACKET_JSON={broken}'),/CORRUPT/);
});
test('two identical failures stop, material source revision can re-open',()=>{
  const history=[1,2].map(()=>({workOrderId:'4625',stepId:'D01',sourceRevision:'A',status:'failed',failureSignature:'NO_OUTPUT'}));
  assert.equal(repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D01',sourceRevision:'A',failureSignature:'NO_OUTPUT',history}).code,'CODING_SAME_FAILURE_STOP');
  assert.equal(repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D01',sourceRevision:'B',failureSignature:'NO_OUTPUT',history}).allow,true);
  assert.equal(repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D01',sourceRevision:'A',history:[...history,{...history[0],status:'accepted'}]}).code,'CODING_STEP_ALREADY_ACCEPTED');
});

test('generic green CI alone cannot accept Android, frontend or backend features',()=>{
  const packet=make();
  const generic=[
    {name:'CI Verify',status:'completed',conclusion:'success'},
    {name:'Queue Hygiene Verify',status:'completed',conclusion:'success'},
    {name:'Vercel Online Verify',status:'completed',conclusion:'success'}
  ];
  const denied=verifyCodingFunctionalChecks({packet,checkRuns:generic});
  assert.equal(denied.pass,false);
  assert.deepEqual(denied.missing,['Android Build Verify']);
  const accepted=verifyCodingFunctionalChecks({packet,checkRuns:[...generic,{name:'Android Build Verify',status:'completed',conclusion:'success'}]});
  assert.equal(accepted.pass,true);
});
test('candidate coding lane wiring is explicit and off by default',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(source,/TIGERIQ_P0_CODING_STEP_CANARY/);
  assert.match(source,/loadRequiredCodingSkills/);
  assert.match(source,/assertCodingSkillProof/);
  assert.match(source,/compileCodingStepPacket/);
  assert.match(source,/verifyCodingDeliverable/);
  assert.match(source,/verifyCodingFunctionalChecks/);
  assert.match(source,/repeatedCodingAttemptDecision/);
});

test('an AI manager cannot opt out of required domain functional checks',()=>{
  const p=make({...job,required_checks:[]});
  assert.deepEqual(p.required_checks,['Android Build Verify']);
  const bypass=make({...job,required_checks:['CI Verify']});
  assert.ok(bypass.required_checks.includes('Android Build Verify'));
  assert.ok(bypass.required_checks.includes('CI Verify'));
  assert.equal(verifyCodingFunctionalChecks({packet:bypass,checkRuns:[{name:'CI Verify',status:'completed',conclusion:'success'}]}).pass,false);
});
test('tampered serialized packet refuses a changed test plan or accepted scope',()=>{
  const original=codingStepInstruction(make());
  for(const tampered of [
    original.replace('Android Build Verify','CI Verify'),
    original.replace('"step_id":"D01"','"step_id":"D02"'),
    original.replace('Gradle thật','README updated')
  ])assert.throws(()=>codingStepPacketFromInstruction(tampered),/CODING_STEP_PACKET_CORRUPT/);
});
test('GitHub closed state without verified DONE, checklist or receipt is not accepted',()=>{
  const bad=verifyClosedCodingWorkOrder({body:'DONE=false\nFINISHED_AT=NOT_FINISHED\n- [x] G1\n- [ ] G2\n',state:'closed',stateReason:'completed'});
  assert.equal(bad.pass,false);
  assert.ok(bad.reasons.includes('CHECKLIST_NOT_ACCEPTED'));
  assert.ok(bad.reasons.includes('DONE_EVIDENCE_MISSING_OR_AMBIGUOUS'));
});
test('completed source work order needs coherent terminal evidence',()=>{
  const good=verifyClosedCodingWorkOrder({body:'DONE=true\nFINISHED_AT=2026-10-16T05:00:00+07:00\nFINISH_RECEIPT_URL=https://github.com/newsdayads/tigeriq-ai-lab/issues/4858#issuecomment-1\n- [x] G1\n- [x] G2',state:'closed',stateReason:'completed',externallyVerified:true});
  assert.equal(good.pass,true);
  const ambiguous=verifyClosedCodingWorkOrder({body:'DONE=true\nDONE=false\nFINISHED_AT=2026-10-16T05:00:00+07:00\nFINISH_RECEIPT_URL=https://example.com/a\n- [x] G1'});
  assert.equal(ambiguous.pass,false);
});

test('an in-flight canonical step blocks duplicate objective dispatch even without failures',()=>{
  for(const status of ['queued','running','review','waiting_ci','waiting_resource']){
    const decision=repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D01',sourceRevision:'A',history:[{workOrderId:'4625',stepId:'D01',sourceRevision:'A',status}]});
    assert.deepEqual(decision,{allow:false,code:'CODING_STEP_ALREADY_IN_FLIGHT'});
  }
});
test('same failure with varying transient ids normalizes to one retry signature',()=>{
  assert.equal(codingFailureSignature({code:'OUTPUT_CONTRACT_EXHAUSTED',message:'abc-1'}),'OUTPUT_CONTRACT_EXHAUSTED');
  assert.equal(codingFailureSignature({message:'Job CODE #12345 returned HTTP 422 after 23917ms'}),codingFailureSignature({message:'Job CODE #78911 returned HTTP 422 after 79884ms'}));
});

test('step contract is pinned to exact source commit, not only an objective text fingerprint',()=>{
  const p=make();
  assert.equal(p.source_head_sha,'a'.repeat(40));
  assert.match(codingRolePrompt({role:'implementer',packet:p}),/SOURCE_HEAD_SHA=a{40}/);
  assert.throws(()=>compileCodingStepPacket({objectiveId:'GH-4625',sourceRevision:'shaA',sourceHeadSha:'invalid',job,allowedPaths:job.paths}),/SOURCE_HEAD_INVALID/);
  const other=compileCodingStepPacket({objectiveId:'GH-4625',sourceRevision:'shaA',sourceHeadSha:'b'.repeat(40),job,allowedPaths:job.paths});
  assert.notEqual(p.prompt_revision,other.prompt_revision);
});

test('Owner-controlled canary always creates draft PRs and never auto-merges',async()=>{
  const {readFileSync}=await import('node:fs');
  const lane=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(lane,/draft:canary,maintainer_can_modify:true/);
  assert.match(lane,/if\(AUTO_MERGE&&!canary\)/);
  assert.doesNotMatch(lane,/TIGERIQ_P0_CODING_STEP_OWNER_RELEASE/);
});


test('unrelated main commits cannot reset the retry budget of the same source step',()=>{
  const input={objective:'Issue #4625 implement D01',paths:['apps/dexcam-personal/app/build.gradle.kts'],sourceBlobs:{'apps/dexcam-personal/app/build.gradle.kts':'a'.repeat(40)}};
  const first=codingMaterialSourceRevision(input);
  const unrelatedMainChanged=codingMaterialSourceRevision({...input,unrelatedMainSha:'b'.repeat(40)});
  assert.equal(first,unrelatedMainChanged);
  const issueStatusChurn=codingMaterialSourceRevision({...input,liveFingerprint:'status=blocked,updatedAt=2026-10-16T08:00'});
  const latestComment=codingMaterialSourceRevision({...input,liveFingerprint:'status=running,updatedAt=2026-10-16T08:05'});
  assert.equal(first,issueStatusChurn);
  assert.equal(first,latestComment);
  assert.notEqual(first,codingMaterialSourceRevision({...input,sourceBlobs:{'apps/dexcam-personal/app/build.gradle.kts':'b'.repeat(40)}}));
  assert.notEqual(first,codingMaterialSourceRevision({...input,objective:'Issue #4625 D01 new evidence'}));
  assert.throws(()=>codingMaterialSourceRevision({...input,sourceBlobs:{}}),/CODING_MATERIAL_BLOB_UNKNOWN/);
});
test('a merged step without product acceptance is not replayed or labelled accepted',()=>{
  const decision=repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D01',sourceRevision:'A',history:[{workOrderId:'4625',stepId:'D01',sourceRevision:'A',status:'merged_unaccepted'}]});
  assert.equal(decision.code,'CODING_STEP_MERGED_AWAITING_ACCEPTANCE');
  assert.equal(decision.allow,false);
});

test('a closed issue with all fields marked DONE but no trusted external verification still fails',()=>{
  const body='DONE=true\nFINISHED_AT=2026-10-16T05:00:00+07:00\nFINISH_RECEIPT_URL=https://github.com/newsdayads/tigeriq-ai-lab/issues/4858#issuecomment-1\n- [x] G1';
  const decision=verifyClosedCodingWorkOrder({body,state:'closed',stateReason:'completed'});
  assert.equal(decision.pass,false);
  assert.ok(decision.reasons.includes('EXTERNAL_ACCEPTANCE_UNVERIFIED'));
});

test('P0 canary caps CI repair and independent review to two cycles',async()=>{
  const {readFileSync}=await import('node:fs');
  const lane=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(lane,/maxRepairCycles:canary\?2:3/);
  assert.match(lane,/maxCycles:canary\?2:3/);
});

test('domain acceptance reads real exact-head GitHub check runs, not generic gate projection',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(source,/commits\/\$\{encodeURIComponent\(gates\.sha\)\}\/check-runs\?per_page=100/);
  assert.match(source,/verifyCodingFunctionalChecks\(\{packet:stepPacket,checkRuns:domainCheckReceipt\.check_runs\}\)/);
  assert.doesNotMatch(source,/verifyCodingFunctionalChecks\(\{packet:stepPacket,checkRuns:gates\.states\}\)/);
});

test('held draft PR cannot spawn another identical Work Order step without material change',()=>{
  const history=[{workOrderId:'4902',stepId:'G4',sourceRevision:'source-A',status:'blocked_unaccepted'}];
  const same=repeatedCodingAttemptDecision({workOrderId:'4902',stepId:'G4',sourceRevision:'source-A',history});
  assert.equal(same.allow,false);
  assert.equal(same.code,'CODING_STEP_BLOCKED_AWAITING_MATERIAL_CHANGE');
  const changed=repeatedCodingAttemptDecision({workOrderId:'4902',stepId:'G4',sourceRevision:'source-B',history});
  assert.equal(changed.allow,true);
});

test('P0 compact-output contract failure switches to a distinct model instead of repeating identical prompt',async()=>{
  const {readFileSync}=await import('node:fs');
  const lane=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(lane,/maxSameResourceAttempts:codingP0CanaryApplies\(leaseContext\?\.objective\)\?1:2/);
  assert.match(lane,/shrinkPrompt:preserveGenerationPrompt,maxSameResourceAttempts/);
});
test('reviewer is given real pinned ACTIVE Skill instructions rather than an empty skill slot',async()=>{
  const {readFileSync}=await import('node:fs');
  const lane=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(lane,/const reviewSkills=loadRequiredCodingSkills\(canonicalObjective,\{requiredIds:requiredCodingSkillIdsForDeliverable\(packet\.deliverable_type\)\}\)/);
  assert.match(lane,/assertCodingSkillProof\(packet\.skill_refs,reviewSkills\)/);
  assert.match(lane,/role:'reviewer',packet,skillContext:reviewSkills\.contextBlock/);
});

test('canary is allowlisted per source Issue; missing issue scope fails closed',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(source,/export function codingP0CanaryApplies\(objective=''\)/);
  assert.match(source,/TIGERIQ_P0_CODING_STEP_CANARY_ISSUE/);
  assert.match(source,/CODING_CANARY_ISSUE_SCOPE_REQUIRED/);
  assert.match(source,/Number\.isSafeInteger\(objective\).*sourceWorkOrderNumber\(objective\).*===issue/);
  assert.match(source,/codingP0CanaryApplies\(Number\(issueNumber\)/);
  assert.match(source,/codingP0CanaryApplies\(Number\(error\?\.detail\?\.issueNumber\)/);
  assert.match(source,/const canary=codingP0CanaryApplies\(o\.objective\)/);
  assert.match(source,/const canary=codingP0CanaryApplies\(canonicalObjective\)/);
  assert.match(source,/draft:canary/);
  assert.match(source,/if\(AUTO_MERGE&&!canary\)/);
  assert.match(source,/if\(storedCanaryPacket&&!canary\)throw Object\.assign\(new Error\('CODING_STEP_PACKET_OUTSIDE_CANARY_SCOPE'\)/);
});

test('canary is effective only for explicitly authorized canonical Issue; close preflight handles numeric Issue',async()=>{
  const {readFileSync}=await import('node:fs');
  const {runInNewContext}=await import('node:vm');
  const source=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  const helper=source.match(/export function codingP0CanaryApplies\(objective=''\)\{[\s\S]*?(?=\nexport function sourceWorkOrderNumber)/)?.[0];
  const parser=source.match(/export function sourceWorkOrderNumber\(objective=''\)\{[\s\S]*?(?=\n\/\/ The GitHub Coding Intake)/)?.[0];
  assert.ok(helper&&parser);
  const fakeProcess={env:{TIGERIQ_P0_CODING_STEP_CANARY:'1',TIGERIQ_P0_CODING_STEP_CANARY_ISSUE:'4902'}};
  const fn=runInNewContext((helper+'\n'+parser).replaceAll('export function ','function ')+'\ncodingP0CanaryApplies',{process:fakeProcess});
  assert.equal(fn('GitHub autonomous coding issue #4902: P0 scoped'),true);
  assert.equal(fn('GitHub autonomous coding issue #4903: unrelated'),false);
  // These exact retry formats were observed in live PC01 Coding Lane objectives.
  assert.equal(fn('GitHub autonomous coding retry 1/2 for issue #4902: same work'),true);
  assert.equal(fn('GitHub autonomous coding retry 2/2 for issue #4902: same work'),true);
  assert.equal(fn('GitHub autonomous coding retry 1/2 for issue #4903: other work'),false);
  assert.equal(fn('Untrusted quoted text:\nGitHub autonomous coding issue #4902'),false);
  assert.equal(fn('GitHub autonomous coding issue #4903: owner\nQuoted GitHub autonomous coding issue #4902'),false);
  assert.equal(fn(4902),true);
  assert.equal(fn(4903),false);
  assert.equal(fn('ordinary legacy job'),false);
  fakeProcess.env.TIGERIQ_P0_CODING_STEP_CANARY_ISSUE='';
  assert.throws(()=>fn('GitHub autonomous coding issue #4902'),/CODING_CANARY_ISSUE_SCOPE_REQUIRED/);
  fakeProcess.env.TIGERIQ_P0_CODING_STEP_CANARY='0';
  assert.equal(fn('GitHub autonomous coding issue #4902'),false);
});


test('PC01 retry 1/2 and 2/2 for same Work Order share material source revision',()=>{
  const base={canonicalWorkOrderId:'4625',paths:['apps/dexcam-personal/app/build.gradle.kts'],sourceBlobs:{'apps/dexcam-personal/app/build.gradle.kts':'a'.repeat(40)}};
  const one=codingMaterialSourceRevision({...base,objective:'GitHub autonomous coding issue #4625: DeXCam\nDISPATCH_KEY=GITHUB-I-4625'});
  const two=codingMaterialSourceRevision({...base,objective:'GitHub autonomous coding retry 1/2 for issue #4625: DeXCam\nRETRY_KEY=run-1'});
  const three=codingMaterialSourceRevision({...base,objective:'GitHub autonomous coding retry 2/2 for issue #4625: DeXCam\nRETRY_KEY=run-2'});
  assert.equal(one,two);
  assert.equal(two,three);
  const other=codingMaterialSourceRevision({...base,canonicalWorkOrderId:'4870',objective:'GitHub autonomous coding retry 1/2 for issue #4870'});
  assert.notEqual(other,one);
  const sourceChanged=codingMaterialSourceRevision({...base,objective:'GitHub autonomous coding issue #4625',sourceBlobs:{'apps/dexcam-personal/app/build.gradle.kts':'b'.repeat(40)}});
  assert.notEqual(sourceChanged,one);
  const approvedRevision=codingMaterialSourceRevision({...base,materialSpecRevision:'owner-rearmed-v2'});
  assert.notEqual(approvedRevision,one);
  assert.throws(()=>codingMaterialSourceRevision({...base,canonicalWorkOrderId:'BAD/4625'}),/CODING_CANONICAL_WORK_ORDER_INVALID/);
  const failureHistory=Array.from({length:2},()=>({workOrderId:'4625',stepId:'D01',sourceRevision:one,status:'failed',failureSignature:'OUTPUT_CONTRACT_EXHAUSTED'}));
  const decision=repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D01',sourceRevision:three,failureSignature:'OUTPUT_CONTRACT_EXHAUSTED',history:failureHistory});
  assert.equal(decision.code,'CODING_SAME_FAILURE_STOP');
});

test('P0 manager derives retry identity from canonical Issue, not mutable dispatch metadata',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(source,/canonicalWorkOrderId:sourceWorkOrder\?String\(sourceWorkOrder\):''/);
  assert.match(source,/WORK_SPEC_REVISION/);
  assert.match(source,/workOrderId=String\(sourceWorkOrder\|\|o\.id\)/);
});


test('changing AI-generated step_id cannot bypass an unchanged Work Order failure',()=>{
  const revision='material-sha-same';
  const history=[{workOrderId:'4625',stepId:'D01',sourceRevision:revision,status:'failed',failureSignature:'OUTPUT_CONTRACT_EXHAUSTED'}];
  const renamed=repeatedCodingAttemptDecision({
    workOrderId:'4625',stepId:'D02',sourceRevision:revision,
    failureSignature:'OUTPUT_CONTRACT_EXHAUSTED',history
  });
  assert.deepEqual(renamed,{allow:false,code:'CODING_STEP_ALIAS_REPLAY_BLOCKED'});
  // A material source change gives a different revision and permits re-planning.
  assert.equal(repeatedCodingAttemptDecision({
    workOrderId:'4625',stepId:'D02',sourceRevision:'material-sha-new',history
  }).allow,true);
  // A genuinely accepted previous step may advance to the next named step.
  assert.equal(repeatedCodingAttemptDecision({
    workOrderId:'4625',stepId:'D02',sourceRevision:revision,
    history:[{...history[0],status:'accepted'}]
  }).allow,true);
  for(const status of ['queued','running','blocked_unaccepted','merged_unaccepted']){
    assert.equal(repeatedCodingAttemptDecision({
      workOrderId:'4625',stepId:'D02',sourceRevision:revision,
      history:[{...history[0],status}]
    }).code,'CODING_STEP_ALIAS_REPLAY_BLOCKED');
  }
});
test('Coding Lane atomic replay guard receives all same-revision step IDs',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(source,/const same=history\.filter\(h=>h\.workOrderId===workOrderId&&h\.sourceRevision===packet\.source_revision\)/);
  assert.doesNotMatch(source,/const same=history\.filter\(h=>h\.workOrderId===workOrderId&&h\.stepId===packet\.step_id/);
});


test('live-observed pre-canary retry failures require evidence before fresh canary dispatch',()=>{
  const rows=[
    {workOrderId:'4625',status:'blocked'},
    {workOrderId:'4625',status:'failed'},
    {workOrderId:'4870',status:'failed'}
  ];
  const blocked=codingUnverifiedLegacyHistoryDecision({workOrderId:'4625',legacyRows:rows});
  assert.deepEqual(blocked,{allow:false,code:'CODING_PRE_CANARY_HISTORY_UNVERIFIED',legacyCount:2});
  assert.equal(codingUnverifiedLegacyHistoryDecision({workOrderId:'4902',legacyRows:rows}).allow,true);
  assert.equal(codingUnverifiedLegacyHistoryDecision({workOrderId:'4625',legacyRows:[{workOrderId:'4625',status:'cancelled'}]}).allow,true);
  assert.equal(codingUnverifiedLegacyHistoryDecision({workOrderId:'',legacyRows:rows}).allow,false);
  assert.equal(codingUnverifiedLegacyHistoryDecision({workOrderId:'4625',legacyRows:null}).allow,false);
});
test('legacy-historical retry gate is wired before creating the next Coding job',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(source,/codingUnverifiedLegacyHistoryDecision\(\{workOrderId,legacyRows\}\)/);
  const legacyPos=source.indexOf('const legacy=codingUnverifiedLegacyHistoryDecision({workOrderId,legacyRows})');
  const persistPos=source.indexOf('if(replayGuard)await replayGuard(db);');
  assert.ok(legacyPos>=0&&persistPos>legacyPos);
});


test('canary material fingerprint stays pinned when manager changes step file subset',()=>{
  const canonical=['apps/a/main.mjs','apps/a/main.test.mjs'];
  const a=codingSourceRevisionPaths({canonicalPaths:canonical,proposedPaths:[canonical[0]]});
  const b=codingSourceRevisionPaths({canonicalPaths:canonical,proposedPaths:[canonical[1]]});
  assert.deepEqual(a,b);
  const blobs=Object.fromEntries(canonical.map(p=>[p,'a'.repeat(40)]));
  const first=codingMaterialSourceRevision({canonicalWorkOrderId:'4625',paths:a,sourceBlobs:blobs});
  const second=codingMaterialSourceRevision({canonicalWorkOrderId:'4625',paths:b,sourceBlobs:blobs});
  assert.equal(first,second);
  assert.equal(repeatedCodingAttemptDecision({
    workOrderId:'4625',stepId:'D02',sourceRevision:second,
    history:[{workOrderId:'4625',stepId:'D01',sourceRevision:first,status:'failed',failureSignature:'OUTPUT_CONTRACT_EXHAUSTED'}]
  }).code,'CODING_STEP_ALIAS_REPLAY_BLOCKED');
  assert.throws(()=>codingSourceRevisionPaths({canonicalPaths:[],proposedPaths:canonical}),/EXACT_SOURCE_SCOPE_REQUIRED/);
  assert.throws(()=>codingSourceRevisionPaths({canonicalPaths:['apps/a/'],proposedPaths:[canonical[0]]}),/EXACT_SOURCE_SCOPE_REQUIRED/);
  assert.throws(()=>codingSourceRevisionPaths({canonicalPaths:canonical,proposedPaths:['apps/b/foreign.mjs']}),/STEP_SOURCE_SCOPE_MISMATCH/);
});
test('canary lane pins revision to canonical allowed files, never model-selected subset',async()=>{
  const {readFileSync}=await import('node:fs');
  const src=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(src,/codingSourceRevisionPaths\(\{canonicalPaths:canonical,proposedPaths:paths\}\)/);
  assert.match(src,/paths:materialPaths,sourceBlobs/);
});
