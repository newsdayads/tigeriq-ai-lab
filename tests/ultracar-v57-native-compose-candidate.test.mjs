import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const path = new URL("../apps/ultracarhcm-v1-v57/native-compose/UltraCarHomeQuickLayouts.kt", import.meta.url);
const code = readFileSync(path, "utf8");

test("five quick slots are a same-tree Compose Row with equal widths and gutters", () => {
  assert.match(code, /@Composable\s+fun QuickLayoutInlineRow\(/);
  assert.match(code, /Row\(/);
  assert.match(code, /repeat\(5\)/);
  assert.match(code, /\.weight\(1f\)/);
  assert.match(code, /\.fillMaxWidth\(\)\.padding\(horizontal = 8\.dp\)/);
  assert.match(code, /Arrangement\.spacedBy\(6\.dp\)/);
});
test("slots are in the original card between start control and native actions", () => {
  const start = code.indexOf("startControl()", code.indexOf("fun UltraCarHomeControlColumn("));
  const quick = code.indexOf("QuickLayoutInlineRow(slots, onLaunch, onReassign)", start);
  const bottom = code.indexOf("bottomActions()", start);
  assert.ok(start !== -1 && quick > start && bottom > quick);
  assert.doesNotMatch(code, /WindowManager|Popup\(|Dialog\(|FrameLayout|overlay\.addView|\.background\(/);
});
test("tap launches stable session ID, long touch reassigns, persisted 5 keys unchanged", () => {
  assert.match(code, /onLaunch\(sessionId\)/);
  assert.match(code, /onLongClick = \{ onReassign\(index\) \}/);
  assert.match(code, /"tigeriq_v44_quick_slots"/);
  assert.match(code, /"slot_" \+ index/);
  assert.match(code, /require\(index in 0\.\.4\)/);
  assert.match(code, /sessionId\.isNotBlank\(\)/);
});
