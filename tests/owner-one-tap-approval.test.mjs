import {describe, expect, it, vi} from 'vitest';
import {
  validateOwnerApprovalRequest, buildOwnerApprovalCard, publishOwnerApprovalCard,
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
