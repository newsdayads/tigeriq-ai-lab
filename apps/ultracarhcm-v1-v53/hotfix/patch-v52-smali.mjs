// Pure, guarded source transformation for UltraCar v1.0.52 (293) -> v1.0.53 candidate (294).
// NEVER execute on signed v52/production or a live stage. Caller supplies isolated TEST source.
// This module does not touch PC01, keystores, APKs, or Google Drive.
export function patchV52Smali(uu2, mainActivity) {
  if (typeof uu2 !== "string" || typeof mainActivity !== "string") throw Error("INPUT_REQUIRED");
  const uu2CRLF = uu2.includes("\r\n");
  const mainCRLF = mainActivity.includes("\r\n");
  uu2 = uu2.replace(/\r\n/g, "\n");
  mainActivity = mainActivity.replace(/\r\n/g, "\n");
  if ((uu2.match(/"__START_BUTTON__"/g) || []).length !== 1) throw Error("START_ANCHOR_COUNT");
  if ((uu2.match(/"__BOTTOM_BAR__"/g) || []).length !== 2) throw Error("EXPECTED_V52_DUPLICATE_BOTTOM_ANCHOR");

  const tag = [
    "    new-instance v6, Lcom/tigeriq/v44/CardPositioned;",
    "",
    '    const-string v7, "__BOTTOM_BAR__"',
    "",
    "    invoke-direct {v6, v7}, Lcom/tigeriq/v44/CardPositioned;-><init>(Ljava/lang/String;)V",
    "",
    "    invoke-static {p3, v6}, Landroidx/compose/ui/layout/a;->d(Lb83;Lnz1;)Lb83;",
    "",
    "    move-result-object p3",
    ""
  ].join("\n");

  const startAt = uu2.indexOf('const-string v1, "__START_BUTTON__"');
  const duplicateAt = uu2.indexOf(tag, startAt);
  if (startAt < 0 || duplicateAt < 0 || duplicateAt - startAt > 370) throw Error("DOUBLE_ANCHOR_GUARD");
  const fixedUu2 = uu2.slice(0, duplicateAt) + uu2.slice(duplicateAt + tag.length);
  if ((fixedUu2.match(/"__BOTTOM_BAR__"/g) || []).length !== 1) throw Error("BOTTOM_ANCHOR_NOT_UNIQUE");

  const begin = mainActivity.indexOf(".method public dispatchTouchEvent(Landroid/view/MotionEvent;)Z");
  const end = mainActivity.indexOf(".end method", begin);
  if (begin < 0 || end < 0) throw Error("DISPATCH_NOT_FOUND");
  let method = mainActivity.slice(begin, end);
  const legacy = "    invoke-static {p1}, Lcom/tigeriq/layout/Addons;->dispatch(Landroid/view/MotionEvent;)Z";
  const superCall = "    invoke-super {p0, p1}, Ljn0;->dispatchTouchEvent(Landroid/view/MotionEvent;)Z";
  if (!method.includes(legacy) || !method.includes(superCall) || method.includes(":v53_native_saved_touch")) {
    throw Error("DISPATCH_V52_GUARD");
  }
  method = method.replace(legacy, [
    "    invoke-static {}, Lcom/tigeriq/v44/V44UiBridge;->isSavedScreen()Z",
    "",
    "    move-result v0",
    "",
    "    if-nez v0, :v53_native_saved_touch",
    "",
    legacy
  ].join("\n"));
  method = method.replace("    :cond_0\n"+superCall, "    :cond_0\n    :v53_native_saved_touch\n"+superCall);
  if (!method.includes(":v53_native_saved_touch\n"+superCall)) throw Error("NATIVE_SAVED_TOUCH_NOT_FOUND");

  const fixedMain = mainActivity.slice(0, begin) + method + mainActivity.slice(end);
  if ((fixedMain.match(/V44UiBridge;->isSavedScreen/g) || []).length !== 1) throw Error("SCREEN_GUARD_NOT_UNIQUE");
  return { uu2:uu2CRLF ? fixedUu2.replace(/\n/g, "\r\n") : fixedUu2, mainActivity:mainCRLF ? fixedMain.replace(/\n/g, "\r\n") : fixedMain };
}
