import test from "node:test";
import assert from "node:assert/strict";
import { parseApktoolVersion, planSignedCandidate, selectSignedForSync, destinationDecision, requireReleaseGates } from "../apps/ultracarhcm-v1-v57/release/safe-release-gates.mjs";
const oldStage = "versionInfo:\n  versionCode: '297'\n  versionName: 'TigerIQ_HCM_v1.0.56'\n";
const newStage = "versionInfo:\n  versionCode: '298'\n  versionName: 'TigerIQ_HCM_v1.0.57'\n";
const correct = {
  alignedName: "UltraCar_v1.0.57_298_aligned_TEST.apk",
  metadata: newStage,
  expectedMinor: 57, expectedCode: 298,
  existingSignedNames: []
};
const shaA = "a".repeat(64), shaB = "b".repeat(64);
test("FAIL CLOSED: old v56 stage cannot masquerade as v57", () => {
  assert.deepEqual(parseApktoolVersion(oldStage), { code: 297, minor: 56, name: "TigerIQ_HCM_v1.0.56" });
  assert.throws(() => planSignedCandidate({...correct,metadata:oldStage}), /STAGE_VERSION_MISMATCH/);
  assert.throws(() => planSignedCandidate({...correct,alignedName:"UltraCar_v1.0.56_297_aligned_TEST.apk"}), /ALIGNED_NAME_MISMATCH/);
});
test("only an exact v57/code298 fresh aligned APK can be signed", () => {
  assert.deepEqual(planSignedCandidate(correct), { signedName: "UltraCar_v1.0.57_298_signed_TEST.apk", expectedCode: 298, expectedMinor: 57 });
  assert.throws(() => planSignedCandidate({...correct, existingSignedNames:["UltraCar_v1.0.57_298_signed_TEST.apk"]}), /SIGNED_EXISTS_NO_OVERWRITE/);
  assert.throws(() => planSignedCandidate({...correct, alignedName:"UltraCar_v1.0.57_298_unsigned_TEST.apk"}), /ALIGNED_NAME_MISMATCH/);
});
test("Drive source rejects PowerShell wildcard unsigned-suffix trap", () => {
  assert.equal(selectSignedForSync({signedName:"UltraCar_v1.0.57_298_signed_TEST.apk", expectedMinor:57, expectedCode:298}), "UltraCar_v1.0.57_TEST.apk");
  assert.throws(() => selectSignedForSync({signedName:"UltraCar_v1.0.57_298_unsigned_TEST.apk", expectedMinor:57, expectedCode:298}), /ONLY_SIGNED_TEST_APK_ALLOWED/);
  assert.throws(() => selectSignedForSync({signedName:"UltraCar_v1.0.56_297_signed_TEST.apk", expectedMinor:57, expectedCode:298}), /SIGNED_VERSION_MISMATCH/);
});
test("Drive collision never silently overwrites foreign bytes", () => {
  assert.equal(destinationDecision({sourceSha256:shaA}), "CREATE");
  assert.equal(destinationDecision({sourceSha256:shaA,existingSha256:shaA.toUpperCase()}),"IDENTICAL_ALREADY_STAGED");
  assert.throws(() => destinationDecision({sourceSha256:shaA,existingSha256:shaB}), /DRIVE_COLLISION_HASH_MISMATCH/);
});
test("signed Drive TEST does not imply accepted application", () => {
  const flags = {localVersion:true,signature:true,targetName:true,syncReceipt:true,driveReadback:true};
  assert.deepEqual(requireReleaseGates({...flags,realDexQA:false}),{testPublished:true,appDone:false});
  assert.deepEqual(requireReleaseGates({...flags,realDexQA:true}),{testPublished:true,appDone:true});
  assert.throws(() => requireReleaseGates({...flags,driveReadback:false,realDexQA:true}), /TEST_RELEASE_UNVERIFIED/);
});
