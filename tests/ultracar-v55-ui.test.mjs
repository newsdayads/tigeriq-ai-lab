import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bridge=readFileSync(new URL("../apps/ultracarhcm-v1-v55/src/com/tigeriq/v44/V44UiBridge.java", import.meta.url),"utf8");

test("v55 does not create an extra version badge, header, overlay label, or theme",()=>{
  assert.doesNotMatch(bridge,/versionBadge|badgeBg|badgeLp|setText\("TigerIQ HCM v1\.0\.5\d+ \(build/);
  assert.match(bridge,/class V44UiBridge/);
});
test("Home quick slots are rendered after real layout measurements, including delayed fallback",()=>{
  assert.match(bridge,/overlay\.addOnLayoutChangeListener/);
  assert.match(bridge,/overlay\.postDelayed\(\(\) -> \{ if \(onMainScreen && !onSavedScreen\) renderBar\(\); \}, 200\)/);
  assert.match(bridge,/overlay\.postDelayed\(\(\) -> \{ if \(onMainScreen && !onSavedScreen\) renderBar\(\); \}, 650\)/);
});
test("No screen-dpi thresholds can suppress landscape 5 quick slots",()=>{
  assert.doesNotMatch(bridge,/width < dp\(550\)|height < dp\(420\)|overlay\.getWidth\(\) < dp\(600\)/);
  assert.match(bridge,/int x = Math\.round\(w \* 0\.285f\)/);
  assert.match(bridge,/Math\.round\(h \* 0\.805f\)/);
  assert.match(bridge,/quickBar\.setVisibility\(View\.VISIBLE\)/);
});
test("Keep five session-ID-backed slots with assigned icons and text",()=>{
  assert.match(bridge,/new String\[5\]/);
  assert.match(bridge,/label\.setText\(name\(item\)\)/);
  assert.match(bridge,/\+%02d/);
  assert.match(bridge,/openSlot\(slot\)/);
  assert.match(bridge,/pickSlot\(slot\)/);
  assert.match(bridge,/prefs\(\)\.getString\("slot_" \+ i/);
});
test("Saved layouts maintain independent handle-only drag and ID keyed slots",()=>{
  assert.match(bridge,/onSavedScreen = true/);
  assert.match(bridge,/quickBar\.setVisibility\(View\.GONE\)/);
  assert.match(bridge,/private static void repairMissingGrips\(\)/);
  assert.match(bridge,/Math\.min\(displayed\.size\(\), 6\)/);
  assert.match(bridge,/String sessionId = id\(displayed\.get\(i\)\)/);
  assert.match(bridge,/updateGrip\(sessionId,rect\)/);
  assert.match(bridge,/grip\.setOnTouchListener\(\(v, e\) -> onGrip\(fixedId, e\)\)/);
  assert.match(bridge,/shift\.invoke\(null, from, target\)/);
});
test("Fallback grip geometry is viewport relative and retains native card bounds",()=>{
  assert.match(bridge,/int left = Math\.round\(width \* 0\.128f\)/);
  assert.match(bridge,/int secondTop = Math\.round\(height \* 0\.465f\)/);
  assert.match(bridge,/if\(rect == null \|\| rect\.width\(\) < 50/);
});
test("Sample 16:9 screen: five quick slots above dock without clipping",()=>{
  for(const [width,height] of [[1280,720],[1600,900],[1920,1080],[2560,1440]]){
    const x=Math.round(width*0.285),barHeight=Math.max(36,Math.round(height*0.065));
    const rowWidth=width-x-Math.max(12,Math.round(width*0.016));
    const y=Math.max(Math.round(height*0.60),Math.min(Math.round(height*0.805),height-barHeight-8));
    assert.ok(rowWidth>=5*46);
    assert.ok(y>height*.60 && y+barHeight<height*.89,JSON.stringify({width,height,x,y,barHeight}));
  }
});
