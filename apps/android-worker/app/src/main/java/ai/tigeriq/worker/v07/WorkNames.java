package ai.tigeriq.worker.v07;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

public final class WorkNames {
    public static final String PERIODIC_PULL = "tigeriq-v07-periodic-pull";
    public static final String IMMEDIATE_PULL = "tigeriq-v07-immediate-pull";

    private WorkNames() {}

    public static String execute(String employeeId, String idempotencyKey) {
        if (employeeId == null || employeeId.isBlank() || idempotencyKey == null || idempotencyKey.isBlank()) throw new IllegalArgumentException("employeeId and idempotencyKey are required");
        return "tigeriq-v07-job-" + sha256(employeeId + "\n" + idempotencyKey).substring(0, 32);
    }

    static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(digest.length * 2);
            for (byte b : digest) out.append(String.format("%02x", b));
            return out.toString();
        } catch (Exception error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }
}
