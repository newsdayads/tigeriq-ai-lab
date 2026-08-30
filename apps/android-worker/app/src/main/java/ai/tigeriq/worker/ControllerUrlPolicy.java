package ai.tigeriq.worker;

import java.net.URI;

/**
 * Controller transport policy for the dedicated Worker pilot.
 * Public/non-tailnet endpoints must use HTTPS. HTTP is accepted only on the
 * Tailscale CGNAT range (100.64.0.0/10), where WireGuard provides transport encryption.
 */
public final class ControllerUrlPolicy {
    private ControllerUrlPolicy() {}

    public static String requireTrusted(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            throw new IllegalArgumentException("controller URL is required");
        }
        String value = raw.trim();
        URI uri = URI.create(value);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (host == null || uri.getUserInfo() != null) {
            throw new IllegalArgumentException("invalid controller URL");
        }
        if ("https".equalsIgnoreCase(scheme)) return stripTrailingSlash(value);
        if ("http".equalsIgnoreCase(scheme) && isTailscaleIpv4(host)) return stripTrailingSlash(value);
        throw new IllegalArgumentException("controller must use HTTPS or a Tailscale 100.64.0.0/10 address");
    }

    static boolean isTailscaleIpv4(String host) {
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        try {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            int c = Integer.parseInt(parts[2]);
            int d = Integer.parseInt(parts[3]);
            if (a != 100 || b < 64 || b > 127) return false;
            return c >= 0 && c <= 255 && d >= 0 && d <= 255;
        } catch (NumberFormatException error) {
            return false;
        }
    }

    private static String stripTrailingSlash(String value) {
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }
}
