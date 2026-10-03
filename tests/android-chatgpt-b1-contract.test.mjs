import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const adapter = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ChatGptB1Automation.java', import.meta.url), 'utf8');
const store = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ChatGptB1RunStore.java', import.meta.url), 'utf8');
const service = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/AccessibilityBridgeService.java', import.meta.url), 'utf8');
const activity = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/MainActivity.java', import.meta.url), 'utf8');
const client = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ControllerClient.java', import.meta.url), 'utf8');
const core = readFileSync(new URL('../apps/tigeriq-core/mobile-worker-api.mjs', import.meta.url), 'utf8');
const gradle = readFileSync(new URL('../apps/android-worker/app/build.gradle.kts', import.meta.url), 'utf8');

describe('ChatGPT B1 pilot contract', () => {
  it('uses semantic input/click only and never coordinate gestures', () => {
    expect(adapter).toContain('ACTION_SET_TEXT');
    expect(adapter).toContain('ACTION_CLICK');
    expect(adapter).toContain('isEditable()');
    expect(adapter).toContain('isClickable()');
    expect(adapter).toContain('nearestClickable');
    expect(adapter).toContain('uniqueComposerAction');
    expect(adapter).toContain('bestScore - secondScore >= 20');
    expect(adapter + service).not.toMatch(/dispatchGesture|GestureDescription|getBoundsInScreen|performGlobalAction/);
  });

  it('pins exactly-once and bounded recovery state', () => {
    expect(store).toContain('TIGERIQ_B1_OK_');
    expect(store).toContain('Math.min(10, requestedCycles)');
    expect(store).toContain('s.sentCycle == s.cycle');
    expect(store).toContain('duplicateSendCount');
    expect(service).toContain('MAX_B1_RECOVERIES = 2');
    expect(service).toContain('ChatGptB1RunStore.markRecovery');
  });

  it('keeps B1 outside backlog and GitHub mutation', () => {
    expect(activity).toContain('Chạy 1 test');
    expect(activity).toContain('Chạy 10 test');
    expect(activity).toContain('không ghi GitHub');
    expect(adapter).not.toMatch(/github|lease|task|backlog/i);
  });

  it('reports terminal evidence idempotently to Core', () => {
    expect(client).toContain('/api/mobile/evidence');
    expect(core).toContain('tigeriq_mobile_evidence');
    expect(core).toContain("url.pathname==='/api/mobile/evidence'");
    expect(core).toContain('on conflict do nothing');
  });

  it('publishes versionCode 11 for the send-selector fix', () => {
    expect(gradle).toContain('versionCode = 11');
    expect(gradle).toContain('versionName = "0.11.0-send-selector"');
  });
});
