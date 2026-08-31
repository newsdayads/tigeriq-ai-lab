package ai.tigeriq.worker.v07;

import java.net.URI;

public final class GatewayUrlPolicy {
    private GatewayUrlPolicy() {}

    public static String requireHttps(String raw) {
        if (raw == null || raw.trim().isEmpty()) throw new IllegalArgumentException("TigerIQ Gateway URL is required");
        String value = raw.trim();
        URI uri = URI.create(value);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) throw new IllegalArgumentException("TigerIQ Gateway must use HTTPS");
        if (uri.getQuery() != null || uri.getFragment() != null) throw new IllegalArgumentException("TigerIQ Gateway URL cannot contain query or fragment");
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }
}
