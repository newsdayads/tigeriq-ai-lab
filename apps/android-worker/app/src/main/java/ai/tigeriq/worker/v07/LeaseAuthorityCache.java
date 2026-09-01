package ai.tigeriq.worker.v07;

import java.util.concurrent.ConcurrentHashMap;

/** Process-local lease authority. Never persisted; process/reboot loss forces server reacquisition. */
public final class LeaseAuthorityCache {
    private static final ConcurrentHashMap<String, Entry> CACHE = new ConcurrentHashMap<>();
    private LeaseAuthorityCache() {}

    public static void put(DurableCheckpointStore.JobLease lease) {
        if (lease == null || lease.jobId == null || lease.leaseToken == null) throw new IllegalArgumentException("lease required");
        CACHE.put(lease.jobId, new Entry(lease.leaseId, lease.bindingId, lease.leaseToken, lease.expiresAtEpochMs));
    }

    public static String token(DurableCheckpointStore.Snapshot snapshot, long nowEpochMs) {
        if (snapshot == null || snapshot.jobId == null) return null;
        Entry entry = CACHE.get(snapshot.jobId);
        if (entry == null || nowEpochMs >= entry.expiresAtEpochMs || !entry.leaseId.equals(snapshot.leaseId) || !entry.bindingId.equals(snapshot.bindingId) || !WorkNames.sha256(entry.token).equals(snapshot.leaseTokenHash)) {
            CACHE.remove(snapshot.jobId);
            return null;
        }
        return entry.token;
    }

    public static void remove(String jobId) { if (jobId != null) CACHE.remove(jobId); }
    static void clearForTest() { CACHE.clear(); }

    private static final class Entry {
        final String leaseId, bindingId, token; final long expiresAtEpochMs;
        Entry(String leaseId, String bindingId, String token, long expiresAtEpochMs) { this.leaseId = leaseId; this.bindingId = bindingId; this.token = token; this.expiresAtEpochMs = expiresAtEpochMs; }
    }
}
