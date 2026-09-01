package ai.tigeriq.worker.v07;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.After;
import org.junit.Test;

public final class LeaseAuthorityCacheTest {
    @After public void cleanup() { LeaseAuthorityCache.clearForTest(); }

    @Test public void rawLeaseAuthorityIsProcessOnlyAndBoundToCheckpointIdentity() {
        long expires = System.currentTimeMillis() + 60_000L;
        DurableCheckpointStore.JobLease lease = new DurableCheckpointStore.JobLease(
                "JOB-1", "IDEMP-1", "BIND-1", "LEASE-1", "secret-lease-token", expires, 1, "{}");
        LeaseAuthorityCache.put(lease);
        DurableCheckpointStore.Snapshot matching = new DurableCheckpointStore.Snapshot(
                "JOB-1", "IDEMP-1", "BIND-1", "LEASE-1", WorkNames.sha256("secret-lease-token"), DurableCheckpointStore.PHASE_LEASED, expires, 1, null, null, null, 1L);
        assertEquals("secret-lease-token", LeaseAuthorityCache.token(matching, System.currentTimeMillis()));

        LeaseAuthorityCache.clearForTest(); // models process/reboot memory loss
        assertNull(LeaseAuthorityCache.token(matching, System.currentTimeMillis()));
    }

    @Test public void wrongBindingCannotRecoverLeaseAuthority() {
        long expires = System.currentTimeMillis() + 60_000L;
        DurableCheckpointStore.JobLease lease = new DurableCheckpointStore.JobLease(
                "JOB-1", "IDEMP-1", "BIND-1", "LEASE-1", "secret-lease-token", expires, 1, "{}");
        LeaseAuthorityCache.put(lease);
        DurableCheckpointStore.Snapshot wrong = new DurableCheckpointStore.Snapshot(
                "JOB-1", "IDEMP-1", "BIND-OLD", "LEASE-1", WorkNames.sha256("secret-lease-token"), DurableCheckpointStore.PHASE_LEASED, expires, 1, null, null, null, 1L);
        assertNull(LeaseAuthorityCache.token(wrong, System.currentTimeMillis()));
    }
}
