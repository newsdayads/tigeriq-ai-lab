// GH-5135 F15/F20 — lifecycle fencing for asynchronous update checks/downloads.
// Source-only evidence; does not publish or install an APK.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const update = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UpdateActivity.kt', import.meta.url),
  'utf8',
);

function block(startNeedle: string, endNeedle: string): string {
  const start = update.indexOf(startNeedle);
  const end = update.indexOf(endNeedle, start + startNeedle.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return update.slice(start, end);
}

describe('GH-5135 F15 update Activity lifecycle', () => {
  it('invalidates asynchronous work when the Activity is destroyed', () => {
    expect(update).toContain('@Volatile private var operationGeneration = 0L');
    expect(update).toContain('@Volatile private var activityDestroyed = false');
    expect(update).toContain('private fun beginOperation(): Long');
    expect(update).toContain('private fun isOperationCurrent(generation: Long): Boolean');

    const destroy = block('override fun onDestroy()', 'private fun recordUpdateNotice');
    expect(destroy).toContain('activityDestroyed = true');
    expect(destroy).toContain('operationGeneration += 1L');
    expect(destroy.indexOf('activityDestroyed = true')).toBeLessThan(destroy.indexOf('super.onDestroy()'));
  });

  it('fences metadata callbacks before touching stale UI', () => {
    const check = block('private fun checkForUpdate()', 'private fun fetchMetadata');
    expect(check).toContain('val generation = beginOperation()');
    expect(check).toContain('if (!isOperationCurrent(generation)) return@Thread');
    expect(check).toContain('if (!isOperationCurrent(generation) || isFinishing || isDestroyed)');
    expect(check.indexOf('if (!isOperationCurrent(generation) || isFinishing || isDestroyed)'))
      .toBeLessThan(check.indexOf('checkButton.isEnabled = true'));
  });

  it('deletes a verified candidate produced by stale download work', () => {
    const download = block('private fun downloadAndVerify(metadata: UpdateMetadata)', 'private fun fetchAndVerifyPayload');
    expect(download).toContain('val generation = beginOperation()');
    expect(download).toContain('result.getOrNull()?.file?.delete()');
    expect(download).toContain('if (!isOperationCurrent(generation) || isFinishing || isDestroyed)');
    expect(download.indexOf('if (!isOperationCurrent(generation) || isFinishing || isDestroyed)'))
      .toBeLessThan(download.indexOf('verifiedApk = candidate'));
  });

  it('clears verified cache on destroy unless it was already handed to Android installer', () => {
    expect(update).toContain('private var installerHandoff = false');
    const install = block('private fun launchSystemInstaller(candidate: VerifiedApk)', 'private fun beginOperation');
    expect(install).toContain('installerHandoff = true');
    expect(install.indexOf('startActivity(')).toBeLessThan(install.indexOf('installerHandoff = true'));

    const destroy = block('override fun onDestroy()', 'private fun recordUpdateNotice');
    expect(destroy).toContain('if (!installerHandoff) clearVerifiedCandidate()');
  });
});
