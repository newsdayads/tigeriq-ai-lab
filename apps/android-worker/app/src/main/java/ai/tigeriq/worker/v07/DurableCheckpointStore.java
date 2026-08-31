package ai.tigeriq.worker.v07;

import android.content.Context;
import android.content.SharedPreferences;

public final class DurableCheckpointStore {
    public static final String PHASE_LEASED = "LEASED", PHASE_INFERENCE = "INFERENCE", PHASE_RESULT_READY = "RESULT_READY", PHASE_SUBMITTING = "SUBMITTING";
    private static final String PREFS = "tigeriq_v07_checkpoint";
    private final SharedPreferences prefs; private final SecureSecretStore secrets;
    public DurableCheckpointStore(Context context) { Context app = context.getApplicationContext(); prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE); secrets = new SecureSecretStore(app); }
    public synchronized void saveLease(JobLease lease) throws Exception {
        if (lease == null) throw new IllegalArgumentException("lease required"); secrets.put(SecureSecretStore.leaseKey(lease.jobId), lease.leaseToken); secrets.put(SecureSecretStore.jobKey(lease.jobId), lease.jobJson);
        if (!prefs.edit().putString("jobId", lease.jobId).putString("idempotencyKey", lease.idempotencyKey).putString("bindingId", lease.bindingId).putString("leaseId", lease.leaseId).putString("leaseTokenHash", WorkNames.sha256(lease.leaseToken)).putString("phase", PHASE_LEASED).putLong("leaseExpiresAt", lease.expiresAtEpochMs).putInt("attempt", lease.attempt).putLong("updatedAt", System.currentTimeMillis()).commit()) throw new IllegalStateException("cannot persist job checkpoint");
    }
    public synchronized void markPhase(String phase, String requestId, String inferenceIdempotencyKey) { prefs.edit().putString("phase", phase).putString("requestId", nullToEmpty(requestId)).putString("inferenceIdempotencyKey", nullToEmpty(inferenceIdempotencyKey)).putLong("updatedAt", System.currentTimeMillis()).commit(); }
    public synchronized void saveResult(String resultJson, String evidenceSha256) throws Exception { Snapshot snapshot = load(); if (!snapshot.hasInFlightWork()) throw new IllegalStateException("no active checkpoint"); secrets.put(SecureSecretStore.resultKey(snapshot.jobId), resultJson); prefs.edit().putString("evidenceSha256", nullToEmpty(evidenceSha256)).putString("phase", PHASE_RESULT_READY).putLong("updatedAt", System.currentTimeMillis()).commit(); }
    public synchronized Snapshot load() { String jobId = prefs.getString("jobId", null); return new Snapshot(jobId, prefs.getString("idempotencyKey", null), prefs.getString("bindingId", null), prefs.getString("leaseId", null), prefs.getString("leaseTokenHash", null), prefs.getString("phase", null), prefs.getLong("leaseExpiresAt", 0L), prefs.getInt("attempt", 0), emptyToNull(prefs.getString("requestId", "")), emptyToNull(prefs.getString("inferenceIdempotencyKey", "")), emptyToNull(prefs.getString("evidenceSha256", "")), prefs.getLong("updatedAt", 0L)); }
    public synchronized String leaseToken(Snapshot snapshot) throws Exception { return snapshot == null || snapshot.jobId == null ? null : secrets.get(SecureSecretStore.leaseKey(snapshot.jobId)); }
    public synchronized String jobJson(Snapshot snapshot) throws Exception { return snapshot == null || snapshot.jobId == null ? null : secrets.get(SecureSecretStore.jobKey(snapshot.jobId)); }
    public synchronized String resultJson(Snapshot snapshot) throws Exception { return snapshot == null || snapshot.jobId == null ? null : secrets.get(SecureSecretStore.resultKey(snapshot.jobId)); }
    public synchronized void clear() { Snapshot snapshot = load(); if (snapshot.jobId != null) secrets.removeJobSecrets(snapshot.jobId); prefs.edit().clear().commit(); }
    public static final class Snapshot {
        public final String jobId, idempotencyKey, bindingId, leaseId, leaseTokenHash, phase, requestId, inferenceIdempotencyKey, evidenceSha256; public final long leaseExpiresAtEpochMs, updatedAtEpochMs; public final int attempt;
        Snapshot(String jobId, String idempotencyKey, String bindingId, String leaseId, String leaseTokenHash, String phase, long leaseExpiresAtEpochMs, int attempt, String requestId, String inferenceIdempotencyKey, String evidenceSha256, long updatedAtEpochMs) { this.jobId = jobId; this.idempotencyKey = idempotencyKey; this.bindingId = bindingId; this.leaseId = leaseId; this.leaseTokenHash = leaseTokenHash; this.phase = phase; this.leaseExpiresAtEpochMs = leaseExpiresAtEpochMs; this.attempt = attempt; this.requestId = requestId; this.inferenceIdempotencyKey = inferenceIdempotencyKey; this.evidenceSha256 = evidenceSha256; this.updatedAtEpochMs = updatedAtEpochMs; }
        public boolean hasInFlightWork() { return jobId != null && !jobId.isBlank() && phase != null && !phase.isBlank(); }
        public boolean leaseExpired(long nowEpochMs) { return leaseExpiresAtEpochMs > 0L && nowEpochMs >= leaseExpiresAtEpochMs; }
    }
    public static final class JobLease {
        public final String jobId, idempotencyKey, bindingId, leaseId, leaseToken, jobJson; public final long expiresAtEpochMs; public final int attempt;
        public JobLease(String jobId, String idempotencyKey, String bindingId, String leaseId, String leaseToken, long expiresAtEpochMs, int attempt, String jobJson) { this.jobId = jobId; this.idempotencyKey = idempotencyKey; this.bindingId = bindingId; this.leaseId = leaseId; this.leaseToken = leaseToken; this.expiresAtEpochMs = expiresAtEpochMs; this.attempt = attempt; this.jobJson = jobJson; }
    }
    private static String nullToEmpty(String value) { return value == null ? "" : value; } private static String emptyToNull(String value) { return value == null || value.isBlank() ? null : value; }
}
