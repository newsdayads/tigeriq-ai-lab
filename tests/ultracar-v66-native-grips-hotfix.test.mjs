import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchNativeGripReorder} from '../apps/ultracarhcm-v1-v66/hotfix/patch-native-grips.mjs';
const path = new URL('../apps/ultracarhcm-v1-v57/src/com/tigeriq/v44/V44UiBridge.java',import.meta.url);
const base=readFileSync(path,'utf8');
test('v57 source bridge applies deterministic v66 patch once',()=>{
  const out=patchNativeGripReorder(base);
  assert.ok(out.length>base.length/2);
  assert.match(out,/dragSnapshotBounds = new HashMap/);
  assert.match(out,/CardPositioned Compose onGloballyPositioned/);
  assert.match(out,/repairMissingGrips\(\)/);
  assert.match(out,/dragSnapshotBounds\.put\(sid, new Rect\(measured\)\)/);
  assert.match(out,/Math\.min\(originRect\.width\(\)/);
  assert.match(out,/if \(found != null\) return null/);
  assert.match(out,/cardBounds\.clear\(\);\s*hideAllGrips\(\);\s*shiftById/);
  assert.match(out,/dragSnapshotBounds\.clear\(\)/);
  assert.match(out,/preview\.setX\(r\.left\)/);
  assert.doesNotMatch(out,/int firstTop = Math\.round\(height \* 0\.155f\)/);
  assert.doesNotMatch(out,/Bitmap whole = Bitmap\.createBitmap\(/);
});
test('fail closed on wrong source and repeat application',()=>{
  assert.throws(()=>patchNativeGripReorder(''),/SOURCE_BRIDGE_NOT_RECOGNIZED/);
  const out=patchNativeGripReorder(base);
  assert.throws(()=>patchNativeGripReorder(out),/SOURCE_ANCHOR_MISMATCH|CARD_MAP_ANCHOR_MISMATCH/);
});
test('no false assumptions about runtime device or APK release',()=>{
  const out=patchNativeGripReorder(base);
  assert.doesNotMatch(out,/adb install|apksigner|Drive SYNC_PASS|DEVICE_QA_PASS/);
});
