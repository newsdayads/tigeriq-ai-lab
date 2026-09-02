package ai.tigeriq.worker.v07;

import org.json.JSONObject;

import java.util.regex.Pattern;

/** Canonical Android client contract pinned to the approved Controller V1 in PR #116. */
public final class ControllerV1Contract {
    public static final String SOURCE_PR = "116";
    public static final String SOURCE_HEAD = "44543e7690591b6e053672e895ba5e810acb281e";
    public static final String PROTOCOL = "controller-v1";
    public static final String MIGRATION = "001_operational_state_v1";
    public static final String STATUS_PATH = "/api/v1/status";
    public static final String LEASE_PATH = "/api/v1/jobs/lease";
    private static final Pattern ROUTE_ID = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$");

    private ControllerV1Contract() {}

    public static String resultPath(String jobId) {
        return "/api/v1/jobs/" + routeId("jobId", jobId) + "/result";
    }

    public static String heartbeatPath(String deviceId) {
        return "/api/v1/devices/" + routeId("deviceId", deviceId) + "/heartbeat";
    }

    public static void requireCompatible(JSONObject status) throws ApiException {
        boolean compatible = status != null
                && status.optBoolean("ok", false)
                && PROTOCOL.equals(status.optString("protocol", ""))
                && status.optBoolean("postgres", false)
                && MIGRATION.equals(status.optString("migration", ""));
        if (!compatible) {
            throw new ApiException(503, "CONTROLLER_V1_INCOMPATIBLE", "PC01 Controller does not match TigerIQ Controller V1 / PostgreSQL migration 001", true, null);
        }
    }

    private static String routeId(String label, String raw) {
        if (raw == null) throw new IllegalArgumentException(label + " is required");
        String value = raw.trim();
        if (!ROUTE_ID.matcher(value).matches()) throw new IllegalArgumentException(label + " is not route-safe");
        return value;
    }
}
