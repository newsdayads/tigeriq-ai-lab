import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync(new URL('../apps/android-worker/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const main = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/MainActivity.java', import.meta.url), 'utf8');
const probe = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/AccessibilityBridgeService.java', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../apps/android-worker/app/src/main/res/values/styles.xml', import.meta.url), 'utf8');

describe('Android Worker v0.9 UI/runtime contract', () => {
  it('declares provider visibility so native apps are launched without accidental web fallback', () => {
    expect(manifest).toContain('<package android:name="com.openai.chatgpt" />');
    expect(manifest).toContain('<package android:name="com.google.android.apps.bard" />');
    expect(manifest).toContain('<package android:name="com.tailscale.ipn" />');
    expect(main).toContain('if (openInstalledPackage("com.openai.chatgpt")) return;');
    expect(main).not.toContain('Uri.parse("https://chatgpt.com/")');
    expect(main).not.toContain('Uri.parse("https://gemini.google.com/app")');
  });

  it('preserves the last provider snapshot when launcher/recents events arrive', () => {
    expect(probe).toContain('KEY_PROVIDER_PACKAGE');
    expect(probe).toContain('KEY_PROVIDER_EVENT_AT');
    expect(probe).toContain('if (!isPilotProvider(value)) return;');
    expect(probe).not.toContain('if (!isPilotProvider(value)) {\n            writeProbe(false');
    expect(probe).toContain('if (rootPackage == null || !value.equals(rootPackage.toString())) return;');
  });

  it('uses canonical TigerIQ palette and dynamic runtime version', () => {
    for (const token of ['#06101F', '#0B1A2F', '#164B7A', '#2CBCFF', '#28DF91', '#FFBD46', '#EFF7FF']) {
      expect(main + theme).toContain(token);
    }
    expect(main).toContain('WorkerVersion.NAME + " · TigerIQ Core Mobile');
    expect(main).not.toContain('v0.7 Core Mobile');
  });
});
