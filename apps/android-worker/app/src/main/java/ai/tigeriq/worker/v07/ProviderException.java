package ai.tigeriq.worker.v07;

public final class ProviderException extends Exception {
    public final String provider;
    public final String code;
    public final boolean retryable;
    public final int httpStatus;

    public ProviderException(String provider, String code, String message, boolean retryable, int httpStatus) {
        super(message == null ? code : message);
        this.provider = provider == null ? "unknown" : provider;
        this.code = code == null ? "PROVIDER_ERROR" : code;
        this.retryable = retryable;
        this.httpStatus = httpStatus;
    }
}
