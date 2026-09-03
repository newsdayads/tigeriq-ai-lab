package ai.tigeriq.worker.v07;

import org.junit.Test;

import java.io.ByteArrayInputStream;

import static org.junit.Assert.assertEquals;

public final class TigerIqApiClientBoundaryTest {
    @Test public void acceptsResponseAtSafeLimit() throws Exception {
        byte[] payload = new byte[TigerIqApiClient.MAX_RESPONSE_BYTES];
        assertEquals(payload.length, TigerIqApiClient.readLimited(new ByteArrayInputStream(payload)).length);
    }

    @Test(expected = ApiException.class)
    public void rejectsResponseAboveSafeLimit() throws Exception {
        byte[] payload = new byte[TigerIqApiClient.MAX_RESPONSE_BYTES + 1];
        TigerIqApiClient.readLimited(new ByteArrayInputStream(payload));
    }
}
