import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {patchV52Smali} from "../apps/ultracarhcm-v1-v53/hotfix/patch-v52-smali.mjs";

const source = readFileSync(new URL("../apps/ultracarhcm-v1-v53/src/com/tigeriq/v44/V44UiBridge.java", import.meta.url), "utf8");

test("Quickbar has precisely five session-ID-backed slots and label text", () => {
  assert.match(source, /new String\[5\]/);
  assert.match(source, /prefs\(\)\.getString\("slot_" \+ i/);
  assert.match(source, /cell\.setOnClickListener\(v -> openSlot\(slot\)\)/);
  assert.match(source, /cell\.setOnLongClickListener\(v -> \{ pickSlot\(slot\); return true; \}\)/);
  assert.match(source, /label\.setText\(name\(item\)\)/);
  assert.match(source, /\+%02d/);
});
test("Bar only appears on home when two unique physical anchors bound a real gap", () => {
  assert.match(source, /onMainScreen \|\| onSavedScreen \|\| startBtnRect == null \|\| bottomBarRect == null/);
  assert.match(source, /gap < height \+ dp\(4\)/);
  assert.match(source, /quickBar\.setVisibility\(View\.GONE\)/);
  assert.doesNotMatch(source, /lp\.gravity = Gravity\.BOTTOM \| Gravity\.LEFT;/);
});
test("Saved-screen grips use immutable ID, true bounds and durable order", () => {
  assert.match(source, /public static boolean isSavedScreen\(\)/);
  assert.match(source, /grip\.setOnTouchListener\(\(v, e\) -> onGrip\(fixedId, e\)\)/);
  assert.match(source, /exactTarget\(event\.getRawX\(\) - pos\[0\], event\.getRawY\(\) - pos\[1\]\)/);
  assert.match(source, /shift\.invoke\(null, from, target\)/);
  assert.doesNotMatch(source, /dragRevision == revision/);
});
test("Ghost cropped relative to actual source child and follows grabbed offset", () => {
  assert.match(source, /parent\.getLocationOnScreen\(contentOrigin\)/);
  assert.match(source, /overlay\.getLocationOnScreen\(overlayOrigin\)/);
  assert.match(source, /ghost\.setX\(event\.getRawX\(\) - pos\[0\] - grabOffsetX\)/);
  assert.match(source, /ghost\.setY\(event\.getRawY\(\) - pos\[1\] - grabOffsetY\)/);
});
const bottom = [
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
const uu2 = [
".method public static e()V",
'    const-string v1, "__START_BUTTON__"',
"    move-result-object p3",
bottom,
".end method",
".method public static i()V",
bottom,
".end method"
].join("\n");
const main = [
".method public dispatchTouchEvent(Landroid/view/MotionEvent;)Z",
"    .locals 1",
"    invoke-static {p1}, Lcom/tigeriq/layout/Addons;->dispatch(Landroid/view/MotionEvent;)Z",
"    move-result v0",
"    invoke-static {p0, p1, v0}, Lcom/tigeriq/layout/DragGhost;->event(Landroid/app/Activity;Landroid/view/MotionEvent;Z)V",
"    if-eqz v0, :cond_0",
"    return v0",
"    :cond_0",
"    invoke-super {p0, p1}, Ljn0;->dispatchTouchEvent(Landroid/view/MotionEvent;)Z",
"    move-result v0",
"    return v0",
".end method"
].join("\n");
test("Smali transform drops only duplicate bottom anchor and preserves real bottom", () => {
  const patched = patchV52Smali(uu2, main);
  assert.equal((patched.uu2.match(/"__BOTTOM_BAR__"/g) || []).length,1);
  assert.equal((patched.uu2.match(/"__START_BUTTON__"/g) || []).length,1);
  assert.match(patched.mainActivity, /:v53_native_saved_touch/);
  assert.match(patched.mainActivity, /invoke-static \{\}, Lcom\/tigeriq\/v44\/V44UiBridge;->isSavedScreen\(\)Z/);
  assert.match(patched.mainActivity, /Addons;->dispatch/);
});
test("Smali guard rejects unexpected upstream source", () => {
  assert.throws(() => patchV52Smali(uu2.replace("__START_BUTTON__","__NO_ANCHOR__"),main),/START_ANCHOR_COUNT/);
  assert.throws(() => patchV52Smali(uu2,main.replace("Addons;->dispatch","NewClass;->dispatch")),/DISPATCH_V52_GUARD/);
});
test("Smali source transform supports original Windows CRLF files", () => {
  const patched = patchV52Smali(uu2.replace(/\n/g,"\r\n"),main.replace(/\n/g,"\r\n"));
  assert.equal((patched.uu2.match(/"__BOTTOM_BAR__"/g)||[]).length,1);
  assert.ok(patched.uu2.includes("\r\n"));
  assert.ok(patched.mainActivity.includes("\r\n"));
});
