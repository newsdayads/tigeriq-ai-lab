package ai.tigeriq.worker.v07;

import android.content.Context;

public final class SessionManager {
    private static final long REFRESH_SKEW_MS = 60_000L;
    private final SecureSecretStore secrets;
    public SessionManager(Context context) { secrets = new SecureSecretStore(context.getApplicationContext()); }
    public synchronized String validToken(EmployeeDeviceStore.Profile profile) throws Exception { String token = secrets.get(SecureSecretStore.SESSION_TOKEN); long expiresAt = secrets.getLong(SecureSecretStore.SESSION_EXPIRES_AT, 0L); if (token != null && expiresAt > System.currentTimeMillis() + REFRESH_SKEW_MS) return token; return refresh(profile); }
    public synchronized String refresh(EmployeeDeviceStore.Profile profile) throws Exception { String bootstrap = secrets.get(SecureSecretStore.BOOTSTRAP_TOKEN); if (bootstrap == null || bootstrap.isBlank()) throw new ApiException(401, "BOOTSTRAP_REQUIRED", "TigerIQ bootstrap credential missing", false, null); TigerIqApiClient.Session session = new TigerIqApiClient(profile).mintSession(bootstrap); saveSession(session); return session.accessToken; }
    public synchronized void saveSession(TigerIqApiClient.Session session) throws Exception { secrets.put(SecureSecretStore.SESSION_TOKEN, session.accessToken); secrets.putLong(SecureSecretStore.SESSION_EXPIRES_AT, session.expiresAtEpochMs); }
    public synchronized void invalidate() { secrets.remove(SecureSecretStore.SESSION_TOKEN); secrets.remove(SecureSecretStore.SESSION_EXPIRES_AT); }
    public synchronized String bootstrapToken() throws Exception { return secrets.get(SecureSecretStore.BOOTSTRAP_TOKEN); }
}
