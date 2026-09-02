package ai.tigeriq.worker.v07;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;

public final class ControllerV1ContractTest {
    @Test public void pinsApproved116ProtocolEndpointAndRoutes() throws Exception {
        assertEquals("116", ControllerV1Contract.SOURCE_PR);
        assertEquals("c0632bc110ea0d26925d3657ac485cb90b5ee010", ControllerV1Contract.SOURCE_HEAD);
        assertEquals("controller-v1", ControllerV1Contract.PROTOCOL);
        assertEquals("001_operational_state_v1", ControllerV1Contract.MIGRATION);
        assertEquals("100.97.23.87", ControllerV1Contract.CONTROLLER_HOST);
        assertEquals(8790, ControllerV1Contract.CONTROLLER_PORT);
        assertEquals("http://100.97.23.87:8790", ControllerV1Contract.CONTROLLER_TAILSCALE_HTTP_BASE);
        assertEquals("/api/v1/status", ControllerV1Contract.STATUS_PATH);
        assertEquals("/api/v1/jobs/lease", ControllerV1Contract.LEASE_PATH);
        assertEquals("/api/v1/jobs/JOB-001/result", ControllerV1Contract.resultPath("JOB-001"));
        assertEquals("/api/v1/devices/DEV-001/heartbeat", ControllerV1Contract.heartbeatPath("DEV-001"));
    }

    @Test public void acceptsOnlyCompatibleControllerStatus() throws Exception {
        ControllerV1Contract.requireCompatible(new JSONObject()
                .put("ok", true)
                .put("protocol", "controller-v1")
                .put("postgres", true)
                .put("migration", "001_operational_state_v1"));
    }

    @Test(expected = ApiException.class)
    public void rejectsWrongProtocol() throws Exception {
        ControllerV1Contract.requireCompatible(new JSONObject()
                .put("ok", true)
                .put("protocol", "legacy")
                .put("postgres", true)
                .put("migration", "001_operational_state_v1"));
    }

    @Test(expected = ApiException.class)
    public void rejectsWrongMigration() throws Exception {
        ControllerV1Contract.requireCompatible(new JSONObject()
                .put("ok", true)
                .put("protocol", "controller-v1")
                .put("postgres", true)
                .put("migration", "old"));
    }
}
