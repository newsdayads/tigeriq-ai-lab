import { describe, expect, it } from 'vitest';
import { completionProof as sharedCompletionProof } from '../apps/shared/work-center-history.mjs';
import { webControlCompletionProof } from '../apps/tigeriq-core/web-control-completion-proof.mjs';

const evidence='https://github.com/newsdayads/tigeriq-ai-lab/issues/5338#issuecomment-6412441362';
const started='https://github.com/newsdayads/tigeriq-ai-lab/issues/5338#issuecomment-6412236448';

function completedIssue(overrides={}){
  const body=[
    'TIGERIQ_JOB_V1',
    'WORK_ORDER_LIFECYCLE=V2',
    'PROJECT_ID=tigeriq-platform',
    'WORKSTREAM_ID=test-runtime-completion',
    'OWNER_POLICY=AUTO',
    'PRIORITY=P1',
    'TIGERIQ_EXECUTABLE=false',
    'DONE=true',
    'CURRENT_STATE=DONE_RUNTIME_PRODUCT_ACCEPTED',
    'CURRENT_STEP=S02 — accepted',
    'NEXT_ACTION=NONE',
    'LAST_COMPLETED_STEP=S02',
    'BLOCKER=NONE',
    'RESOURCE_SCOPE=TEST_RUNTIME_COMPLETION',
    'MUTATION_OWNER=NONE',
    'ETA_STATUS=NOT_APPLICABLE',
    'STARTED_AT=2026-10-26T08:44:09Z',
    'START_RECEIPT_URL='+started,
    'FINISHED_AT=2026-10-26T09:16:02Z',
    'FINISH_RECEIPT_URL='+evidence,
    'SAME_FAILURE_RETRY_COUNT=0',
    'SAME_FAILURE_RETRY_MAX=2',
    'VERIFICATION_COUNT_CURRENT_HEAD=1',
    'VERIFICATION_MAX_PER_HEAD=2',
    'LAST_FAILURE_SIGNATURE=NONE',
    'RETRY_RESUME_TRIGGER=NEW_MATERIAL_EVIDENCE',
    'PROGRESS_SOURCE=STRUCTURED_PROGRESS_CHECKLIST',
    'PROGRESS_COMPLETED=2',
    'PROGRESS_TOTAL=2',
    '',
    '## STRUCTURED_PROGRESS_CHECKLIST',
    '- [x] S01 — source accepted. [Evidence]('+evidence+')',
    '- [x] S02 — runtime accepted. [Evidence]('+evidence+')',
    '',
    '## ACCEPTANCE',
    '- Runtime evidence accepted.',
    '',
    '## STOP_CONDITIONS',
    'DONE_WITH_EVIDENCE',
  ].join('\n');
  return {
    number:5338,title:'[P1] runtime completion proof',body,
    state:'closed',state_reason:'completed',
    created_at:'2026-10-26T08:44:09Z',
    closed_at:'2026-10-26T09:17:35Z',
    ...overrides,
  };
}

describe('Web Control bundled Lifecycle V2 completion proof',()=>{
  it('matches shared completion proof for a valid closed V2 Work Order',()=>{
    const issue=completedIssue();
    const shared=sharedCompletionProof(issue);
    const bundled=webControlCompletionProof(issue);
    expect(shared.verified).toBe(true);
    expect(bundled).toEqual(shared);
  });

  it('fails closed when finish receipt or checklist evidence is missing',()=>{
    const issue=completedIssue();
    issue.body=issue.body
      .replace('FINISH_RECEIPT_URL='+evidence,'FINISH_RECEIPT_URL=NOT_FINISHED')
      .replace('- [x] S02 — runtime accepted. [Evidence]('+evidence+')','- [x] S02 — runtime accepted.');
    const bundled=webControlCompletionProof(issue);
    expect(bundled.verified).toBe(false);
    expect(bundled.contract.valid).toBe(false);
    expect(bundled.contract.missing).toEqual(expect.arrayContaining([
      'CHECKED_STEP_WITHOUT_EVIDENCE_URL',
    ]));
  });
});
