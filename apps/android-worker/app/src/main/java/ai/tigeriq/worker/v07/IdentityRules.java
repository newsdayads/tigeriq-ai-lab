package ai.tigeriq.worker.v07;

import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

public final class IdentityRules {
    private static final Pattern ID = Pattern.compile("^[A-Z0-9][A-Z0-9._:-]{2,63}$");

    private IdentityRules() {}

    public static String requireId(String label, String raw) {
        if (raw == null) throw new IllegalArgumentException(label + " is required");
        String value = raw.trim().toUpperCase(Locale.ROOT);
        if (!ID.matcher(value).matches()) throw new IllegalArgumentException(label + " must match ^[A-Z0-9][A-Z0-9._:-]{2,63}$");
        return value;
    }

    public static String newDeviceId() {
        return "DEV-" + UUID.randomUUID().toString().replace("-", "").substring(0, 20).toUpperCase(Locale.ROOT);
    }

    public static String nodeIdFor(String deviceId) {
        String value = requireId("deviceId", deviceId);
        String suffix = value.length() <= 24 ? value : value.substring(value.length() - 24);
        return requireId("nodeId", "NODE-" + suffix);
    }
}
