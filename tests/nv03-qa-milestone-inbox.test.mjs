import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {
  currentQaFields,discoverNv03MilestoneQa,nv03MilestoneQaReceiptMatches,NV03_MILESTONE_QA_MARKER,
} from '../apps/tigeriq-core/nv03-qa-milestone-inbox.mjs';

const sha='4706ea7059ed0c4cc3d0931b84d9a784dfb2ceb6';
const base=[
  '## ACTIVE WORK ORDER','PRIORITY=P1','OWNER_POLICY=AUTO','OWNER_HOLD=false',
  'DONE=false','CURRENT_STATE=SOURCE_VERIFIED_WAIT_A05_INDEPENDENT_REVIEW_AND_B01_REAL_DEVICE_EVIDENCE',
  'DISPLAY_STATE=WAIT_DEPENDENCY_NOT_WORKING','CURRENT_STEP=A05 — pending independent review',
  'RESOURCE_SCOPE=DEXCAM_PERSONAL_GH4625_SOURCE_AND_BUILD','SOURCE_PR=4815',
  'SOURCE_PR_STATUS=MERGED','SOURCE_MERGE_SHA='+sha,
  'A05_INDEPENDENT_REVIEW=NOT_ACCEPTED',
  'B01_REAL_DEVICE_EVIDENCE=NOT_RECEIVED',
].join('\n');
const issue=(body=base,props={})=>({
  number:4625,title:'[P1] DeXCam Personal',state:'open',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/4625',
  labels:[{name:'P1'}],body,...props,
});

describe('NV03 QA-only discovery from canonical milestone work orders',()=>{
  it('finds A05 even if its source PR is merged and the issue is parked for device evidence',()=>{
    const results=discoverNv03MilestoneQa([issue()]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind:'MILESTONE_REVIEW',employeeId:'NV03',milestone:'A05',issueNumber:4625,
      priority:'P1',sourcePr:4815,sourcePrClaim:'MERGED',sourceSha:sha,
      proofStatus:'REVIEW_REQUEST_DISCOVERED',canAcceptMilestone:false,
      requiresIndependentNonAuthorReviewer:true,claimState:'NOT_CLAIMED',
      dedupKey:'NV03_QA|4625|A05|'+sha,
    });
    expect(results[0].sourcePrUrl).toBe('https://github.com/newsdayads/tigeriq-ai-lab/pull/4815');
  });
  it('never discovers history or closed/done/owner-held/P0 work',()=>{
    const historical=base.replace('A05_INDEPENDENT_REVIEW=NOT_ACCEPTED','A05_INDEPENDENT_REVIEW=ACCEPTED')
      +'\n## HISTORICAL\nA05_INDEPENDENT_REVIEW=NOT_ACCEPTED';
    expect(discoverNv03MilestoneQa([issue(historical)])).toEqual([]);
    expect(discoverNv03MilestoneQa([issue(base,{state:'closed'})])).toEqual([]);
    expect(discoverNv03MilestoneQa([issue(base.replace('DONE=false','DONE=true'))])).toEqual([]);
    expect(discoverNv03MilestoneQa([issue(base.replace('OWNER_HOLD=false','OWNER_HOLD=true'))])).toEqual([]);
    expect(discoverNv03MilestoneQa([issue(base.replace('PRIORITY=P1','PRIORITY=P0'),{labels:[{name:'P0'}]})])).toEqual([]);
  });
  it('does not turn reviewer input or missing SHA into an accepted milestone',()=>{
    const noSha=issue(base.replace(sha,'NOT_AVAILABLE'));
    expect(discoverNv03MilestoneQa([noSha])[0]).toMatchObject({
      proofStatus:'MISSING_EXACT_SOURCE_SHA',sourceSha:null,canAcceptMilestone:false
    });
    expect(discoverNv03MilestoneQa([issue(base.replace('A05_INDEPENDENT_REVIEW=NOT_ACCEPTED','A05_INDEPENDENT_REVIEW=ACCEPTED'))])).toEqual([]);
  });
  it('deduplicates exact source SHA QA notes without inventing non-author Github approval',()=>{
    const row=discoverNv03MilestoneQa([issue()])[0];
    const body=[NV03_MILESTONE_QA_MARKER,'WORKER=NV03','SOURCE_ISSUE=4625','MILESTONE=A05',
      'EXACT_SOURCE_SHA='+sha,'QA_RESULT=PRELIMINARY'].join('\n');
    const author={user:{login:'newsdayads'},body};
    expect(nv03MilestoneQaReceiptMatches(author,row)).toBe(true);
    expect(nv03MilestoneQaReceiptMatches({body},row)).toBe(false);
    const existing=discoverNv03MilestoneQa([issue()],{receiptsByIssue:new Map([[4625,[author]]])});
    expect(existing).toHaveLength(1);
    expect(existing[0]).toMatchObject({proofStatus:'REVIEW_EVIDENCE_ALREADY_RECORDED',canAcceptMilestone:false,claimState:'WAIT_INDEPENDENT_ACCEPTANCE'});
    expect(nv03MilestoneQaReceiptMatches({user:{login:'newsdayads'},body:body.replace(sha,'f'.repeat(40))},row)).toBe(false);
  });
  it('exports a read-only QA inbox in the existing PC01 GitHub work projection',()=>{
    const api=readFileSync(new URL('../api/live-status.mjs',import.meta.url),'utf8');
    expect(api).toContain('const nv03MilestoneQaInbox = discoverNv03MilestoneQa(openIssues,{receiptsByIssue:receiptByIssue})');
    expect(api).toContain('receiptCoverage.get(task.issueNumber)');
    expect(api).toContain('REVIEW_RECEIPTS_UNVERIFIED');
    expect(api).toContain('nv03MilestoneQaInboxFresh: !projectionStale && issuesComplete === true');
    expect(api).toContain('nv03MilestoneQaInboxFresh: false');
  });
  it('sorts P1 before P5 while leaving the current work scope/lease untouched',()=>{
    const other=issue(base.replace('PRIORITY=P1','PRIORITY=P5'),{number:9999,labels:[{name:'P5'}]});
    const results=discoverNv03MilestoneQa([other,issue()]);
    expect(results.map(x=>x.issueNumber)).toEqual([4625,9999]);
    expect(results.every(x=>x.canAcceptMilestone===false&&x.claimState==='NOT_CLAIMED')).toBe(true);
  });
  it('rejects stale archived markers regardless of later shadow fields',()=>{
    const f=currentQaFields('## ACTIVE\nDONE=true\n## HISTORY\nDONE=false\nA05_INDEPENDENT_REVIEW=NOT_ACCEPTED');
    expect(f.get('DONE')).toBe('true');
    expect(f.has('A05_INDEPENDENT_REVIEW')).toBe(false);
  });
});
