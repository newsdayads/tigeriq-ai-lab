package ai.tigeriq.worker.v07;

public final class ApiException extends Exception {
    public final int status; public final String code; public final boolean retryable; public final Long retryAfterMs;
    public ApiException(int status, String code, String message, boolean retryable, Long retryAfterMs) { super(message == null ? code : message); this.status = status; this.code = code == null ? "UNKNOWN" : code; this.retryable = retryable; this.retryAfterMs = retryAfterMs; }
    public boolean isTokenExpired() { return status == 401 && "TOKEN_EXPIRED".equals(code); }
    public boolean isUnauthorized() { return status == 401 || status == 403 || "UNAUTHORIZED".equals(code) || "SCOPE_DENIED".equals(code) || "IDENTITY_MISMATCH".equals(code); }
}
