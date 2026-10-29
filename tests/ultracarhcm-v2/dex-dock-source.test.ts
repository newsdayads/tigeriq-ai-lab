// GH-5135 F07 — static source/manifest contract only; not Samsung device acceptance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const receiver = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/DexDockReceiver.kt', import.meta.url),
  'utf8',
);
const rules = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/DexDockRules.kt', import.meta.url),
  'utf8',
);
const manifest = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
);

describe('GH-5135 F07 Samsung DeX dock source contract', () => {
  it('exports only the DeX receiver so Samsung/System can deliver enter/exit actions', () => {
    expect(manifest).toContain('<receiver android:name=".DexDockReceiver" android:exported="true">');
    expect(manifest).toContain('android.app.action.ENTER_KNOX_DESKTOP_MODE');
    expect(manifest).toContain('android.app.action.EXIT_KNOX_DESKTOP_MODE');
    expect(manifest).toContain('android:resizeableActivity="true"');
  });

  it('launches only V2 Home on a resolved external display and never touches V1', () => {
    expect(receiver).toContain('Intent(context, HomeActivity::class.java)');
    expect(receiver).toContain('launchDisplayId = displayId!!');
    expect(receiver).toContain('DexUtils.resolveDisplay(context, Display.DEFAULT_DISPLAY)');
    expect(receiver).toContain('context.stopService(Intent(context, OverlayService::class.java))');
    expect(receiver).not.toContain('com.tigeriq.dexsplit');
  });

  it('fails closed for invalid enter and refuses spoofed exit while external DeX is active', () => {
    expect(rules).toContain('displayId != null && displayId > 0');
    expect(rules).toContain('isEnterAction(action) && desktopActive && hasExternalDisplay(displayId)');
    expect(rules).toContain('isExitAction(action) && (!desktopActive || !hasExternalDisplay(displayId))');
    expect(receiver).toContain('DexDockRules.shouldStopOverlay(action, desktopActive, displayId)');
    expect(receiver).toContain('DeX exit ignored: desktop=$desktopActive display=$displayId');
  });

  it('uses goAsync with bounded retries for transient DeX display-state convergence', () => {
    expect(receiver).toContain('val pendingResult = goAsync()');
    expect(receiver).toContain('launchV2HomeOnDexWithRetry(');
    expect(receiver).toContain('MAIN_HANDLER.postDelayed(');
    expect(receiver).toContain('DexDockRules.shouldRetryEnter(action, attempt, desktopActive, displayId)');
    expect(receiver).toContain('pendingResult.finish()');
    expect(rules).toContain('const val MAX_ENTER_ATTEMPTS = 3');
    expect(rules).toContain('attempt < MAX_ENTER_ATTEMPTS');
    expect(rules).toContain('2 -> 350L');
    expect(rules).toContain('else -> 900L');
  });

  it('does not retry a platform-rejected activity launch', () => {
    expect(receiver).toContain('Platform launch failure is terminal for this broadcast');
    expect(receiver).toMatch(/catch \(error: Throwable\)[\s\S]*finally \{\s*pendingResult\.finish\(\)/);
  });
});
