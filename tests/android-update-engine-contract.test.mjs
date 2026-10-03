import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync(new URL('../apps/android-worker/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/WorkerUpdateEngine.java', import.meta.url), 'utf8');
const installReceiver = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/UpdateInstallReceiver.java', import.meta.url), 'utf8');
const replacedReceiver = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/WorkerPackageReplacedReceiver.java', import.meta.url), 'utf8');
const service = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ForegroundWorkerService.java', import.meta.url), 'utf8');
const activity = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/MainActivity.java', import.meta.url), 'utf8');
const client = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ControllerClient.java', import.meta.url), 'utf8');

describe('Android Update Engine V1', () => {
  it('downloads only from authenticated TigerIQ Core and verifies package integrity', () => {
    expect(client).toContain('/api/mobile/update/apk');
    expect(client).toContain('X-TigerIQ-Credential-Id');
    expect(engine).toContain('APK_SHA256_MISMATCH');
    expect(engine).toContain('APK_SIGNER_MISMATCH');
    expect(engine).toContain('APK_PACKAGE_NAME_MISMATCH');
    expect(engine).toContain('APK_VERSION_MISMATCH');
  });

  it('uses PackageInstaller with silent-update request and pending-user-action fallback', () => {
    expect(manifest).toContain('android.permission.REQUEST_INSTALL_PACKAGES');
    expect(manifest).toContain('android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION');
    expect(engine).toContain('PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED');
    expect(engine).toContain('PendingIntent.FLAG_MUTABLE');
    expect(installReceiver).toContain('STATUS_PENDING_USER_ACTION');
    expect(installReceiver).toContain('Intent.EXTRA_INTENT');
  });

  it('auto-resumes runtime after package replacement', () => {
    expect(manifest).toContain('android.intent.action.MY_PACKAGE_REPLACED');
    expect(replacedReceiver).toContain('WorkerUpdateEngine.markPackageReplaced');
    expect(replacedReceiver).toContain('ForegroundWorkerService.class');
    expect(replacedReceiver).toContain('startForegroundService');
  });

  it('checks updates automatically but never interrupts an active B1 run', () => {
    expect(service).toContain('scheduleWithFixedDelay(this::autoUpdate');
    expect(engine).toContain('DEFERRED_B1_ACTIVE');
    expect(engine).toContain('ChatGptB1RunStore.read(app).active()');
    expect(activity).toContain('WorkerUpdateEngine.shouldResumeAfterPermission');
    expect(activity).toContain('Cập nhật tự động');
  });
  it('closes PackageInstaller write streams before committing the install session', () => {
    const commitStart = engine.indexOf('private static int commitInstall');
    const helperStart = engine.indexOf('private static void writeSessionApk');
    const verifyStart = engine.indexOf('private static void verifyDownloadedApk');
    const commit = engine.slice(commitStart, helperStart);
    const writer = engine.slice(helperStart, verifyStart);

    expect(commitStart).toBeGreaterThan(-1);
    expect(helperStart).toBeGreaterThan(commitStart);
    expect(commit).toContain('writeSessionApk(session, apk);');
    expect(commit).toContain('session.commit(pending.getIntentSender());');
    expect(writer).toContain('try (FileInputStream input = new FileInputStream(apk);');
    expect(writer).toContain('OutputStream output = session.openWrite("base.apk", 0L, apk.length()))');
    expect(writer).toContain('session.fsync(output);');
  });

});
