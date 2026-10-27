import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

test('v59 Native Compose Quick Layout Bar in Stage v59', () => {
  const xo5Path = 'D:\\TigerIQ\\Apps\\DeXCamPersonal\\Staged_v1_0_59_NativeComposeQuickRow_300\\smali\\xo5.smali';
  assert.ok(existsSync(xo5Path), 'xo5.smali must exist in stage v59');
  const xo5 = readFileSync(xo5Path, 'utf8');

  // Verify Row 1 has both start (uu2->a) and reload (uu2->e)
  assert.match(xo5, /invoke-static\/range\s*\{v7\s*\.\.\s*v13\},\s*Luu2;->a/);
  assert.match(xo5, /invoke-static\/range\s*\{v16\s*\.\.\s*v21\},\s*Luu2;->e/);

  // Verify QuickBarRow is called after sl->y
  const slYIndex = xo5.indexOf('invoke-static {v12, v1, v4, v1, v1}, Lsl;->y');
  const quickBarIndex = xo5.indexOf('invoke-static {v1, v12, v2}, Lcom/tigeriq/v44/QuickBarRow;->render');
  const uu2iIndex = xo5.indexOf('invoke-static/range {v16 .. v21}, Luu2;->i');

  assert.ok(slYIndex > 0, 'sl->y found');
  assert.ok(quickBarIndex > slYIndex, 'QuickBarRow.render must be after sl->y');
  assert.ok(uu2iIndex > quickBarIndex, 'uu2->i must be after QuickBarRow.render');
});

test('v59 QuickBarContent renders 5 slots using atomic uu2->h button', () => {
  const contentPath = 'D:\\TigerIQ\\Apps\\DeXCamPersonal\\Staged_v1_0_59_NativeComposeQuickRow_300\\smali\\com\\tigeriq\\v44\\QuickBarContent.smali';
  assert.ok(existsSync(contentPath), 'QuickBarContent.smali must exist in stage v59');
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

test('v59 signing and sync target versionCode 300 / v1.0.59', () => {
  const signScript = readFileSync('D:\\TigerIQ\\Tools\\sign_latest.ps1', 'utf8');
  const syncScript = readFileSync('D:\\TigerIQ\\Tools\\sync_latest_ultracar_to_drive.ps1', 'utf8');

  assert.match(signScript, /UltraCar_v1\.0\.59_300_aligned_TEST\.apk/);
  assert.match(signScript, /UltraCar_v1\.0\.59_300_signed_TEST\.apk/);

  assert.match(syncScript, /UltraCar_v1\.0\.59_300_signed_TEST\.apk/);
  assert.match(syncScript, /UltraCar_v1\.0\.59_TEST\.apk/);
});
