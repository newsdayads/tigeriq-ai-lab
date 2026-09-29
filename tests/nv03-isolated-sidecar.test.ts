import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('NV03 isolated runtime', () => {
  const source=readFileSync(join(process.cwd(),'apps/chrome-controller/nv03-isolated-sidecar.mjs'),'utf8');

  it('is assignment-bound and cannot self-pull backlog', () => {
    expect(source).toContain("req.url==='/assign'");
    expect(source).toContain('READY_UNASSIGNED');
    expect(source).toContain('Không tự chọn backlog khác');
    expect(source).not.toContain('SELF_PULL');
    expect(source).not.toContain('Tự kiểm tra toàn bộ Work Order');
  });

  it('is hard-isolated from NV02/shared controller runtime', () => {
    expect(source).toContain("CDP_PORT=Number(process.env.TIGERIQ_NV03_CDP_PORT||9223)");
    expect(source).toContain("CONTROL_PORT=Number(process.env.TIGERIQ_NV03_CONTROL_PORT||8823)");
    expect(source).not.toContain('8798');
    expect(source).not.toContain('NV02');
    expect(source).not.toContain('NV04');
    expect(source).not.toContain('Start-Unified-AppChrome');
  });

  it('requires exact assignment identity and terminal marker', () => {
    for (const key of ['jobId','claimId','workOrder','issueUrl','resourceScope','inputRevision']) expect(source).toContain(key);
    expect(source).toContain('NV03_ACTIVE_ASSIGNMENT_CONFLICT');
    expect(source).toContain('NV03_TERMINAL');
    expect(source).toContain('[data-message-author-role="assistant"]');
    expect(source).toContain('assistantText.match(/NV03_TERMINAL');
    expect(source).toContain(".filter(vis);const lastAssistant=assistants.at(-1)");
    expect(source).not.toContain('const terminal=(text.match(/NV03_TERMINAL');
    expect(source).toContain('CLAIM_ID=${a.claimId}');
    expect(source).toContain("preferredId=''");
    expect(source).toContain("preferredUrl=''");
    expect(source).toContain("targetId:String(target.id||'')");
    expect(source).toContain('current&&current.jobId===String(data.jobId)');
    expect(source).toContain('freshContext:!sameJob');
    expect(source).toContain('currentAssignment?.freshContext');
    expect(source).toContain('freshContext:false');
    expect(source).toContain('freshContextPreparedAt');
    expect(source).toContain('!currentAssignment?.freshContextPreparedAt');
    expect(source).toContain('Không dùng GitHub PR Approve/Review action');
    expect(source).toContain('Không tự đóng issue; router sẽ reconcile/release claim.');
    expect(source).toContain("req.url==='/release'");
  });

  it('fails closed on ChatGPT auth requirement', () => {
    expect(source).toContain("phase:'BLOCKED_AUTH_REQUIRED'");
    const start=source.indexOf('if(ui.authRequired)');
    const end=source.indexOf('state.authRequired=false',start);
    expect(source.slice(start,end)).not.toContain('submit(target');
  });
});
