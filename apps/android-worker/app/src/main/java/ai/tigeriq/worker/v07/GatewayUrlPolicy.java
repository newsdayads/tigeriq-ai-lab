package ai.tigeriq.worker.v07;

import java.net.URI;

/** Transport policy for the PC01 controller. Public cleartext is rejected; Tailscale CGNAT HTTP is allowed. */
public final class GatewayUrlPolicy {
    private GatewayUrlPolicy() {}

    public static String requireControllerUrl(String raw) {
        if (raw == null || raw.trim().isEmpty()) throw new IllegalArgumentException("PC01 controller URL is required");
        String value = raw.trim();
        URI uri = URI.create(value);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost();
        if (host == null || uri.getUserInfo() != null) throw new IllegalArgumentException("PC01 controller host is invalid");
        if (uri.getQuery() != null || uri.getFragment() != null) throw new IllegalArgumentException("PC01 controller URL cannot contain query or fragment");
        String path = uri.getPath();
        if (path != null && !path.isEmpty() && !"/".equals(path)) throw new IllegalArgumentException("PC01 controller URL must not contain a path");
        if ("http".equals(scheme)) {
            if (!isTailscaleIpv4(host)) throw new IllegalArgumentException("Cleartext PC01 is allowed only on Tailscale 100.64.0.0/10");
        } else if (!"https".equals(scheme)) {
            throw new IllegalArgumentException("PC01 controller must use HTTPS or Tailscale HTTP");
        }
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    /** Retained for old callers/tests that explicitly require public HTTPS. */
    public static String requireHttps(String raw) {
        String value = requireControllerUrl(raw);
        if (!value.regionMatches(true, 0, "https://", 0, 8)) throw new IllegalArgumentException("HTTPS required");
        return value;
    }

    static boolean isTailscaleIpv4(String host) {
        if (host == null) return false;
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        try {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            int c = Integer.parseInt(parts[2]);
            int d = Integer.parseInt(parts[3]);
            return a == 100 && b >= 64 && b <= 127 && c >= 0 && c <= 255 && d >= 0 && d <= 255;
        } catch (NumberFormatException error) {
            return false;
        }
    }
}
