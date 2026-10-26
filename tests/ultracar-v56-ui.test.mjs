import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { patchV55Smali } from "../apps/ultracarhcm-v1-v56/hotfix/patch-v55-smali.mjs";
const code = readFileSync(new URL("../apps/ultracarhcm-v1-v56/src/com/tigeriq/v44/V44UiBridge.java", import.meta.url),"utf8");
test("native Home shortcut row is exactly five slots and assigned once",()=>{
  assert.match(code,/String\[\] slotIds = new String\[5\]/);
  assert.match(code,/defaults_seeded/);
  assert.match(code,/Math\.min\(5, ordered\.size\(\)\)/);
  assert.match(code,/setContentDescription\("Bố cục nhanh "/);
});
test("grips preserve saved route and keep session-bound touch",()=>{
  assert.match(code,/if \(onSavedScreen\) return;/);
  assert.match(code,/grip\.setOnTouchListener\(\(v, e\) -> onGrip\(fixedId, e\)\)/);
  assert.match(code,/shift\.invoke\(null, from, target\)/);
  assert.match(code,/setContentDescription\("Di chuyển bố cục "/);
});
test("guarded Smali patch fixes the two routes",()=>{
  const ho0=":cond_not_home_v52\n    invoke-static {}, Lcom/tigeriq/v44/V44UiBridge;->onLeaveHomeScreen()V\n";
  const ad4="    invoke-static {}, Lcom/tigeriq/v44/V44UiBridge;->onEnterSavedScreen()V\n\n    :pswitch_0\n    move-object/from16 v24, p1";
  const patched=patchV55Smali(ho0,ad4);
  assert.doesNotMatch(patched.ho0,/onLeaveHomeScreen/);
  assert.equal(patched.ad4.split("onEnterSavedScreen").length-1,2);
  assert.throws(()=>patchV55Smali(patched.ho0,patched.ad4),/HO0_LEAVE_HOOK/);
});
test("no floating version chip and no new custom menu",()=>{
  assert.doesNotMatch(code,/versionBadge|badgeBg|badgeLp/);
  assert.doesNotMatch(code,/TÙY CHỈNH|CUSTOMIZE_MENU/);
});
