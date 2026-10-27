import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const stagePath = 'D:\\TigerIQ\\Apps\\DeXCamPersonal\\Staged_v1_0_61_CockpitThreeRows_302';

test('v61 Cockpit Three Rows in Stage 302', () => {
  const xo5Path = `${stagePath}\\smali\\xo5.smali`;
  assert.ok(existsSync(xo5Path), 'xo5.smali must exist in stage v61');
  const xo5 = readFileSync(xo5Path, 'utf8');

  // Verify column spacing is 6.0f (0x40c00000) and row heights are 40.0f (0x42200000)
  assert.match(xo5, /const\/high16\s+v3,\s+0x40c00000\s+#\s*6\.0f/, 'Column spacing must be 6.0f');
  assert.match(xo5, /const\/high16\s+v14,\s+0x42200000\s+#\s*40\.0f/, 'Row 2 and Row 3 heights must be 40.0f');

  // Verify Row 1 has both start (uu2->a) and reload (uu2->e)
  assert.match(xo5, /invoke-static\/range\s*\{v7\s*\.\.\s*v13\},\s*Luu2;->a/);
  assert.match(xo5, /invoke-static\/range\s*\{v16\s*\.\.\s*v21\},\s*Luu2;->e/);

  // Verify QuickBarRow is called after sl->y
  const slYIndex = xo5.indexOf('invoke-static {v12, v1, v4, v1, v1}, Lsl;->y');
  const quickBarIndex = xo5.indexOf('invoke-static {v1, v12, v2}, Lcom/tigeriq/v44/QuickBarRow;->render');
  const restoreV1Index = xo5.indexOf('const/4 v1, 0x0', quickBarIndex);
  const uu2iIndex = xo5.indexOf('invoke-static/range {v16 .. v21}, Luu2;->i');

  assert.ok(slYIndex > 0, 'sl->y found');
  assert.ok(quickBarIndex > slYIndex, 'QuickBarRow.render must be after sl->y');
  assert.ok(restoreV1Index > quickBarIndex && restoreV1Index < uu2iIndex, 'v1 must be restored to 0 before subsequent closures');
  assert.ok(uu2iIndex > restoreV1Index, 'uu2->i must be after restoreV1');
});

test('v61 QuickBarRow does not invoke NoSuchMethod on ma3', () => {
  const rowPath = `${stagePath}\\smali\\com\\tigeriq\\v44\\QuickBarRow.smali`;
  assert.ok(existsSync(rowPath), 'QuickBarRow.smali must exist in stage v61');
  const rowContent = readFileSync(rowPath, 'utf8');

  assert.doesNotMatch(rowContent, /getValue\(\)Ljava\/lang\/Object;/, 'Cannot call getValue on ma3');
  assert.match(rowContent, /invoke-static\/range\s*\{v0\s*\.\.\s*v5\},\s*Ljr5;->a/);
});

test('v61 QuickBarContent renders 5 slots using atomic uu2->h button', () => {
  const contentPath = `${stagePath}\\smali\\com\\tigeriq\\v44\\QuickBarContent.smali`;
  assert.ok(existsSync(contentPath), 'QuickBarContent.smali must exist in stage v61');
  const content = readFileSync(contentPath, 'utf8');

  // Verify uu2->h is called
  assert.match(content, /invoke-static\/range\s*\{v0\s*\.\.\s*v11\},\s*Luu2;->h/);
  // Verify 5 slots are invoked
  assert.match(content, /const\/4\s+v0,\s+0x0[\s\S]*renderSlot/);
  assert.match(content, /const\/4\s+v0,\s+0x1[\s\S]*renderSlot/);
  assert.match(content, /const\/4\s+v0,\s+0x2[\s\S]*renderSlot/);
  assert.match(content, /const\/4\s+v0,\s+0x3[\s\S]*renderSlot/);
  assert.match(content, /const\/4\s+v0,\s+0x4[\s\S]*renderSlot/);
});

test('v61 stage metadata matches build 302 and TigerIQ_HCM_v1.0.61', () => {
  const yml = readFileSync(`${stagePath}\\apktool.yml`, 'utf8');
  assert.match(yml, /versionCode:\s*'302'/);
  assert.match(yml, /versionName:\s*'TigerIQ_HCM_v1\.0\.61'/);
});

test('v61 signing and sync target versionCode 302 / v1.0.61', () => {
  const signScript = readFileSync('D:\\TigerIQ\\Tools\\sign_latest.ps1', 'utf8');
  const syncScript = readFileSync('D:\\TigerIQ\\Tools\\sync_latest_ultracar_to_drive.ps1', 'utf8');

  assert.match(signScript, /UltraCar_v1\.0\.61_302_aligned_TEST\.apk/);
  assert.match(signScript, /UltraCar_v1\.0\.61_302_signed_TEST\.apk/);

  assert.match(syncScript, /UltraCar_v1\.0\.61_302_signed_TEST\.apk/);
  assert.match(syncScript, /UltraCar_v1\.0\.61_TEST\.apk/);
});
