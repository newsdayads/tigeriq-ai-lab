/**
 * Guarded stage-only patch for v55 (code 296) => v56 (code 297).
 * Applies to copied, isolated decoded APK; NEVER signed APK or production.
 * The old ho0 hook called onLeaveHomeScreen for each unrelated Compose lambda,
 * hiding the quickbar and clearing saved-layout state.
 * Saved-layout composable ad4 has two equivalent branches; both must enter Saved.
 */
export function patchV55Smali(ho0, ad4) {
  if (typeof ho0 !== "string" || typeof ad4 !== "string") throw Error("SMALI_INPUT_REQUIRED");
  const leave = "invoke-static {}, Lcom/tigeriq/v44/V44UiBridge;->onLeaveHomeScreen()V";
  const enter = "invoke-static {}, Lcom/tigeriq/v44/V44UiBridge;->onEnterSavedScreen()V";
  if (ho0.split(leave).length !== 2) throw Error("HO0_LEAVE_HOOK_EXPECTED_ONCE");
  if (ad4.split(enter).length !== 2) throw Error("AD4_SAVED_HOOK_EXPECTED_ONCE");
  const target = /(:pswitch_0\r?\n)([ \t]*)(move-object\/from16 v24, p1)/g;
  const matches = [...ad4.matchAll(target)];
  if (matches.length !== 1) throw Error("AD4_SAVED_BRANCH_EXPECTED_ONCE");
  const fixedHo0 = ho0.replace(leave, "nop");
  const fixedAd4 = ad4.replace(target, (_all, head, indent, move) =>
    head + indent + enter + (head.includes("\r\n") ? "\r\n\r\n" : "\n\n") + indent + move);
  if (fixedAd4.split(enter).length !== 3) throw Error("AD4_SAVED_BOTH_BRANCHES_REQUIRED");
  return { ho0: fixedHo0, ad4: fixedAd4 };
}
