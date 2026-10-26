import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const java = readFileSync(new URL("../apps/ultracarhcm-v1-v57/src/com/tigeriq/v44/V44UiBridge.java", import.meta.url), "utf8");

test("Home shortcuts anchor to native UltraCar cockpit instead of full external display", () => {
  assert.match(java, /final Rect bottom = bottomBarRect;/);
  assert.match(java, /final Rect start = startBtnRect;/);
  assert.match(java, /left = bottom\.left;/);
  assert.match(java, /right = bottom\.right;/);
  assert.match(java, /right = Math\.min\(right, left \+ Math\.round\(w \* 0\.37f\)\)/);
  assert.match(java, /y = start\.bottom \+ \(available - rowHeight\) \/ 2;/);
  assert.match(java, /int margin = Math\.max\(3, Math\.round\(\(right - left\) \* 0\.025f\)\)/);
  assert.match(java, /int rowWidth = right - left - 2 \* margin;/);
});

test("No dark shortcut strip or dark cells, keep action handlers", () => {
  assert.match(java, /quickBar\.setBackgroundColor\(Color\.TRANSPARENT\);/);
  assert.match(java, /cell\.setBackgroundColor\(Color\.TRANSPARENT\);/);
  assert.doesNotMatch(java, /0xA8131C28|0xE31B2636/);
  assert.match(java, /for \(int i = 0; i < 5; i\+\+\)/);
  assert.match(java, /cell\.setOnClickListener\(v -> openSlot\(slot\)\);/);
  assert.match(java, /cell\.setOnLongClickListener\(v -> \{ pickSlot\(slot\); return true; \}\);/);
});

test("Saved card grips and settings remain present", () => {
  assert.match(java, /if \(!onMainScreen \|\| onSavedScreen\)/);
  assert.match(java, /updateGrip\(sessionId,rect\);/);
  assert.match(java, /grip\.setOnTouchListener\(\(v, e\) -> onGrip\(fixedId, e\)\)/);
  assert.match(java, /defaults_seeded/);
  assert.match(java, /editor\.putString\("slot_" \+ i, sid\)/);
});
