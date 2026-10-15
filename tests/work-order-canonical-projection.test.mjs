import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWorkOrder } from '../apps/tigeriq-core/web-control-server.mjs';

test('Issue 280 with NOT_EXECUTING and CENTRAL tag is categorized as SYSTEM, never WORKING', () => {
  const issue280 = {
    number: 280,
    title: '[CENTRAL][ĐIỀU PHỐI] Hàng đợi thực thi an toàn + lô việc Owner tạm hoãn',
    state: 'open',
    labels: [{ name: 'SYSTEM' }],
    body: `CURRENT_STATE=NOT_EXECUTING
STATE=NOT_EXECUTING
TIGERIQ_EXECUTABLE=false
RESOURCE_SCOPE=TIGERIQ_CENTRAL_COORDINATION
PRIORITY=P1`
  };

  const projected = projectWorkOrder(issue280);
  assert.equal(projected.workKind, 'SYSTEM');
  assert.equal(projected.bucket, 'HỆ THỐNG');
  assert.notEqual(projected.bucket, 'ĐANG LÀM');
  assert.notEqual(projected.status, 'WORKING');
});

test('Issue 504 with _REVIEW state and QUẢN TRỊ tag is categorized as SYSTEM, not REVIEW', () => {
  const issue504 = {
    number: 504,
    title: '[P0][QUẢN TRỊ] Chính sách tương tác + hiển thị nhân sự chuẩn',
    state: 'open',
    labels: [{ name: 'SYSTEM' }],
    body: `CURRENT_STATE=POLICY_SYSTEM_REVIEW
STATE=POLICY_SYSTEM_REVIEW
TIGERIQ_EXECUTABLE=false
RESOURCE_SCOPE=TIGERIQ_SYSTEM_GOVERNANCE
PRIORITY=P0`
  };

  const projected = projectWorkOrder(issue504);
  assert.equal(projected.workKind, 'SYSTEM');
  assert.equal(projected.bucket, 'HỆ THỐNG');
  assert.notEqual(projected.bucket, 'RÀ SOÁT');
  assert.notEqual(projected.status, 'REVIEW');
});

test('Issue 4780 checklist canonical projection preserves 6/16 and 38 percent', () => {
  const checkLines = [];
  for (let i = 1; i <= 16; i++) {
    const id = 'R' + String(i).padStart(2, '0');
    if (i <= 6) {
      checkLines.push(`- [x] **${id}** — Bước số ${i} [Biên nhận](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-${1000 + i})`);
    } else {
      checkLines.push(`- [ ] **${id}** — Bước số ${i}`);
    }
  }

  const issue4780 = {
    number: 4780,
    title: '[P1][REA] Hồ sơ đồng bộ REA',
    state: 'open',
    labels: [],
    body: `CURRENT_STATE=READY_STEP_R05
CURRENT_STEP=R05 — Kiểm tra biên nhận Canary
NEXT_ACTION=R05 — Tiếp tục thực thi
RESOURCE_SCOPE=REA_4780_CANARY
PRIORITY=P1
TIGERIQ_EXECUTABLE=true

## STRUCTURED_PROGRESS_CHECKLIST — 16 MỐC GỐC
${checkLines.join('\n')}`
  };

  const projected = projectWorkOrder(issue4780);
  assert.equal(projected.progressTotal, 16);
  assert.equal(projected.progressCompleted, 6);
  assert.equal(projected.progressPercent, 38);
  assert.equal(projected.currentStep, 'R05 — Kiểm tra biên nhận Canary');
  assert.equal(projected.nextAction, 'R05 — Tiếp tục thực thi');
});

test('Issue 4625 checklist projection reads 12/30 and 40 percent with bold steps', () => {
  const checkLines = [];
  for (let i = 1; i <= 30; i++) {
    const id = (i <= 6 ? 'A0' + i : (i <= 11 ? 'B0' + (i - 6) : (i === 12 ? 'D01' : 'D' + String(i - 11).padStart(2, '0'))));
    if (i <= 12) {
      checkLines.push(`- [x] **${id}** — Bước số ${i} [Biên nhận](https://github.com/newsdayads/tigeriq-ai-lab/pull/${4800 + i})`);
    } else {
      checkLines.push(`- [ ] **${id}** — Bước số ${i}`);
    }
  }

  const issue4625 = {
    number: 4625,
    title: '[P1][DỰ ÁN RIÊNG][DEXCAM] DeXCam Personal',
    state: 'open',
    labels: [],
    body: `CURRENT_STATE=READY_APP_IMPLEMENTATION_D02
CURRENT_STEP=D02 — Xây bộ nhận diện USB UVC
NEXT_ACTION=D02 — Xây bộ nhận diện USB UVC
RESOURCE_SCOPE=DEXCAM_PERSONAL_GH4625_SOURCE_AND_BUILD
PRIORITY=P1
TIGERIQ_EXECUTABLE=true

## STRUCTURED_PROGRESS_CHECKLIST — 30 MỐC GỐC GIỮ NGUYÊN
${checkLines.join('\n')}`
  };

  const projected = projectWorkOrder(issue4625);
  assert.equal(projected.progressTotal, 30);
  assert.equal(projected.progressCompleted, 12);
  assert.equal(projected.progressPercent, 40);
  assert.equal(projected.currentStep, 'D02 — Xây bộ nhận diện USB UVC');
  assert.equal(projected.nextAction, 'D02 — Xây bộ nhận diện USB UVC');
});
