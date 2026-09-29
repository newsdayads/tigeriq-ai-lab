import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('NV03 isolated sidecar', () => {
  const source=readFileSync('apps/chrome-controller/nv03-isolated-sidecar.mjs','utf8');

  it('is isolated from NV02 and NV04 runtimes', () => {
    expect(source).toContain("const WORKER_ID='NV03'");
    expect(source).toContain('9223');
    expect(source).not.toContain('9222');
    expect(source).not.toContain('/NV02/');
    expect(source).not.toContain('/NV04/');
    expect(source).not.toContain('8798');
    expect(source).not.toContain('8799');
  });

  it('fails closed on ChatGPT auth requirement', () => {
    expect(source).toContain("lastPhase:'AUTH_REQUIRED'");
    expect(source).toContain('if(ui.authRequired)');
    const authBlock=source.slice(source.indexOf('if(ui.authRequired)'),source.indexOf('state.authRequired=false'));
    expect(authBlock).not.toContain('submit(target');
  });

  it('limits role to independent review/QA', () => {
    expect(source).toContain('ROLE=INDEPENDENT_REVIEW_QA');
    expect(source).toContain('không code, không merge, không deploy');
    expect(source).toContain('P0 chỉ làm khi có OWNER_DIRECT');
    expect(source).toContain('Không tự sửa lỗi được phát hiện');
  });
});
