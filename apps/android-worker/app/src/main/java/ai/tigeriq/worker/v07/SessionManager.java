package ai.tigeriq.worker.v07;

import android.content.Context;

public final class SessionManager {
    private static final long REFRESH_SKEW_MS = 60_000L;
    private final SecureSecretStore secrets;

    public SessionManager(Context context) {
        secrets = new SecureSecretStore(context.getApplicationContext());
    }

    public synchronized String validToken(EmployeeDeviceStore.Profile profile) throws Exception {
        if (profile == null || !profile.enrolled) throw new ApiException(401, "REENROLL_REQUIRED", "TigerIQ device enrollment required", false, null);
        String token = secrets.get(SecureSecretStore.SESSION_TOKEN);
        long expiresAt = secrets.getLong(SecureSecretStore.SESSION_EXPIRES_AT, 0L);
        if (SessionLifecycle.usable(expiresAt, System.currentTimeMillis(), REFRESH_SKEW_MS) && token != null && !token.isBlank()) return token;
        invalidate();
        throw new ApiException(401, "REENROLL_REQUIRED", "TigerIQ session expired; re-enrollment required", false, null);
    }

    public synchronized String refresh(EmployeeDeviceStore.Profile profile) throws Exception {
        // Locked v0.7 server contract exposes no device-bound refresh-token grant yet.
        // Do not retain/reuse the enrollment bootstrap credential as a de-facto refresh token.
        invalidate();
        throw new ApiException(401, "REENROLL_REQUIRED", "Device-bound refresh grant unavailable; re-enrollment required", false, null);
    }

    public synchronized void saveSession(TigerIqApiClient.Session session) throws Exception {
        if (session == null || session.accessToken == null || session.accessToken.isBlank()) throw new IllegalArgumentException("session required");
        secrets.put(SecureSecretStore.SESSION_TOKEN, session.accessToken);
        secrets.putLong(SecureSecretStore.SESSION_EXPIRES_AT, session.expiresAtEpochMs);
        secrets.remove(SecureSecretStore.BOOTSTRAP_TOKEN);
    }

    public synchronized void invalidate() {
        secrets.remove(SecureSecretStore.SESSION_TOKEN);
        secrets.remove(SecureSecretStore.SESSION_EXPIRES_AT);
        secrets.remove(SecureSecretStore.BOOTSTRAP_TOKEN);
    }
}
