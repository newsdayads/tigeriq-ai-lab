package ai.tigeriq.worker;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Locale;

/** Self-update engine for TigerIQ Mobile Worker. */
public final class WorkerUpdateEngine {
    public static final String PREFS = "tigeriq-worker-update";
    public static final String KEY_STATE = "state";
    public static final String KEY_LAST_ERROR = "lastError";
    public static final String KEY_TARGET_VERSION = "targetVersion";
    public static final String KEY_SESSION_ID = "sessionId";
    public static final String KEY_LAST_CHECK_AT = "lastCheckAt";
    public static final String KEY_LAST_PACKAGE_REPLACED_AT = "lastPackageReplacedAt";
    public static final String KEY_STATE_AT = "stateAt";
    public static final String KEY_USER_INITIATED = "userInitiated";
    public static final String KEY_EXPECTED_SHA256 = "expectedSha256";
    public static final String KEY_EXPECTED_SIGNER_SHA256 = "expectedSignerSha256";
    public static final String ACTION_INSTALL_RESULT = "ai.tigeriq.worker.UPDATE_INSTALL_RESULT";
    private static final Object OPERATION_GATE = new Object();
    private static boolean updateInProgress;
    private static boolean taskLeaseInProgress;

    private WorkerUpdateEngine() {}

    public static Result checkAndInstall(Context context, boolean userInitiated) throws Exception {
        Context app = context.getApplicationContext();
        Result deferred = beginUpdate(app, userInitiated);
        if (deferred != null) return deferred;
        boolean installPending = false;
        try {
            ControllerClient client = new ControllerClient(new SecureCredentialStore(app));
        JSONObject manifest = client.updateManifest();
        long now = System.currentTimeMillis();
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong(KEY_LAST_CHECK_AT, now)
            .apply();

        if (!manifest.optBoolean("available", false)) {
            write(app, "NO_RELEASE", "", 0, -1, userInitiated, "", "");
            return new Result("NO_RELEASE", 0, false);
        }

        int targetVersion = manifest.optInt("versionCode", 0);
        if (targetVersion <= currentVersionCode(app)) {
            write(app, "UP_TO_DATE", "", targetVersion, -1, userInitiated, "", "");
            return new Result("UP_TO_DATE", targetVersion, false);
        }

        UpdateInstallPolicy.Action installAction = UpdateInstallPolicy.actionFor(manifest.optString("installMode", ""));
        if (installAction == UpdateInstallPolicy.Action.MANAGED_PENDING) {
            write(app, "MANAGED_UPDATE_PENDING", "", targetVersion, -1, userInitiated, "", "");
            return new Result("MANAGED_UPDATE_PENDING", targetVersion, false);
        }
        if (installAction == UpdateInstallPolicy.Action.REJECT) {
            write(app, "UPDATE_POLICY_BLOCKED", "unsupported_install_mode", targetVersion, -1, userInitiated, "", "");
            throw new IllegalStateException("unsupported update install mode");
        }

        String expectedSha256 = normalizeHex(manifest.optString("sha256", ""));
        String expectedSigner = normalizeHex(manifest.optString("signerSha256", ""));
        if (expectedSha256.length() != 64 || expectedSigner.length() != 64) {
            write(app, "VERIFY_FAILED", "manifest_integrity_missing", targetVersion, -1, userInitiated, expectedSha256, expectedSigner);
            throw new IllegalStateException("manifest integrity fields missing");
        }

        if (Build.VERSION.SDK_INT >= 26 && !app.getPackageManager().canRequestPackageInstalls()) {
            write(app, "NEEDS_INSTALL_PERMISSION", "", targetVersion, -1, userInitiated, expectedSha256, expectedSigner);
            if (userInitiated) openInstallPermissionSettings(app);
            return new Result("NEEDS_INSTALL_PERMISSION", targetVersion, false);
        }

        File dir = new File(app.getCacheDir(), "updates");
        File apk = new File(dir, "TIQ-Worker-v" + targetVersion + ".apk");
        write(app, "DOWNLOADING", "", targetVersion, -1, userInitiated, expectedSha256, expectedSigner);
        client.downloadUpdateApk(apk);

        verifyDownloadedApk(app, apk, targetVersion, expectedSha256, expectedSigner);
        write(app, "VERIFIED", "", targetVersion, -1, userInitiated, expectedSha256, expectedSigner);

            int sessionId = commitInstall(app, apk, targetVersion, userInitiated);
            installPending = true;
            write(app, "INSTALL_COMMITTED", "", targetVersion, sessionId, userInitiated, expectedSha256, expectedSigner);
            return new Result("INSTALL_COMMITTED", targetVersion, true);
        } finally {
            if (!installPending) {
                synchronized (OPERATION_GATE) {
                    updateInProgress = false;
                }
            }
        }
    }

    private static Result beginUpdate(Context app, boolean userInitiated) {
        synchronized (OPERATION_GATE) {
            if (updateInProgress || installPending(app)) {
                return new Result("UPDATE_IN_PROGRESS", 0, false);
            }
            if (taskLeaseInProgress || MobileTaskStore.read(app).present()) {
                write(app, "DEFERRED_CORE_TASK", "", 0, -1, userInitiated, "", "");
                return new Result("DEFERRED_CORE_TASK", 0, false);
            }
            ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(app);
            if (run.active()) {
                write(app, "DEFERRED_B1_ACTIVE", "", 0, -1, userInitiated, "", "");
                return new Result("DEFERRED_B1_ACTIVE", 0, false);
            }
            if (run.terminal() && run.evidenceSeq > run.reportedSeq) {
                write(app, "DEFERRED_EVIDENCE_PENDING", "", 0, -1, userInitiated, "", "");
                return new Result("DEFERRED_EVIDENCE_PENDING", 0, false);
            }
            updateInProgress = true;
            return null;
        }
    }

    public static boolean beginTaskLease(Context context) {
        synchronized (OPERATION_GATE) {
            if (updateInProgress || taskLeaseInProgress || installPending(context)) return false;
            taskLeaseInProgress = true;
            return true;
        }
    }

    private static boolean installPending(Context context) {
        android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String state = prefs.getString(KEY_STATE, "");
        boolean pending = "INSTALL_COMMITTED".equals(state)
            || "PENDING_USER_ACTION".equals(state)
            || "PENDING_USER_ACTION_OPENED".equals(state)
            || "INSTALL_SUCCESS_CALLBACK".equals(state);
        if (!pending) return false;

        int sessionId = prefs.getInt(KEY_SESSION_ID, -1);
        long stateAt = prefs.getLong(KEY_STATE_AT, 0L);
        boolean sessionAlive = false;
        if (sessionId >= 0) {
            try {
                sessionAlive = context.getPackageManager().getPackageInstaller().getSessionInfo(sessionId) != null;
            } catch (RuntimeException ignored) {
                sessionAlive = false;
            }
        }
        long ageMs = stateAt > 0 ? Math.max(0L, System.currentTimeMillis() - stateAt) : Long.MAX_VALUE;
        boolean stale = !sessionAlive || ageMs > 10 * 60 * 1000L;
        if (stale) {
            prefs.edit()
                .putString(KEY_STATE, "STALE_INSTALL_SESSION_RECOVERED")
                .putString(KEY_LAST_ERROR, "")
                .putInt(KEY_SESSION_ID, -1)
                .putLong(KEY_STATE_AT, System.currentTimeMillis())
                .apply();
            synchronized (OPERATION_GATE) {
                updateInProgress = false;
            }
            return false;
        }
        return true;
    }

    public static void endTaskLease() {
        synchronized (OPERATION_GATE) {
            taskLeaseInProgress = false;
        }
    }

    public static boolean shouldResumeAfterPermission(Context context) {
        if (Build.VERSION.SDK_INT < 26 || !context.getPackageManager().canRequestPackageInstalls()) return false;
        String state = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_STATE, "");
        return "NEEDS_INSTALL_PERMISSION".equals(state);
    }

    public static void openInstallPermissionSettings(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + context.getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    public static String state(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_STATE, "CHƯA KIỂM TRA");
    }

    public static String lastError(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LAST_ERROR, "");
    }

    public static void markInstallCallback(Context context, String state, String error) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_STATE, state)
            .putString(KEY_LAST_ERROR, safe(error))
            .putLong(KEY_STATE_AT, System.currentTimeMillis())
            .apply();
        if (state != null && (state.startsWith("INSTALL_FAILED_")
            || "UPDATE_FAILED".equals(state)
            || "AUTO_UPDATE_FAILED".equals(state))) {
            synchronized (OPERATION_GATE) {
                updateInProgress = false;
            }
        }
    }

    public static void markPackageReplaced(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_STATE, "UPDATED_AND_RESUMED")
            .putString(KEY_LAST_ERROR, "")
            .putLong(KEY_LAST_PACKAGE_REPLACED_AT, System.currentTimeMillis())
            .putLong(KEY_STATE_AT, System.currentTimeMillis())
            .apply();
        synchronized (OPERATION_GATE) {
            updateInProgress = false;
        }
    }

    public static boolean wasUserInitiated(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_USER_INITIATED, false);
    }

    private static int commitInstall(Context context, File apk, int targetVersion, boolean userInitiated) throws Exception {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
            new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(context.getPackageName());
        params.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= 31) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }

        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            writeSessionApk(session, apk);

            Intent result = new Intent(context, UpdateInstallReceiver.class)
                .setAction(ACTION_INSTALL_RESULT)
                .putExtra(KEY_TARGET_VERSION, targetVersion)
                .putExtra(KEY_USER_INITIATED, userInitiated);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent pending = PendingIntent.getBroadcast(context, sessionId, result, flags);
            session.commit(pending.getIntentSender());
        }
        return sessionId;
    }

    private static void writeSessionApk(PackageInstaller.Session session, File apk) throws Exception {
        try (FileInputStream input = new FileInputStream(apk);
             OutputStream output = session.openWrite("base.apk", 0L, apk.length())) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            session.fsync(output);
        }
    }

    private static void verifyDownloadedApk(
        Context context,
        File apk,
        int targetVersion,
        String expectedSha256,
        String expectedSigner
    ) throws Exception {
        if (!apk.isFile() || apk.length() < 1024) throw new IllegalStateException("downloaded APK missing");
        String actualSha256 = sha256(apk);
        if (!actualSha256.equals(expectedSha256)) {
            throw new IllegalStateException("APK_SHA256_MISMATCH");
        }

        PackageManager pm = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo info = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (info == null) throw new IllegalStateException("APK_PACKAGE_INFO_UNAVAILABLE");
        if (!context.getPackageName().equals(info.packageName)) {
            throw new IllegalStateException("APK_PACKAGE_NAME_MISMATCH");
        }
        long archiveVersion = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        if (archiveVersion != targetVersion) throw new IllegalStateException("APK_VERSION_MISMATCH");

        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            signatures = info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length == 0) {
            throw new IllegalStateException("APK_SIGNER_MISSING");
        }
        boolean signerMatch = false;
        for (Signature signature : signatures) {
            if (normalizeHex(sha256(signature.toByteArray())).equals(expectedSigner)) {
                signerMatch = true;
                break;
            }
        }
        if (!signerMatch) throw new IllegalStateException("APK_SIGNER_MISMATCH");
    }

    private static long currentVersionCode(Context context) throws Exception {
        PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        return hex(digest.digest());
    }

    private static String sha256(byte[] bytes) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        return hex(digest.digest(bytes));
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) out.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return out.toString();
    }

    private static String normalizeHex(String value) {
        return value == null ? "" : value.replace(":", "").trim().toLowerCase(Locale.ROOT);
    }

    private static void write(
        Context context,
        String state,
        String error,
        int targetVersion,
        int sessionId,
        boolean userInitiated,
        String expectedSha256,
        String expectedSigner
    ) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_STATE, state)
            .putString(KEY_LAST_ERROR, safe(error))
            .putInt(KEY_TARGET_VERSION, targetVersion)
            .putInt(KEY_SESSION_ID, sessionId)
            .putBoolean(KEY_USER_INITIATED, userInitiated)
            .putString(KEY_EXPECTED_SHA256, expectedSha256)
            .putString(KEY_EXPECTED_SIGNER_SHA256, expectedSigner)
            .putLong(KEY_STATE_AT, System.currentTimeMillis())
            .apply();
    }

    private static String safe(String value) {
        if (value == null) return "";
        String normalized = value.replace('\n', ' ').replace('\r', ' ').trim();
        return normalized.length() <= 180 ? normalized : normalized.substring(0, 180);
    }

    public static final class Result {
        public final String state;
        public final int targetVersion;
        public final boolean installCommitted;

        Result(String state, int targetVersion, boolean installCommitted) {
            this.state = state;
            this.targetVersion = targetVersion;
            this.installCommitted = installCommitted;
        }
    }
}
