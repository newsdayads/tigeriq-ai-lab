package ai.tigeriq.worker.v07;

import android.content.Context;
import android.content.SharedPreferences;

public final class EmployeeDeviceStore {
    private static final String PREFS = "tigeriq_v07_employee_device";
    private final SharedPreferences prefs;

    public EmployeeDeviceStore(Context context) { prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public synchronized String ensureDeviceId() {
        String existing = prefs.getString("deviceId", null);
        if (existing != null && !existing.isBlank()) return existing;
        String generated = IdentityRules.newDeviceId();
        if (!prefs.edit().putString("deviceId", generated).commit()) throw new IllegalStateException("cannot persist device identity");
        return generated;
    }

    public synchronized Profile draft(String gatewayUrl, String employeeId, String credentialId) {
        String deviceId = ensureDeviceId();
        return new Profile(GatewayUrlPolicy.requireHttps(gatewayUrl), IdentityRules.requireId("employeeId", employeeId), IdentityRules.nodeIdFor(deviceId), IdentityRules.requireId("deviceId", deviceId), requireText("credentialId", credentialId), prefs.getString("publicKeyFingerprint", ""), prefs.getBoolean("hardwareBacked", false), prefs.getLong("enrolledAt", 0L));
    }

    public synchronized void saveEnrolled(Profile profile, String publicKeyFingerprint, boolean hardwareBacked, long enrolledAt) {
        if (!prefs.edit().putString("gatewayUrl", GatewayUrlPolicy.requireHttps(profile.gatewayUrl)).putString("employeeId", IdentityRules.requireId("employeeId", profile.employeeId)).putString("nodeId", IdentityRules.requireId("nodeId", profile.nodeId)).putString("deviceId", IdentityRules.requireId("deviceId", profile.deviceId)).putString("credentialId", requireText("credentialId", profile.credentialId)).putString("publicKeyFingerprint", requireText("publicKeyFingerprint", publicKeyFingerprint)).putBoolean("hardwareBacked", hardwareBacked).putLong("enrolledAt", enrolledAt).putBoolean("enrolled", true).commit()) throw new IllegalStateException("cannot persist employee/device enrollment");
    }

    public synchronized Profile load() {
        if (!prefs.getBoolean("enrolled", false)) return null;
        String gatewayUrl = prefs.getString("gatewayUrl", null), employeeId = prefs.getString("employeeId", null), nodeId = prefs.getString("nodeId", null), deviceId = prefs.getString("deviceId", null), credentialId = prefs.getString("credentialId", null), fingerprint = prefs.getString("publicKeyFingerprint", null);
        if (gatewayUrl == null || employeeId == null || nodeId == null || deviceId == null || credentialId == null || fingerprint == null) return null;
        return new Profile(gatewayUrl, employeeId, nodeId, deviceId, credentialId, fingerprint, prefs.getBoolean("hardwareBacked", false), prefs.getLong("enrolledAt", 0L));
    }

    public synchronized boolean isEnrolled() { return load() != null; }

    private static String requireText(String label, String value) {
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException(label + " is required");
        return value.trim();
    }

    public static final class Profile {
        public final String gatewayUrl, employeeId, nodeId, deviceId, credentialId, publicKeyFingerprint;
        public final boolean hardwareBacked;
        public final long enrolledAtEpochMs;
        public Profile(String gatewayUrl, String employeeId, String nodeId, String deviceId, String credentialId, String publicKeyFingerprint, boolean hardwareBacked, long enrolledAtEpochMs) {
            this.gatewayUrl = gatewayUrl; this.employeeId = employeeId; this.nodeId = nodeId; this.deviceId = deviceId; this.credentialId = credentialId; this.publicKeyFingerprint = publicKeyFingerprint; this.hardwareBacked = hardwareBacked; this.enrolledAtEpochMs = enrolledAtEpochMs;
        }
    }
}
