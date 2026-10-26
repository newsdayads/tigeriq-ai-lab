import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const loader = readFileSync('bootstrap/00_TIGERIQ_LOADER.md','utf8');
const runbook = readFileSync('docs/apps/ultracar/PUBLISHED_APK_TO_DRIVE_PLAYBOOK.md','utf8');
const source = readFileSync('apps/ultracarhcm-v1-v44/hotfix/fix-zc4-verifier.mjs','utf8');

test('Owner TEST Full Auto standing approval preserved, no repeated approval',()=>{
  assert.match(loader,/ULTRACAR_STANDING_TEST_AUTH_20261025/);
  assert.match(runbook,/FULL_AUTO_TEST_RELEASE=APPROVED/);
  assert.match(runbook,/Không yêu cầu Owner bấm duyệt lần nữa/);
});
test('new-chat must fetch canonical GitHub main sources instead of pretending native auto-load',()=>{
  assert.match(loader,/PUBLISHED_APK_TO_DRIVE_PLAYBOOK\.md/);
  assert.match(runbook,/GitHub \*\*main mới nhất\*\*/);
  assert.match(runbook,/không phải bypass cơ chế an toàn/i);
});
test('existing v44 VerifyError makes published v44 unsafe; device QA not fabricated',()=>{
  assert.match(loader,/VerifyError/);
  assert.match(runbook,/v44 TEST file.*\*\*CRASHES \/ NOT ACCEPTED ON DEVICE\*\*/);
  assert.match(runbook,/DEX_SM-F916N_QA_PASS/);
});
test('published signed v43 baseline and signer must be preserved',()=>{
  assert.match(runbook,/D34271ED42A6C89309A75C5CEC65E57BD3A613B9EC5B9A91A4A3E059E0EFA033/);
  assert.match(runbook,/71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558/);
  assert.match(runbook,/Production/);
});
test('blocked host actions cannot be bypassed via alternate tools or accounts',()=>{
  assert.match(runbook,/không đổi tài khoản, route, lệnh, mã hóa hoặc công cụ/);
  assert.match(loader,/cấm lách bằng công cụ\/account/);
});
test('Drive release requires actual interactive task and cloud readback',()=>{
  assert.match(runbook,/PC01\\wdragons12x/);
  assert.match(runbook,/DRIVE_CLOUD_VERIFIED/);
  assert.match(runbook,/Google Drive API/);
});
test('ART register source safety repair lives in main',()=>{
  assert.match(source,/HA4_V11_CLOBBERED_WITH_STRING/);
  assert.match(source,/new-instance v13/);
  assert.match(source,/move-result-object v12/);
});
