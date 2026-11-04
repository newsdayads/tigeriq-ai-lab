// GH-5135 post-merge CI regression: the native clean-clone Gradle gate must
// have enough time to download Gradle and complete assemble + lint + JVM tests
// on a cold hosted runner. The fixture may retain only a scoped unsigned exact-head artifact; no signing or release.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./android-native-fixture.test.ts', import.meta.url),
  'utf8',
);

describe('GH-5135 native fixture timeout contract', () => {
  it('keeps the Gradle child timeout below the outer Vitest timeout with cold-run margin', () => {
    const gradle = source.match(/ANDROID_GRADLE_TIMEOUT_MS = ([\d_]+);/);
    const outer = source.match(/NATIVE_GATE_TEST_TIMEOUT_MS = ([\d_]+);/);
    expect(gradle).not.toBeNull();
    expect(outer).not.toBeNull();

    const gradleMs = Number(gradle![1].replaceAll('_', ''));
    const outerMs = Number(outer![1].replaceAll('_', ''));

    expect(gradleMs).toBeGreaterThanOrEqual(600_000);
    expect(outerMs).toBeGreaterThanOrEqual(gradleMs + 120_000);
    expect(source).toContain('timeout:ANDROID_GRADLE_TIMEOUT_MS');
    expect(source).toContain('},NATIVE_GATE_TEST_TIMEOUT_MS);');
  });
});
