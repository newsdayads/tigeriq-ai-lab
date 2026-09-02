package ai.tigeriq.worker.v07;

import java.net.URI;

/** Fail-closed transport policy pinned to the exact PC01 endpoint published by Controller PR #116. */
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
        if (!"http".equals(scheme) && !"https".equals(scheme)) throw new IllegalArgumentException("PC01 controller must use HTTP over Tailscale or HTTPS");
        if (!ControllerV1Contract.CONTROLLER_HOST.equals(host)) throw new IllegalArgumentException("PC01 controller host does not match Controller V1 contract");
        if (uri.getPort() != ControllerV1Contract.CONTROLLER_PORT) throw new IllegalArgumentException("PC01 controller port does not match Controller V1 contract");
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    /** Retained for callers/tests that explicitly require HTTPS on the canonical Controller endpoint. */
    public static String requireHttps(String raw) {
        String value = requireControllerUrl(raw);
        if (!value.regionMatches(true, 0, "https://", 0, 8)) throw new IllegalArgumentException("HTTPS required");
        return value;
    }
}
