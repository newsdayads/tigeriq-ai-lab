import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ownerSmokeNativeGate, ownerSmokeTerminalBody,
  reconcileVerifiedOwnerSmoke } from '../apps/tigeriq-core/owner-smoke-closure.mjs';

const scope='TIGERIQ_OWNER_DIRECTIVE_TRIAGE_5252';
const id='3d1c32c4-9fe1-4157-b362-923aef2bb64f';
const ownerUrl='https://github.com/newsdayads/tigeriq-ai-lab/issues/5252#issuecomment-6379870823';
const originalReceipt = {body:[
  'TIGERIQ_OWNER_REQUEST_V1','OWNER_REQUEST_ID='+id,
  'OWNER_REQUEST_ISSUE=5252','OWNER_REQUEST_STATUS=RECEIVED',
  'OWNER_REQUEST_MESSAGE_JSON="Thử gửi yêu cầu"',
].join('\n')};
const now = new Date();
const answer='Đã đọc chính xác chỉ đạo "Thử gửi yêu cầu" tại thẻ cha #5252; chỉ kiểm tra việc tiếp nhận và đề xuất kế hoạch xử lý thử không có thay đổi mã, máy hoặc Production. R01 kiểm tra nguồn và quyền; R02 ghi nhận kế hoạch có dẫn chứng.';
const job={id:'JOB-GH-5290-API-AUTOWORK',kind:'github_api_autowork',
  status:'done',employee_id:'NV11',resource_id:'res:nv11:test',
  started_at:new Date(now.getTime()-240000).toISOString(),
  completed_at:new Date(now.getTime()-60000).toISOString(),
  result:{text:answer,autoworkAcceptance:{
    code:'GITHUB_AUTOWORK_SOURCE_OUTPUT_ACCEPTED',
    productAccepted:false,resourceScope:scope,employeeId:'NV11',
    characterCount:answer.trim().length,
    textSha256:createHash('sha256').update(answer.trim()).digest('hex'),
  }},
};
function makeIssue(){
  return {number:5290,state:'open',created_at:'2026-10-24T00:00:00Z',
    body:[
      'TIGERIQ_JOB_V1','WORK_ORDER_LIFECYCLE=V2',
      'PROJECT_ID=tigeriq-platform','WORKSTREAM_ID=work-center-owner-request-intake',
      'SOURCE=AUTHENTICATED_OWNER_WORK_CARD','PARENT_ISSUE=#5252',
      'OWNER_REQUEST_ID='+id,'OWNER_REQUEST_RECEIPT='+ownerUrl,
      'PRIORITY=P1','OWNER_POLICY=AUTO','TIGERIQ_EXECUTABLE=true',
      'RESOURCE_SCOPE='+scope,'MUTATION_OWNER=CORE_DYNAMIC_LEASE',
      'CURRENT_STATE=READY_SOURCE_AUDIT',
      'CURRENT_STEP=R01 — read Owner receipt',
      'NEXT_ACTION=Read source and prepare plan',
      'LAST_COMPLETED_STEP=NOT_STARTED','BLOCKER=NONE','DONE=false',
      'STARTED_AT=NOT_STARTED','FINISHED_AT=NOT_FINISHED','ETA_STATUS=UNVERIFIED',
      'SAME_FAILURE_RETRY_COUNT=0','SAME_FAILURE_RETRY_MAX=2',
      'VERIFICATION_COUNT_CURRENT_HEAD=0','VERIFICATION_MAX_PER_HEAD=2',
      'LAST_FAILURE_SIGNATURE=NONE','RETRY_RESUME_TRIGGER=NEW_RECEIPT',
      'NO_CODE_CHANGE=true','NO_RDC=true','NO_PRODUCTION_RELEASE=true',
      '',
      '## STRUCTURED_PROGRESS_CHECKLIST',
      '- [ ] R01 — Read exact authenticated Owner receipt',
      '- [ ] R02 — Deliver bounded evidence-backed plan',
      '',
      '## ACCEPTANCE',
      '- Verify source and native output, no product acceptance inferred',
      '',
      '## STOP_CONDITIONS',
      '- No uncontrolled mutation or stale worker result',
    ].join('\n'),
  };
}
describe('bounded authentic Owner smoke completion',()=>{
  it('rejects a fabricated job DONE or Owner instruction with side effects',()=>{
    const issue=makeIssue();
    expect(ownerSmokeNativeGate({issue,originalReceipt,job}).ok).toBe(true);
    expect(ownerSmokeNativeGate({issue,originalReceipt,job:{...job,result:{text:answer}}}).ok).toBe(false);
    expect(ownerSmokeNativeGate({issue,originalReceipt:{body:originalReceipt.body.replace('Thử gửi yêu cầu','Xóa tất cả')},job}).reason)
      .toBe('OWNER_SMOKE_REQUEST_NOT_EXACT');
    expect(ownerSmokeNativeGate({issue,originalReceipt,job:{...job,result:{...job.result,text:'fake'}}}).ok).toBe(false);
    expect(ownerSmokeNativeGate({issue:{...issue,number:5144},originalReceipt,job}).ok).toBe(false);
  });

  it('does not grant DONE from unchecked steps or absent start/finish receipts',()=>{
    const issue=makeIssue();
    expect(ownerSmokeTerminalBody({issue,startUrl:'',finishUrl:''}).ok).toBe(false);
  });

  it('uses one shared lease, two authenticated receipts and a readback before closing',async()=>{
    let issue=makeIssue(),created=0,writes=0;
    const comments=new Map(),claims={};
    const io={
      readIssue:vi.fn(async()=>structuredClone(issue)),
      createComment:vi.fn(async(_id,body)=>{
        created++;const html_url='https://github.com/newsdayads/tigeriq-ai-lab/issues/5290#issuecomment-'+(1000+created);
        const comment={html_url,body};comments.set(html_url,comment);return comment;
      }),
      readComment:vi.fn(async url=>comments.get(url)),
      findComment:vi.fn(async(_id,signature)=>[...comments.values()].find(c=>c.body.startsWith(signature))||null),
      writeIssue:vi.fn(async(_id,patch)=>{writes++;issue={...issue,...patch};}),
    };
    const leaseApi={
      acquire:vi.fn(async (_pool,options)=>{claims.workId=options.workId;return {
        lease_token:'valid-lease',resource_id:options.resourceId};}),
      heartbeat:vi.fn().mockResolvedValue(true),
      release:vi.fn().mockResolvedValue(true),
    };
    const result=await reconcileVerifiedOwnerSmoke({
      pool:{},sourceIssue:issue,originalReceipt,job,io,leaseApi,
    });
    expect(result).toMatchObject({ok:true,reason:'SOURCE_CLOSED_VERIFIED',leaseReleased:true});
    expect(issue.state).toBe('closed');
    expect(issue.state_reason).toBe('completed');
    expect(issue.body).toContain('DONE=true');
    expect(issue.body).toContain('CURRENT_STATE=DONE_VERIFIED_OWNER_SMOKE');
    expect(issue.body.match(/- \[x\] R0[12]/g)).toHaveLength(2);
    expect(created).toBe(2);
    expect(writes).toBe(3); // 2 checkpoints and one atomic terminal PATCH.
    expect(leaseApi.acquire).toHaveBeenCalledTimes(1);
    expect(leaseApi.release).toHaveBeenCalledTimes(1);
    expect(claims.workId).toContain('OWNER-SMOKE-ACCEPT-5290');
  });

  it('fails closed on a busy lease without writing or creating a new model job',async()=>{
    const io={readIssue:vi.fn(),readComment:vi.fn(),createComment:vi.fn(),writeIssue:vi.fn()};
    const leaseApi={acquire:vi.fn().mockResolvedValue(null),heartbeat:vi.fn(),release:vi.fn()};
    const result=await reconcileVerifiedOwnerSmoke({pool:{},sourceIssue:makeIssue(),originalReceipt,job,io,leaseApi});
    expect(result).toMatchObject({ok:false,reason:'SMOKE_EXCLUSIVE_LEASE_UNAVAILABLE'});
    expect(io.writeIssue).not.toHaveBeenCalled();
    expect(io.createComment).not.toHaveBeenCalled();
  });
});
