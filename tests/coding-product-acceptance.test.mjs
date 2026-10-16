import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_ACCEPTANCE_SCHEMA,
  SUPPORTED_PRODUCT_TYPES,
  PRODUCT_REQUIRED_CHECKS,
  verifyProductArtifacts,
  verifyProductExecutionReceipts,
  evaluateProductAcceptance,
  assertProductAcceptance
} from '../apps/tigeriq-coding-lane/product-acceptance.mjs';

const VALID_SHA_A = 'a'.repeat(40);
const VALID_SHA_B = 'b'.repeat(40);
const REPOSITORY = 'newsdayads/tigeriq-ai-lab';
const verifiedCheck = (name, head_sha=VALID_SHA_A) => ({
  name, status:'completed', conclusion:'success', head_sha,
  id:101, app:{slug:'github-actions'},
  details_url:'https://github.com/'+REPOSITORY+'/actions/runs/100/job/101'
});


test('API contract: exports all required constants and functions for Vy', () => {
  assert.equal(PRODUCT_ACCEPTANCE_SCHEMA, 'TIGERIQ_PRODUCT_ACCEPTANCE_V2');
  assert.deepEqual(SUPPORTED_PRODUCT_TYPES, ['android', 'frontend', 'backend']);
  assert.deepEqual(PRODUCT_REQUIRED_CHECKS, {
    android: ['Android Build Verify'],
    frontend: ['Frontend Functional Verify'],
    backend: ['Backend Contract Verify']
  });
  assert.equal(typeof verifyProductArtifacts, 'function');
  assert.equal(typeof verifyProductExecutionReceipts, 'function');
  assert.equal(typeof evaluateProductAcceptance, 'function');
  assert.equal(typeof assertProductAcceptance, 'function');
});

// --- ANDROID TESTS ---
test('Android positive: Gradle + Manifest + Kotlin + real build verify -> ACCEPTED', () => {
  const changes = [
    { path: 'android/app/build.gradle.kts', content: 'plugins { id("com.android.application") }' },
    { path: 'android/app/src/main/AndroidManifest.xml', content: '<manifest package="com.tigeriq" />' },
    { path: 'android/app/src/main/kotlin/MainActivity.kt', content: 'package com.tigeriq\nclass MainActivity' }
  ];
  const checkRuns = [
    verifiedCheck('Android Build Verify', VALID_SHA_A)
  ];

  const result = evaluateProductAcceptance({
    productType: 'android',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    changes,
    checkRuns
  });

  assert.equal(result.pass, true);
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.code, 'PRODUCT_ACCEPTANCE_PASSED');
  assert.equal(result.sourceHeadSha, VALID_SHA_A);
  assert.deepEqual(result.details.verifiedChecks, ['Android Build Verify']);
  assert.doesNotThrow(() => assertProductAcceptance({
    productType: 'android',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    changes,
    checkRuns
  }));
});

test('Android negative: missing Kotlin/Java code -> BLOCKED', () => {
  const changes = [
    { path: 'android/app/build.gradle.kts', content: 'plugins { id("com.android.application") }' },
    { path: 'android/app/src/main/AndroidManifest.xml', content: '<manifest package="com.tigeriq" />' }
  ];
  const result = verifyProductArtifacts({ productType: 'android', changes });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'PRODUCT_ARTIFACTS_INCOMPLETE');
  assert.ok(result.reasons.includes('ANDROID_KOTLIN_MISSING'));
});

test('Android negative: missing AndroidManifest.xml -> BLOCKED', () => {
  const changes = [
    { path: 'android/app/build.gradle.kts', content: 'plugins { id("com.android.application") }' },
    { path: 'android/app/src/main/kotlin/MainActivity.kt', content: 'class MainActivity' }
  ];
  const result = verifyProductArtifacts({ productType: 'android', changes });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('ANDROID_MANIFEST_MISSING'));
});

test('Android negative: missing Gradle configuration -> BLOCKED', () => {
  const changes = [
    { path: 'android/app/src/main/AndroidManifest.xml', content: '<manifest package="com.tigeriq" />' },
    { path: 'android/app/src/main/kotlin/MainActivity.kt', content: 'class MainActivity' }
  ];
  const result = verifyProductArtifacts({ productType: 'android', changes });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('ANDROID_GRADLE_MISSING'));
});

test('Android negative: empty content in Gradle/Manifest/Kotlin files -> BLOCKED', () => {
  // Empty Gradle file
  const emptyGradle = [
    { path: 'android/app/build.gradle.kts', content: '   ' },
    { path: 'android/app/src/main/AndroidManifest.xml', content: '<manifest package="com.tigeriq" />' },
    { path: 'android/app/src/main/kotlin/MainActivity.kt', content: 'class MainActivity' }
  ];
  const res1 = verifyProductArtifacts({ productType: 'android', changes: emptyGradle });
  assert.equal(res1.pass, false);
  assert.equal(res1.status, 'BLOCKED');
  assert.ok(res1.reasons.includes('ANDROID_GRADLE_EMPTY'));

  // Empty Manifest file
  const emptyManifest = [
    { path: 'android/app/build.gradle.kts', content: 'plugins { id("com.android.application") }' },
    { path: 'android/app/src/main/AndroidManifest.xml', content: '' },
    { path: 'android/app/src/main/kotlin/MainActivity.kt', content: 'class MainActivity' }
  ];
  const res2 = verifyProductArtifacts({ productType: 'android', changes: emptyManifest });
  assert.equal(res2.pass, false);
  assert.equal(res2.status, 'BLOCKED');
  assert.ok(res2.reasons.includes('ANDROID_MANIFEST_EMPTY'));

  // Empty Kotlin file
  const emptyKotlin = [
    { path: 'android/app/build.gradle.kts', content: 'plugins { id("com.android.application") }' },
    { path: 'android/app/src/main/AndroidManifest.xml', content: '<manifest package="com.tigeriq" />' },
    { path: 'android/app/src/main/kotlin/MainActivity.kt', content: '\n\t  ' }
  ];
  const res3 = verifyProductArtifacts({ productType: 'android', changes: emptyKotlin });
  assert.equal(res3.pass, false);
  assert.equal(res3.status, 'BLOCKED');
  assert.ok(res3.reasons.includes('ANDROID_KOTLIN_EMPTY'));
});

test('Android negative: missing real build check -> BLOCKED', () => {
  const result = verifyProductExecutionReceipts({
    productType: 'android',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    checkRuns: []
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('ANDROID_REAL_BUILD_MISSING'));
});

test('Android negative: build check SHA mismatch -> BLOCKED', () => {
  const checkRuns = [
    verifiedCheck('Android Build Verify', VALID_SHA_B)
  ];
  const result = verifyProductExecutionReceipts({
    productType: 'android',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    checkRuns
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'ACCEPTANCE_BLOCKED_SHA_MISMATCH');
  assert.ok(result.reasons.some(r => r.includes('CHECK_SHA_MISMATCH')));
});

// --- FRONTEND TESTS ---
test('Frontend positive: UI code + functional test verify -> ACCEPTED', () => {
  const changes = [
    { path: 'apps/web/src/components/Dashboard.tsx', content: 'export const Dashboard = () => <div>Dashboard</div>;' },
    { path: 'apps/web/src/styles/dashboard.css', content: '.dashboard { display: flex; }' }
  ];
  const checkRuns = [
    verifiedCheck('Frontend Functional Verify', VALID_SHA_A)
  ];

  const result = evaluateProductAcceptance({
    productType: 'frontend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    changes,
    checkRuns
  });

  assert.equal(result.pass, true);
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.code, 'PRODUCT_ACCEPTANCE_PASSED');
  assert.deepEqual(result.details.verifiedChecks, ['Frontend Functional Verify']);
});

test('Frontend negative: missing UI code -> BLOCKED', () => {
  const changes = [
    { path: 'apps/web/package.json', content: '{"name": "web"}' }
  ];
  const result = verifyProductArtifacts({ productType: 'frontend', changes });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('FRONTEND_UI_CODE_MISSING'));
});

test('Frontend negative: empty content in UI files -> BLOCKED', () => {
  const changes = [
    { path: 'apps/web/src/App.tsx', content: '   \n  ' }
  ];
  const result = verifyProductArtifacts({ productType: 'frontend', changes });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('FRONTEND_UI_CODE_EMPTY'));
});

test('Frontend negative: missing functional test check -> BLOCKED', () => {
  const result = verifyProductExecutionReceipts({
    productType: 'frontend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    checkRuns: []
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('FRONTEND_FUNCTIONAL_TEST_MISSING'));
});

test('Frontend negative: functional check in progress or failed -> BLOCKED', () => {
  const checkRuns = [
    { name: 'Frontend Functional Verify', status: 'in_progress', conclusion: 'unknown', head_sha: VALID_SHA_A }
  ];
  const result = verifyProductExecutionReceipts({
    productType: 'frontend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    checkRuns
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'ACCEPTANCE_BLOCKED_EXECUTION_UNVERIFIED');
});

// --- BACKEND TESTS ---
test('Backend positive: API code + contract test verify -> ACCEPTED', () => {
  const changes = [
    { path: 'apps/api/src/routes/health.mjs', content: 'export const health = (req, res) => res.json({ status: "ok" });' }
  ];
  const checkRuns = [
    verifiedCheck('Backend Contract Verify', VALID_SHA_A)
  ];

  const result = evaluateProductAcceptance({
    productType: 'backend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    changes,
    checkRuns
  });

  assert.equal(result.pass, true);
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.code, 'PRODUCT_ACCEPTANCE_PASSED');
  assert.deepEqual(result.details.verifiedChecks, ['Backend Contract Verify']);
});

test('Backend negative: missing API code -> BLOCKED', () => {
  const changes = [
    { path: 'apps/api/config.json', content: '{"port": 8080}' }
  ];
  const result = verifyProductArtifacts({ productType: 'backend', changes });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('BACKEND_API_CODE_MISSING'));
});

test('Backend negative: empty content in API code -> BLOCKED', () => {
  const changes = [
    { path: 'apps/api/src/server.mjs', content: '   ' }
  ];
  const result = verifyProductArtifacts({ productType: 'backend', changes });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('BACKEND_API_CODE_EMPTY'));
});

test('Backend negative: missing contract test check -> BLOCKED', () => {
  const result = verifyProductExecutionReceipts({
    productType: 'backend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    checkRuns: []
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('BACKEND_CONTRACT_TEST_MISSING'));
});

// --- STRICT EXECUTION RECEIPT SECURITY TESTS (REVIEW FEEDBACK FIXES) ---
test('Security check: checkRun missing head_sha must be BLOCKED', () => {
  const checkRuns = [
    { name: 'Android Build Verify', status: 'completed', conclusion: 'success' } // no head_sha!
  ];
  const result = verifyProductExecutionReceipts({
    productType: 'android',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    checkRuns
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'ACCEPTANCE_BLOCKED_MISSING_HEAD_SHA');
  assert.ok(result.reasons.includes('CHECK_HEAD_SHA_MISSING:Android Build Verify'));
});

test('Security check: receipt missing head_sha must be BLOCKED', () => {
  const receipts = [
    { type: 'Backend Contract Verify', status: 'completed', conclusion: 'success' } // no head_sha!
  ];
  const result = verifyProductExecutionReceipts({
    productType: 'backend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    receipts
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'ACCEPTANCE_BLOCKED_MISSING_HEAD_SHA');
  assert.ok(result.reasons.includes('RECEIPT_HEAD_SHA_MISSING:Backend Contract Verify'));
});

test('Security check: receipt with completed + failure must be BLOCKED', () => {
  const receipts = [
    { type: 'Backend Contract Verify', status: 'completed', conclusion: 'failure', head_sha: VALID_SHA_A }
  ];
  const result = verifyProductExecutionReceipts({
    productType: 'backend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    receipts
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'ACCEPTANCE_BLOCKED_EXECUTION_UNVERIFIED');
  assert.ok(result.reasons.some(r => r.includes('RECEIPT_NOT_SUCCEEDED')));
});

test('Security check: receipt with in_progress + success must be BLOCKED', () => {
  const receipts = [
    { type: 'Backend Contract Verify', status: 'in_progress', conclusion: 'success', head_sha: VALID_SHA_A }
  ];
  const result = verifyProductExecutionReceipts({
    productType: 'backend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    receipts
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'ACCEPTANCE_BLOCKED_EXECUTION_UNVERIFIED');
});

test('Duplicate check shadowing: duplicate check where one failed cannot be masked by a passing check', () => {
  const checkRuns = [
    { name: 'Frontend Functional Verify', status: 'completed', conclusion: 'failure', head_sha: VALID_SHA_A },
    verifiedCheck('Frontend Functional Verify', VALID_SHA_A)
  ];
  const result = verifyProductExecutionReceipts({
    productType: 'frontend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    checkRuns
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'ACCEPTANCE_BLOCKED_EXECUTION_UNVERIFIED');
  assert.ok(result.reasons.some(r => r.includes('CHECK_NOT_SUCCEEDED')));
});

test('Duplicate check shadowing: duplicate check where one has different SHA cannot pass', () => {
  const checkRuns = [
    verifiedCheck('Frontend Functional Verify', VALID_SHA_B),
    verifiedCheck('Frontend Functional Verify', VALID_SHA_A)
  ];
  const result = verifyProductExecutionReceipts({
    productType: 'frontend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    checkRuns
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'ACCEPTANCE_BLOCKED_SHA_MISMATCH');
  assert.ok(result.reasons.some(r => r.includes('CHECK_SHA_MISMATCH')));
});

test('Security check: unverified / fake runner in receipt must be BLOCKED', () => {
  const receipts = [
    { type: 'Android Build Verify', status: 'completed', conclusion: 'success', head_sha: VALID_SHA_A, runner: 'fake' }
  ];
  const result = verifyProductExecutionReceipts({
    productType: 'android',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    receipts
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'ACCEPTANCE_BLOCKED_RUNNER_UNVERIFIED');
  assert.ok(result.reasons.some(r => r.includes('RECEIPT_RUNNER_UNVERIFIED')));
});

// --- ANTI-CHEAT & PROHIBITED SHORTCUT TESTS ---
test('Anti-cheat: markdown / documentation only changes cannot claim product DONE', () => {
  const changes = [
    { path: 'docs/architecture/spec.md', content: '# Specification\nAll features done.' },
    { path: 'README.md', content: '# Project\nCompleted.' }
  ];
  const result = verifyProductArtifacts({ productType: 'backend', changes });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'DOCUMENTATION_ONLY_NOT_PRODUCT');
  assert.ok(result.reasons.includes('MARKDOWN_DESCRIPTION_NOT_PRODUCT_DONE'));

  const fullResult = evaluateProductAcceptance({
    productType: 'backend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    changes,
    checkRuns: [verifiedCheck('Backend Contract Verify', VALID_SHA_A)]
  });
  assert.equal(fullResult.pass, false);
  assert.equal(fullResult.code, 'DOCUMENTATION_ONLY_NOT_PRODUCT');
});

test('Anti-cheat: generic CI alone cannot substitute product-specific verification', () => {
  const changes = [
    { path: 'apps/api/src/server.mjs', content: 'export const server = {};' }
  ];
  const checkRuns = [
    verifiedCheck('CI Verify', VALID_SHA_A),
    verifiedCheck('Queue Hygiene Verify', VALID_SHA_A),
    verifiedCheck('Vercel Online Verify', VALID_SHA_A)
  ];

  const result = evaluateProductAcceptance({
    productType: 'backend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    changes,
    checkRuns
  });

  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('BACKEND_CONTRACT_TEST_MISSING'));
  assert.ok(result.reasons.includes('GENERIC_CI_CANNOT_SUBSTITUTE_PRODUCT_ACCEPTANCE'));
});

test('Anti-cheat: closed GitHub Issue cannot substitute product acceptance', () => {
  const changes = [
    { path: 'apps/api/src/server.mjs', content: 'export const server = {};' }
  ];
  const checkRuns = [
    verifiedCheck('Backend Contract Verify', VALID_SHA_A)
  ];
  const issue = {
    number: 4902,
    state: 'closed',
    stateReason: 'completed',
    body: 'DONE=true\nFINISHED_AT=2026-10-16T08:00:00Z\nFINISH_RECEIPT_URL=https://ci.example.com/receipt\n- [x] All done'
  };

  const result = evaluateProductAcceptance({
    productType: 'backend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    changes,
    checkRuns,
    issue,
    externallyVerified: false
  });

  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'CLOSED_ISSUE_NOT_ACCEPTANCE');
  assert.ok(result.reasons.includes('CLOSED_ISSUE_CANNOT_SUBSTITUTE_PRODUCT_ACCEPTANCE'));

  const verifiedResult = evaluateProductAcceptance({
    productType: 'backend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    changes,
    checkRuns,
    issue,
    externallyVerified: true
  });
  assert.equal(verifiedResult.pass, true);
  assert.equal(verifiedResult.status, 'ACCEPTED');
});

// --- RECEIPT & SHA EDGE CASES ---
test('Receipt object support: supports typed receipt objects matching exact SHA', () => {
  const changes = [
    { path: 'apps/web/src/App.tsx', content: 'export default () => <h1>App</h1>;' }
  ];
  const receipts = [
    { type: 'Frontend Functional Verify', status: 'completed', conclusion: 'success', head_sha: VALID_SHA_A, url: 'https://ci.com/run/123' }
  ];

  const result = evaluateProductAcceptance({
    productType: 'frontend',
    sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
    changes,
    receipts
  });

  assert.equal(result.pass, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.some(x=>x.includes('RECEIPT_PROVENANCE_UNVERIFIED')));
});

test('SHA validation: invalid or non-40-hex SHA is immediately BLOCKED', () => {
  const changes = [
    { path: 'apps/api/index.mjs', content: 'console.log("ok");' }
  ];
  for (const badSha of ['', 'not-a-sha', '123', 'g'.repeat(40), 'a'.repeat(39)]) {
    const result = evaluateProductAcceptance({
      productType: 'backend',
      sourceHeadSha: badSha,
    repositoryFullName: REPOSITORY,
      changes,
      checkRuns: [{ name: 'Backend Contract Verify', status: 'completed', conclusion: 'success', head_sha: badSha }]
    });
    assert.equal(result.pass, false);
    assert.equal(result.code, 'SOURCE_HEAD_SHA_INVALID');
  }
});

test('assertProductAcceptance throws structured error when BLOCKED', () => {
  assert.throws(
    () => assertProductAcceptance({
      productType: 'android',
      sourceHeadSha: VALID_SHA_A,
    repositoryFullName: REPOSITORY,
      changes: [],
      checkRuns: []
    }),
    err => {
      assert.equal(err.status, 'BLOCKED');
      assert.equal(err.code, 'PRODUCT_CHANGES_EMPTY');
      return true;
    }
  );
});

test('G5 strict transport: completed receipt without conclusion never implies success',()=>{
  for (const receipt of [
    {type:'Backend Contract Verify',status:'completed',head_sha:VALID_SHA_A,url:'https://ci.example.com/run/1',runner:'trusted'},
    {type:'Backend Contract Verify',status:'completed',conclusion:'success',head_sha:VALID_SHA_A,url:'https://ci.example.com/run/1',runner:'github-actions'},
    {type:'Backend Contract Verify',status:'completed',conclusion:'success',head_sha:VALID_SHA_A,runner:'trusted'}
  ]){
    const verdict=verifyProductExecutionReceipts({productType:'backend',sourceHeadSha:VALID_SHA_A,repositoryFullName:REPOSITORY,receipts:[receipt]});
    assert.equal(verdict.pass,false);
    if (!Object.hasOwn(receipt,'conclusion'))assert.ok(verdict.reasons.some(x=>x.includes('RECEIPT_NOT_SUCCEEDED')));
    else assert.ok(verdict.reasons.some(x=>x.includes('RECEIPT_PROVENANCE_UNVERIFIED')));
  }
});

test('G5 strict transport: fabricated check-run cannot become a product PASS',()=>{
  const source=[{path:'apps/api/src/handler.mjs',content:'export const hello=()=>true;'}];
  const check=verifiedCheck('Backend Contract Verify');
  for (const forged of [
    {name:'Backend Contract Verify',head_sha:VALID_SHA_A,status:'completed',conclusion:'success'},
    {...check,id:undefined},
    {...check,app:{slug:'unknown'}},
    {...check,details_url:'https://attacker.invalid/actions/runs/100/job/101'},
    {...check,details_url:'https://github.com/elsewhere/repo/actions/runs/100/job/101'},
    {...check,details_url:'https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/100/job/not-a-job'},
  ]){
    const verdict=evaluateProductAcceptance({productType:'backend',sourceHeadSha:VALID_SHA_A,repositoryFullName:REPOSITORY,changes:source,checkRuns:[forged]});
    assert.equal(verdict.pass,false);
    assert.ok(verdict.reasons.some(x=>x.includes('CHECK_PROVENANCE_UNVERIFIED')));
  }
  assert.equal(evaluateProductAcceptance({productType:'backend',sourceHeadSha:VALID_SHA_A,changes:source,checkRuns:[check]}).pass,false);
  assert.equal(evaluateProductAcceptance({productType:'backend',sourceHeadSha:VALID_SHA_A,repositoryFullName:REPOSITORY,changes:source,checkRuns:[check]}).pass,true);
});
