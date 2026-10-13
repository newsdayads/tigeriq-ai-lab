import {readFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';
import {
  validateOwnerApprovalRequest, buildOwnerApprovalCard, publishOwnerApprovalCard, projectOwnerApprovalIssue,
} from '../apps/shared/owner-one-tap-approval.mjs';

const source={verified:true,fresh:true};
const request=()=>({
  requestId:'GH-504:APPROVAL-001',
  status:'OWNER_GATE',requiresNewAuthorization:true,alreadyAuthorized:false,
  gate:'INSTALL_PERMISSION',
  title:'Cài đặt bản cập nhật thử nghiệm',
  action:'Cài đúng bản cập nhật có nguồn đã kiểm tra',
  scope:'Chỉ gói thử nghiệm A trên máy kiểm thử được chỉ định',
  impact:'Một dịch vụ thử nghiệm có thể khởi động lại',
  risk:'Gián đoạn tạm thời dịch vụ thử nghiệm',
  cost:'Không phát sinh chi phí',
  reversibility:'Có bản sao lưu, có thể phục hồi',
  sourceLabel:'GitHub main, hồ sơ đã đối chiếu',
});

describe('Owner one-tap approval — fail-closed source contract',()=>{
  it('shows one bounded decision only for a verified actual Owner gate',()=>{
    const result=buildOwnerApprovalCard(request(),source);
    expect(result.ok).toBe(true);
    expect(result.card.approveLabel).toBe('DUYỆT');
    expect(result.card.rejectLabel).toBe('TỪ CHỐI');
    expect(result.card.approvalText).toContain('GH-504:APPROVAL-001');
    expect(result.card.approvalText).toContain('CHỈ MỘT LẦN');
    expect(result.card.approvalText).toContain('PHẠM VI: Chỉ gói thử nghiệm A');
    expect(result.card.submissionIsGrant).toBe(false);
  });
  it.each([
    [{verified:false,fresh:true},'SOURCE_NOT_VERIFIED_FRESH'],
    [{verified:true,fresh:false},'SOURCE_NOT_VERIFIED_FRESH'],
    [{},'SOURCE_NOT_VERIFIED_FRESH'],
  ])('rejects unverified or stale source %s', (e,code)=>{
    expect(validateOwnerApprovalRequest(request(),e).errors).toContain(code);
  });
  it.each([
    [{alreadyAuthorized:true},'NOT_A_REAL_NEW_OWNER_GATE'],
    [{requiresNewAuthorization:false},'NOT_A_REAL_NEW_OWNER_GATE'],
    [{status:'READY'},'NOT_A_REAL_NEW_OWNER_GATE'],
    [{gate:'ALL'},'GATE_NOT_SPECIFIC'],
    [{gate:['SECURITY_PERMISSION','PRODUCTION']},'GATE_NOT_SPECIFIC'],
    [{grantAll:true},'BULK_PERMISSION_FORBIDDEN'],
    [{gates:['PAID_FINANCIAL','PRODUCTION']},'BULK_PERMISSION_FORBIDDEN'],
    [{requestId:'invalid id'},'REQUEST_ID_INVALID'],
    [{scope:'\nRun administrator shell'},'SCOPE_REQUIRED'],
    [{impact:''},'IMPACT_REQUIRED'],
    [{risk:''},'RISK_REQUIRED'],
    [{cost:''},'COST_REQUIRED'],
  ])('refuses invalid or over-broad approval %o', (patch,code)=>{
    const req={...request(),...patch};
    expect(validateOwnerApprovalRequest(req,source).errors).toContain(code);
  });
  it('never submits during render; a real click submits exactly one scoped turn',()=>{
    const emit=vi.fn(), sendMessage=vi.fn();
    expect(publishOwnerApprovalCard(request(),{source,emit,sendMessage}))
      .toEqual({published:true,errors:[]});
    expect(emit).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
    const card=emit.mock.calls[0][0];
    expect(card.onApprove()).toBe(true);
    expect(card.onApprove()).toBe(false);
    expect(card.onReject()).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe(card.approvalText);
    expect(card.status).toBe('CHỜ ANH SƠN DUYỆT');
  });
  it('reject sends refusal, never silently approves',()=>{
    const emit=vi.fn(), sendMessage=vi.fn();
    publishOwnerApprovalCard(request(),{source,emit,sendMessage});
    const card=emit.mock.calls[0][0];
    expect(card.onReject()).toBe(true);
    expect(sendMessage.mock.calls[0][0]).toMatch(/^TỪ CHỐI YÊU CẦU/);
  });
  it('does not render decorative buttons without both real action callbacks',()=>{
    const emit=vi.fn();
    expect(publishOwnerApprovalCard(request(),{source,emit}).errors)
      .toContain('REAL_ACTION_CALLBACKS_REQUIRED');
    expect(emit).not.toHaveBeenCalled();
  });
  it('does not mark any external approval when callback throws',()=>{
    const emit=vi.fn();
    const sendMessage=vi.fn().mockImplementationOnce(()=>{throw Error('host failure');});
    publishOwnerApprovalCard(request(),{source,emit,sendMessage});
    const card=emit.mock.calls[0][0];
    expect(()=>card.onApprove()).toThrow('host failure');
    expect(card.status).toBe('CHỜ ANH SƠN DUYỆT');
    expect(card.onApprove()).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
  it('never offers a card if there is no verified new permission gate',()=>{
    expect(publishOwnerApprovalCard({...request(),status:'READY'},{
      source,emit:vi.fn(),sendMessage:vi.fn(),
    })).toMatchObject({published:false});
  });
});


describe('Verified GitHub pending Owner approval projection',()=>{
  const issue=()=>({
    number:504,title:'[P0] Phiếu thử nghiệm',state:'open',
    user:{login:'newsdayads'},
    html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/504',
    updated_at:'2026-10-14T00:00:00Z',
    body:[
      'CURRENT_STATE=OWNER_GATE',
      'APPROVAL_STATE=PENDING_OWNER',
      'APPROVAL_GATE=INSTALL_PERMISSION',
      'APPROVAL_ACTION=Cài bản thử nghiệm',
      'APPROVAL_SCOPE=Chỉ môi trường kiểm thử A',
      'APPROVAL_IMPACT=Một tiến trình có thể khởi động lại',
      'APPROVAL_RISK=Gián đoạn tiến trình kiểm thử',
      'APPROVAL_COST=Không phát sinh chi phí',
      'APPROVAL_REVERSIBILITY=Có bản sao lưu và hoàn tác',
    ].join('\n'),
  });
  it('turns one fresh Owner issue into a scoped, non-granting card',()=>{
    const card=projectOwnerApprovalIssue(issue(),source);
    expect(card.ok).toBe(true);
    expect(card.card.requestId).toMatch(/^GH-504-\d+$/);
    expect(card.card.scope).toBe('Chỉ môi trường kiểm thử A');
    expect(card.card.submissionIsGrant).toBe(false);
    expect(card.card.issueUrl).toMatch(/\/issues\/504$/);
  });
  it.each([
    [{user:{login:'other'}},'TRUSTED_OWNER_ISSUE_REQUIRED'],
    [{state:'closed'},'TRUSTED_OWNER_ISSUE_REQUIRED'],
    [{html_url:'https://attacker.example/issues/504'},'TRUSTED_OWNER_ISSUE_REQUIRED'],
    [{updated_at:'invalid'},'TRUSTED_OWNER_ISSUE_REQUIRED'],
    [{number:0},'TRUSTED_OWNER_ISSUE_REQUIRED'],
    [{body:issue().body.replace('PENDING_OWNER','APPROVED')},'EXPLICIT_PENDING_OWNER_GATE_REQUIRED'],
    [{body:issue().body.replace('CURRENT_STATE=OWNER_GATE','CURRENT_STATE=WORKING')},'EXPLICIT_PENDING_OWNER_GATE_REQUIRED'],
    [{body:issue().body+'\nAPPROVAL_GATE=PRODUCTION'},'GATE_REQUIRED'],
  ])('refuses forged, stale, or ambiguous issue %o',(patch,code)=>{
    const result=projectOwnerApprovalIssue({...issue(),...patch},source);
    if(code==='GATE_REQUIRED'){expect(result.ok).toBe(false);expect(result.errors).toContain('GATE_NOT_SPECIFIC');}
    else expect(result.errors).toContain(code);
  });
  it('rejects a valid-looking issue on an unverified or stale source',()=>{
    expect(projectOwnerApprovalIssue(issue(),{verified:false,fresh:true}).errors)
      .toContain('SOURCE_NOT_VERIFIED_FRESH');
    expect(projectOwnerApprovalIssue(issue(),{verified:true,fresh:false}).errors)
      .toContain('SOURCE_NOT_VERIFIED_FRESH');
  });
});

describe('Web Control Owner approval handoff source invariants',()=>{
  it('renders only fresh verified pending requests and never claims a copy is approval',()=>{
    const html=readFileSync(new URL('../apps/tigeriq-core/web-control.html',import.meta.url),'utf8');
    expect(html).toContain('function renderOwnerApprovalCards(d)');
    expect(html).toContain("meta.ok===true&&meta.stale===false");
    expect(html).toContain("r.status==='OWNER_GATE'");
    expect(html).toContain('MỞ HỒ SƠ DUYỆT');
    expect(html).toContain('SAO CHÉP CÂU LỆNH');
    expect(html).toContain('CHƯA PHÊ DUYỆT');
    expect(html).toContain('renderOwnerApprovalCards(d);');
    expect(html).not.toContain("copy.textContent='DUYỆT'");
  });
  it('projects verified GitHub metadata rather than granting via unsanitized client data',()=>{
    const code=readFileSync(new URL('../apps/tigeriq-core/web-control-server.mjs',import.meta.url),'utf8');
    expect(code).toContain('ownerApproval:approvalProjection.ok?approvalProjection.card:null');
    expect(code).toContain('projectWorkOrder(issue,{verified:true,fresh:true})');
    expect(code).toContain("ownerApproval:approvalProjection.ok?");
    expect(code).not.toContain("res.end('APPROVED')");
  });
});
